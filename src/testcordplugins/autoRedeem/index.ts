/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordRequestCoordinator } from "@api/index";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { LogIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { NavigationRouter, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

import { addLog, loadLogs, type RedeemType } from "./store";

const Native = VencordNative?.pluginHelpers?.AutoRedeem as PluginNative<typeof import("./native")> | undefined;

const logger = new Logger("AutoRedeem");

const GIFT_REGEX = /discord(?:\.gift|\.com\/gifts|app\.com\/gifts)\/([a-zA-Z0-9]+)/g;
const SETTINGS_KEY = "autoredeem_logs";

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    channelId: string;
    guildId: string;
    message: Message;
}

interface GiftPrecheckBody {
    redeemed?: boolean;
    uses?: number | null;
    max_uses?: number | null;
    expires_at?: string | null;
}

function classifyGift(data: any): RedeemType {
    const name: string = (data?.subscription_plan?.name ?? data?.store_listing?.sku?.name ?? "").toLowerCase();
    if (name.includes("nitro") || name.includes("boost")) return "nitro";
    if (name.includes("decoration") || name.includes("avatar") || name.includes("profile")) return "decoration";
    return "other";
}

const settings = definePluginSettings({
    speedMode: {
        type: OptionType.BOOLEAN,
        description: "Blazing fast mode: parallel redemption with no delays. Forces prevalidation on. May increase captcha risk.",
        default: false,
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Ignore gifts sent by yourself",
        default: true,
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore gifts sent by bots",
        default: false,
    },
    prevalidate: {
        type: OptionType.BOOLEAN,
        description: "Pre-check gift codes before redeeming. Skips already-claimed/invalid codes and dramatically reduces captchas.",
        default: true,
    },
    notifyOnRedeem: {
        type: OptionType.BOOLEAN,
        description: "Show a desktop notification when successfully redeeming a gift",
        default: true,
    },
    notifyOnFail: {
        type: OptionType.BOOLEAN,
        description: "Show a desktop notification when failing to redeem a gift",
        default: true,
    },
    noneCapApiKey: {
        type: OptionType.STRING,
        description: "NoneCap API key for automatically solving CAPTCHAs. Leave empty to use Discord's CAPTCHA modal.",
        default: "",
        placeholder: "nc_live_...",
        restartNeeded: false,
    },
    webhookUrl: {
        type: OptionType.STRING,
        description: "Discord webhook URL to notify after each redeem attempt. Leave empty to disable.",
        default: "",
        restartNeeded: false,
    },
});

// Bounded LRU of codes we've already seen, so we never retry within the same
// session but also don't leak unbounded memory across long uptimes.
const SEEN_CAP = 5000;
const seen = new Set<string>();
function markSeen(code: string) {
    if (seen.has(code)) {
        // Re-insert for LRU ordering (Set preserves insertion order)
        seen.delete(code);
        seen.add(code);
        return;
    }
    seen.add(code);
    if (seen.size > SEEN_CAP) {
        // Evict oldest ~10% to amortize the cost
        const toEvict = Math.floor(SEEN_CAP * 0.1);
        let i = 0;
        for (const k of seen) {
            if (i++ >= toEvict) break;
            seen.delete(k);
        }
    }
}

// Speed mode: how many codes to prevalidate/redeem concurrently.
const FAST_CONCURRENCY = 5;

// Codes currently waiting in the serial queue.
const queue: QueueItem[] = [];
let processing = false;
// When true, we stop touching the redeem endpoint until the user re-enables.
// Set by captcha responses or hard 429s.
let captchaPaused = false;
let pauseToastShown = false;

interface QueueItem {
    code: string;
    channelId: string;
    messageId: string;
    guildId?: string;
}

function sleep(ms: number) {
    return new Promise<void>(r => setTimeout(r, ms));
}

function jitter(minMs: number, maxMs: number) {
    return minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs));
}

function isCaptchaError(body: any): boolean {
    if (!body) return false;
    if (Array.isArray(body.captcha_key) && body.captcha_key.includes("captcha-required")) return true;
    if (typeof body.captcha_sitekey === "string" && body.captcha_sitekey.length > 0) return true;
    return false;
}

// Fire a lightweight request on start to warm up DNS + TLS session for discord.com.
// Subsequent requests reuse the cached connection, cutting first-request latency.
function warmupConnection() {
    TestcordRequestCoordinator.request({
        key: "discord:warmup:users-me",
        ttlMs: 10_000,
        run: () => RestAPI.get({ url: "/users/@me" }),
    }).catch(() => { });
}

function notifyPaused(reason: string) {
    captchaPaused = true;
    queue.length = 0;
    if (pauseToastShown) return;
    pauseToastShown = true;
    showToast(`AutoRedeem paused: ${reason}`, Toasts.Type.FAILURE);
    logger.warn(`Paused: ${reason}`);
}

async function trySolveCaptcha(captchaService: string, sitekey: string, rqdata: string | undefined, pageUrl: string): Promise<{ success: boolean; token?: string; error?: string }> {
    const apiKey = settings.store.noneCapApiKey.trim();
    if (!apiKey || !Native) return { success: false, error: "" };

    return Native.solveCaptcha(apiKey, sitekey, rqdata, pageUrl, navigator.userAgent);
}

async function sendClaimWebhook(code: string, status: "claimed" | "failed", giftType: string | null, channelId: string, messageId: string, guildId: string | undefined, error?: string) {
    const url = settings.store.webhookUrl.trim();
    if (!url) return;

    const payload = {
        username: "AutoRedeem",
        embeds: [{
            title: status === "claimed" ? "Redeemed a gift! 🎉" : "Redeem Failed ❌",
            color: status === "claimed" ? 0x57F287 : 0xED4245,
            description: `Code: \`${code}\`${giftType ? `\nType: ${giftType}` : ""}${error ? `\nError: ${error}` : ""}`,
            timestamp: new Date().toISOString(),
            footer: { text: "AutoRedeem" }
        }]
    };

    void Native?.sendWebhook(url, JSON.stringify(payload)).catch(() => { });
}

async function precheckGift(code: string): Promise<{ ok: boolean; data?: any; reason?: string; }> {
    try {
        const { body } = await TestcordRequestCoordinator.request<{ body?: GiftPrecheckBody; }>({
            key: `discord:gift-precheck:${code}`,
            ttlMs: 60_000,
            run: () => RestAPI.get({
                url: `/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`,
            }) as Promise<{ body?: GiftPrecheckBody; }>,
        });
        if (body?.redeemed) return { ok: false, data: body, reason: "already claimed" };
        if (body?.uses != null && body?.max_uses != null && body.uses >= body.max_uses) {
            return { ok: false, data: body, reason: "already claimed" };
        }
        if (body?.expires_at && Date.parse(body.expires_at) < Date.now()) {
            return { ok: false, data: body, reason: "expired" };
        }
        return { ok: true, data: body };
    } catch (e: any) {
        if (isCaptchaError(e?.body)) {
            notifyPaused("captcha required");
            return { ok: false, reason: "captcha required" };
        }
        const msg: string = e?.body?.message ?? "";
        const codeName: string = e?.body?.code ?? "";
        if (e?.status === 404 || /unknown/i.test(msg) || /invalid/i.test(msg)) {
            return { ok: false, reason: "invalid code" };
        }
        // Fall through and let the actual redeem attempt produce a real error.
        return { ok: true, reason: codeName || msg || undefined };
    }
}

async function processQueue() {
    if (processing) return;
    processing = true;
    try {
        if (settings.store.speedMode) {
            // Parallel: process up to FAST_CONCURRENCY codes at once, zero delay.
            while (queue.length && !captchaPaused) {
                const batch = queue.splice(0, FAST_CONCURRENCY);
                await Promise.allSettled(batch.map(item => handleRedeem(item)));
            }
        } else {
            // Serial: one at a time with jitter.
            while (queue.length && !captchaPaused) {
                const item = queue.shift()!;
                await handleRedeem(item);
                if (queue.length && !captchaPaused) {
                    await sleep(jitter(1, 1200));
                }
            }
        }
    } finally {
        processing = false;
    }
}

async function handleRedeem(item: QueueItem) {
    const { code, channelId, messageId, guildId } = item;
    const fast = settings.store.speedMode;

    // Aggressive mode (TestcordHelper) lets a speed-mode user skip the precheck
    // round-trip entirely, shaving one RTT off each redeem. This raises captcha
    // risk (precheck is what reduces captchas), so it only applies in speed mode
    // and only when the TestcordHelper aggressive toggle is on. Default behavior
    // is unchanged.
    const skipPrecheck = fast && TestcordRequestCoordinator.aggressiveNetworkEnabled();

    if (!skipPrecheck && (fast || settings.store.prevalidate)) {
        const pre = await precheckGift(code);
        if (!pre.ok) {
            const reason = pre.reason ?? "unredeemable";
            addLog({ code, status: "failed", type: "other", error: reason, channelId, messageId });
            logger.info(`Skipping ${code}: ${reason}`);
            if (!fast && settings.store.notifyOnFail && reason !== "already claimed" && reason !== "invalid code" && reason !== "expired") {
                showToast(`AutoRedeem skipped ${code}: ${reason}`, Toasts.Type.MESSAGE);
            }
            await sendClaimWebhook(code, "failed", "other", channelId, messageId, guildId, reason);
            return;
        }
    }

    if (captchaPaused) return;

    try {
        const { body } = await RestAPI.post({
            url: `/entitlements/gift-codes/${code}/redeem`,
            body: { channel_id: channelId },
        });
        const giftType = classifyGift(body);
        addLog({ code, status: "success", type: giftType, channelId, messageId });
        if (!fast) {
            showToast(`Redeemed gift: ${code}`, Toasts.Type.SUCCESS);
        }
        logger.info(`Redeemed gift code: ${code}`);
        if (!fast && settings.store.notifyOnRedeem) {
            const user = UserStore.getCurrentUser();
            showNotification({
                title: "Gift Redeemed! 🎉",
                body: `Successfully redeemed: ${code}`,
                color: "#57F287",
                icon: user?.getAvatarURL(),
                onClick: () => NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/${messageId}`),
            });
        }
        await sendClaimWebhook(code, "claimed", giftType, channelId, messageId, guildId);
    } catch (e: any) {
        if (isCaptchaError(e?.body)) {
            const sitekey = e?.body?.captcha_sitekey;
            if (sitekey && settings.store.noneCapApiKey.trim()) {
                const rqdata = e?.body?.captcha_rqdata;
                const solveResult = await trySolveCaptcha("hcaptcha", sitekey, rqdata, location.href);
                if (solveResult.success && solveResult.token) {
                    const retryBody = { channel_id: channelId, captcha_key: solveResult.token, captcha_rqtoken: rqdata };
                    try {
                        const { body } = await RestAPI.post({
                            url: `/entitlements/gift-codes/${code}/redeem`,
                            body: retryBody,
                        });
                        const giftType = classifyGift(body);
                        addLog({ code, status: "success", type: giftType, channelId, messageId });
                        if (!fast) showToast(`Redeemed gift: ${code}`, Toasts.Type.SUCCESS);
                        logger.info(`Redeemed gift code: ${code}`);
                        if (!fast && settings.store.notifyOnRedeem) {
                            const user = UserStore.getCurrentUser();
                            showNotification({
                                title: "Gift Redeemed! 🎉",
                                body: `Successfully redeemed: ${code}`,
                                color: "#57F287",
                                icon: user?.getAvatarURL(),
                                onClick: () => NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/${messageId}`),
                            });
                        }
                        await sendClaimWebhook(code, "claimed", giftType, channelId, messageId, guildId);
                        return;
                    } catch (retryErr: any) {
                        if (isCaptchaError(retryErr?.body)) {
                            notifyPaused("captcha required");
                            addLog({ code, status: "failed", type: "other", error: "captcha required", channelId, messageId });
                            await sendClaimWebhook(code, "failed", null, channelId, messageId, guildId, "captcha required");
                            return;
                        }
                    }
                } else if (solveResult.error) {
                    logger.warn(`NoneCap solve failed for ${code}: ${solveResult.error}`);
                }
            }
            notifyPaused("captcha required");
            addLog({ code, status: "failed", type: "other", error: "captcha required", channelId, messageId });
            await sendClaimWebhook(code, "failed", null, channelId, messageId, guildId, "captcha required");
            return;
        }
        if (e?.status === 429) {
            const retryAfter = Number(e?.body?.retry_after ?? e?.headers?.["retry-after"] ?? 0);
            notifyPaused(`rate limited${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`);
            addLog({ code, status: "failed", type: "other", error: "rate limited", channelId, messageId });
            await sendClaimWebhook(code, "failed", "other", channelId, messageId, guildId, "rate limited");
            return;
        }
        const msg: string = e?.body?.message ?? "Unknown error";
        addLog({ code, status: "failed", type: "other", error: msg, channelId, messageId });
        await sendClaimWebhook(code, "failed", "other", channelId, messageId, guildId, msg);
        if (!fast) {
            showToast(`Failed to redeem ${code}: ${msg}`, Toasts.Type.FAILURE);
        }
        logger.warn(`Failed to redeem ${code}:`, msg);
        if (!fast && settings.store.notifyOnFail) {
            const user = UserStore.getCurrentUser();
            showNotification({
                title: "Redeem Failed ❌",
                body: `${code}: ${msg}`,
                color: "#ED4245",
                icon: user?.getAvatarURL(),
                onClick: () => NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/${messageId}`),
            });
        }
    }
}

export default definePlugin({
    name: "AutoRedeem",
    description: "Automatically redeems any Discord gift link (Nitro, decorations, etc.) sent in any channel.",
    authors: [TestcordDevs.x2b],
    settings,

    start() {
        loadLogs();
        warmupConnection();
        if (!SettingsPlugin.customEntries.some(e => e.key === SETTINGS_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_KEY,
                title: "AutoRedeem Logs",
                Component: require("./components/LogTab").default,
                Icon: LogIcon,
            });
        }
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, e => e.key === SETTINGS_KEY);
        // Drop pending work so a disabled plugin can't resume on next start.
        queue.length = 0;
        processing = false;
        captchaPaused = false;
        pauseToastShown = false;
        void Native?.cancelAll();
    },

    flux: {
        MESSAGE_CREATE({ optimistic, type, message, guildId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (captchaPaused) return;
            if (settings.store.ignoreBots && message.author?.bot) return;
            if (settings.store.ignoreSelf && message.author?.id === UserStore.getCurrentUser()?.id) return;
            if (!message.content) return;
            if (!message.content.includes("gift")) return;

            const codes = [...message.content.matchAll(GIFT_REGEX)].map(m => m[1]);
            if (!codes.length) return;

            for (const code of codes) {
                if (seen.has(code)) continue;
                markSeen(code);
                queue.push({
                    code,
                    channelId: message.channel_id,
                    messageId: message.id,
                    guildId,
                });
            }
            void processQueue();
        },
    },
});
