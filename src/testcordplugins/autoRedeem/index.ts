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
import { ChannelStore, MessageActions, MessageStore, NavigationRouter, PermissionsBits, PermissionStore, RestAPI, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

import { buildCaptchaHeaders, parseCaptchaChallenge } from "./captcha";
import { DEFAULT_CHANNEL_WARMUP_CONCURRENCY, warmupChannels } from "./channelWarmup";
import { isExternalClaimed, onExternalClaimRelease } from "./claimFence";
import { createMessageCodeState, type GiftCodeMessage } from "./giftCodes";
import { addLog, loadLogs, type RedeemType } from "./store";

const Native = VencordNative?.pluginHelpers?.AutoRedeem as PluginNative<typeof import("./native")> | undefined;

const logger = new Logger("AutoRedeem");

const messageCodeState = createMessageCodeState();
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

function classifyGift(data: unknown): RedeemType {
    const value = data as { subscription_plan?: { name?: unknown; }; store_listing?: { sku?: { name?: unknown; }; }; } | null;
    const rawName = value?.subscription_plan?.name ?? value?.store_listing?.sku?.name;
    const name = typeof rawName === "string" ? rawName.toLowerCase() : "";
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
    instantMode: {
        type: OptionType.BOOLEAN,
        description: "Instant Internet Mode: load one newest page from every readable channel, skip prevalidation, and redeem gifts with a rolling worker pool. May increase captcha, rate-limit, or stale-code risk.",
        default: false,
        onChange(value) {
            if (value) requestWarmup();
        },
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
        description: "NoneCap API key for automatically solving CAPTCHAs. Leave empty to retry challenged gifts with backoff.",
        default: "",
        placeholder: "nc_live_...",
        restartNeeded: false,
        onChange(value) {
            if (value.trim()) {
                clearCaptchaRetry();
                captchaRetryAttempt = 0;
            }
            if (value.trim() && captchaPaused) {
                captchaPaused = false;
                pauseToastShown = false;
                pumpQueue();
                requestWarmup();
            }
        },
    },
    webhookUrl: {
        type: OptionType.STRING,
        description: "Discord webhook URL to notify after each redeem attempt. Leave empty to disable.",
        default: "",
        restartNeeded: false,
    },
});

const TERMINAL_CAP = 5000;
const UNCERTAIN_TTL = 10 * 60_000;
const terminalCodes = new Set<string>();
const uncertainUntil = new Map<string, number>();
const uncertainMessages = new Map<string, string>();
interface ActiveJob {
    jobId: number;
    generation: number;
}
const activeJobs = new Map<string, ActiveJob>();
let nextJobId = 1;

function codeKey(code: string) {
    return code.toUpperCase();
}

function rememberTerminal(code: string, uncertain = false, messageId?: string) {
    const key = codeKey(code);
    terminalCodes.delete(key);
    terminalCodes.add(key);
    if (uncertain && messageId) {
        uncertainUntil.set(key, Date.now() + UNCERTAIN_TTL);
        uncertainMessages.set(key, messageId);
    } else {
        uncertainUntil.delete(key);
        uncertainMessages.delete(key);
    }
    while (terminalCodes.size > TERMINAL_CAP) {
        const oldest = terminalCodes.values().next().value;
        if (oldest === undefined) break;
        terminalCodes.delete(oldest);
        uncertainUntil.delete(oldest);
        const messageId = uncertainMessages.get(oldest);
        if (messageId) messageCodeState.release(messageId, oldest);
        uncertainMessages.delete(oldest);
    }
}

function isKnownCode(code: string) {
    const key = codeKey(code);
    const expiry = uncertainUntil.get(key);
    if (expiry !== undefined) {
        if (expiry > Date.now()) return true;
        uncertainUntil.delete(key);
        const messageId = uncertainMessages.get(key);
        if (messageId) messageCodeState.release(messageId, code);
        uncertainMessages.delete(key);
        terminalCodes.delete(key);
    }
    return terminalCodes.has(key) || activeJobs.has(key);
}

const FAST_CONCURRENCY = 5;
const QUEUE_CAP = 1000;
const queue: QueueItem[] = [];
const DEFERRED_CAP = 2000;
type DeferredMessage = { message: Message; guildId?: string; };
const deferredMessages = new Map<string, DeferredMessage>();
const pendingObservations = new Map<string, DeferredMessage>();
let drainingDeferred = false;
let running = 0;
let generation = 0;
let started = false;
let nextSerialStart = 0;
let pumpTimer: ReturnType<typeof setTimeout> | undefined;
let pumpTimerAt = 0;
let captchaPaused = false;
const CAPTCHA_RETRY_DELAYS = [5_000, 15_000, 60_000, 300_000];
let captchaRetryTimer: ReturnType<typeof setTimeout> | undefined;
let captchaRetryAttempt = 0;
let blockedUntil = 0;
let pauseToastShown = false;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;
let queueFullWarningShown = false;
let deferredLimitWarningShown = false;
type CaptchaSolveResult = { success: boolean; token?: string; error?: string };
let captchaSolvePromise: Promise<CaptchaSolveResult> | null = null;

interface QueueItem {
    jobId: number;
    generation: number;
    code: string;
    channelId: string;
    messageId: string;
    guildId?: string;
    authorId?: string;
    authorBot?: boolean;
    readyAt?: number;
    submitted?: boolean;
    uncertain?: boolean;
}

function isPaused() {
    return captchaPaused || blockedUntil > Date.now();
}

function schedulePump(delay = 0) {
    const target = Date.now() + Math.max(0, delay);
    if (pumpTimer !== undefined) {
        if (target >= pumpTimerAt) return;
        clearTimeout(pumpTimer);
    }
    pumpTimerAt = target;
    pumpTimer = setTimeout(() => {
        pumpTimer = undefined;
        pumpTimerAt = 0;
        pumpQueue();
    }, Math.max(0, target - Date.now()));
}

function getConcurrency() {
    return settings.store.instantMode || settings.store.speedMode ? FAST_CONCURRENCY : 1;
}

function pumpQueue() {
    if (!started || isPaused()) return;
    drainDeferredMessages();

    const fast = settings.store.instantMode || settings.store.speedMode;
    if (!fast && running === 0 && queue.length > 0) {
        const wait = nextSerialStart - Date.now();
        if (wait > 0) {
            schedulePump(wait);
            return;
        }
        nextSerialStart = Date.now() + jitter(1, 1200);
    }

    while (running < getConcurrency() && queue.length > 0) {
        const now = Date.now();
        const index = queue.findIndex(item => !item.readyAt || item.readyAt <= now);
        if (index < 0) {
            let nextReady = now;
            for (const candidate of queue) {
                if (candidate.readyAt != null && candidate.readyAt > nextReady) nextReady = candidate.readyAt;
            }
            schedulePump(nextReady - now);
            return;
        }

        const [item] = queue.splice(index, 1);
        running++;
        void handleRedeem(item, item.generation)
            .catch(error => logger.error("AutoRedeem worker failed:", error))
            .finally(() => {
                if (item.generation === generation) {
                    running--;
                    drainDeferredMessages();
                    pumpQueue();
                } else {
                    if (activeJobs.get(codeKey(item.code))?.jobId === item.jobId) {
                        if (item.uncertain) rememberTerminal(item.code, true, item.messageId);
                        activeJobs.delete(codeKey(item.code));
                    }
                    if (started) {
                        drainDeferredMessages();
                        pumpQueue();
                    }
                }
            });
    }
    if (queue.length === 0) queueFullWarningShown = false;
}

function requeueItem(item: QueueItem, readyAt: number) {
    if (!started || item.generation !== generation) return;
    item.readyAt = Math.max(item.readyAt ?? 0, readyAt);
    if (queue.length + running > QUEUE_CAP) logger.debug("AutoRedeem retry temporarily exceeds the queue budget.");
    queue.push(item);
    schedulePump(Math.max(0, item.readyAt - Date.now()));
}

function finishItem(item: QueueItem) {
    if (activeJobs.get(codeKey(item.code))?.jobId === item.jobId) {
        activeJobs.delete(codeKey(item.code));
        rememberTerminal(item.code, item.uncertain === true, item.messageId);
    }
}

function jitter(minMs: number, maxMs: number) {
    return minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs));
}

type ErrorBody = Record<string, unknown>;

// Fire a lightweight request on start to warm up DNS + TLS session for discord.com.
// Subsequent requests reuse the cached connection, cutting first-request latency.
function warmupConnection() {
    TestcordRequestCoordinator.request({
        key: "discord:warmup:users-me",
        ttlMs: 10_000,
        run: () => RestAPI.get({ url: "/users/@me" }),
    }).catch(error => logger.debug("AutoRedeem connection warmup failed:", error));
}

function getRetryAt(error: unknown): number {
    const value = error as { status?: number; body?: { retry_after?: number }; headers?: { "retry-after"?: string } };
    const retryAfter = Number(value?.body?.retry_after ?? value?.headers?.["retry-after"] ?? 0);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(retryAfter * 1000, 1000) : 1000;
    return Date.now() + waitMs;
}

function clearPendingQueue() {
    for (const item of queue) cancelItem(item);
    queue.length = 0;
}

function clearCaptchaRetry() {
    if (captchaRetryTimer !== undefined) clearTimeout(captchaRetryTimer);
    captchaRetryTimer = undefined;
}

function pauseForCaptcha(reason: string, retryLater: boolean) {
    captchaPaused = true;
    if (!pauseToastShown) {
        pauseToastShown = true;
        showToast(`AutoRedeem paused: ${reason}`, Toasts.Type.FAILURE);
        logger.warn(`Paused: ${reason}`);
    }
    if (!retryLater || captchaRetryTimer !== undefined) return;

    const delay = CAPTCHA_RETRY_DELAYS[Math.min(captchaRetryAttempt, CAPTCHA_RETRY_DELAYS.length - 1)];
    captchaRetryAttempt++;
    captchaRetryTimer = setTimeout(() => {
        captchaRetryTimer = undefined;
        if (!started || !captchaPaused) return;
        captchaPaused = false;
        pauseToastShown = false;
        pumpQueue();
        requestWarmup();
    }, delay);
}

function notifyPaused(reason: string, resumeAt: number) {
    const pauseGeneration = generation;
    blockedUntil = Math.max(blockedUntil, resumeAt);

    if (!pauseToastShown) {
        pauseToastShown = true;
        showToast(`AutoRedeem paused: ${reason}`, Toasts.Type.FAILURE);
        logger.warn(`Paused: ${reason}`);
    }

    if (resumeTimer !== undefined) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
        resumeTimer = undefined;
        if (!started || pauseGeneration !== generation) return;
        if (Date.now() < blockedUntil) {
            notifyPaused(reason, blockedUntil);
            return;
        }
        blockedUntil = 0;
        if (!captchaPaused) pauseToastShown = false;
        pumpQueue();
        if (!captchaPaused) requestWarmup();
    }, Math.max(0, blockedUntil - Date.now()));
}

function resumeAfterCaptcha() {
    clearCaptchaRetry();
    captchaRetryAttempt = 0;
    captchaPaused = false;
    captchaSolvePromise = null;
    pauseToastShown = false;
    pumpQueue();
    requestWarmup();
}

async function trySolveCaptcha(sitekey: string, rqdata: string | undefined, pageUrl: string): Promise<CaptchaSolveResult> {
    const apiKey = settings.store.noneCapApiKey.trim();
    if (!apiKey || !Native) return { success: false, error: "" };

    return Native.solveCaptcha(apiKey, sitekey, rqdata, pageUrl, navigator.userAgent);
}

function sendClaimWebhook(code: string, status: "claimed" | "failed", giftType: string | null, channelId: string, messageId: string, guildId: string | undefined, error?: string) {
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

    void Native?.sendWebhook(url, JSON.stringify(payload)).catch(error => logger.debug("AutoRedeem webhook failed:", error));
}

async function precheckGift(code: string): Promise<{ ok: boolean; data?: GiftPrecheckBody; reason?: string; retryAt?: number; captcha?: boolean; }> {
    try {
        const { body } = await TestcordRequestCoordinator.request<{ body?: GiftPrecheckBody; }>({
            key: `discord:gift-precheck:${code}`,
            ttlMs: 60_000,
            run: () => RestAPI.get({
                url: `/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`,
                retries: 0,
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
    } catch (error: unknown) {
        const body = getErrorBody(error);
        const status = Number((error as { status?: number; })?.status ?? 0);
        if (parseCaptchaChallenge(body, status)) {
            return { ok: true, captcha: true, reason: "captcha required" };
        }
        const msg = typeof body?.message === "string" ? body.message : "";
        const codeName = typeof body?.code === "string" ? body.code : "";
        if (status === 429 || status >= 500) {
            return { ok: false, reason: "precheck rate limited", retryAt: getRetryAt(error) };
        }
        if (status === 404 || /unknown/i.test(msg) || /invalid/i.test(msg)) {
            return { ok: false, reason: "invalid code" };
        }
        return { ok: true, reason: codeName || msg || undefined };
    }
}

function isCurrentJob(item: QueueItem, jobGeneration: number) {
    return started && jobGeneration === generation && item.generation === generation;
}

function getErrorBody(error: unknown): ErrorBody | undefined {
    const body = (error as { body?: unknown; })?.body;
    return body && typeof body === "object" ? body as ErrorBody : undefined;
}

function getErrorMessage(error: unknown): string {
    const message = getErrorBody(error)?.message;
    return typeof message === "string" && message ? message : "Unknown error";
}

async function completeRedeem(item: QueueItem, body: unknown, jobGeneration: number) {
    if (!isCurrentJob(item, jobGeneration)) {
        finishItem(item);
        return;
    }
    const { code, channelId, messageId, guildId } = item;
    const giftType = classifyGift(body);
    finishItem(item);
    const fast = settings.store.speedMode || settings.store.instantMode;
    try {
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
        sendClaimWebhook(code, "claimed", giftType, channelId, messageId, guildId);
    } catch (error) {
        logger.error("AutoRedeem post-success side effects failed:", error);
    }
}

async function failItem(item: QueueItem, reason: string, jobGeneration: number) {
    if (!isCurrentJob(item, jobGeneration)) return;
    const { code, channelId, messageId, guildId } = item;
    finishItem(item);
    const fast = settings.store.speedMode || settings.store.instantMode;
    try {
        addLog({ code, status: "failed", type: "other", error: reason, channelId, messageId });
        if (!fast && settings.store.notifyOnFail) {
            showToast(`Failed to redeem ${code}: ${reason}`, Toasts.Type.FAILURE);
        }
        logger.warn(`Failed to redeem ${code}: ${reason}`);
        if (!fast && settings.store.notifyOnFail) {
            const user = UserStore.getCurrentUser();
            showNotification({
                title: "Redeem Failed ❌",
                body: `${code}: ${reason}`,
                color: "#ED4245",
                icon: user?.getAvatarURL(),
                onClick: () => NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/${messageId}`),
            });
        }
        sendClaimWebhook(code, "failed", "other", channelId, messageId, guildId, reason);
    } catch (error) {
        logger.error("AutoRedeem failure side effects failed:", error);
    }
}

async function handleRedeemError(item: QueueItem, error: unknown, jobGeneration: number, captchaAttempted = false) {
    const body = getErrorBody(error);
    const status = Number((error as { status?: number; })?.status ?? 0);
    const challenge = parseCaptchaChallenge(body, status);
    const wasSubmitted = item.submitted === true;

    if (!isCurrentJob(item, jobGeneration)) {
        if (status === 429 || challenge || (wasSubmitted && status >= 400 && status < 500)) item.submitted = false;
        else if (wasSubmitted && (status === 0 || status >= 500)) item.uncertain = true;
        return;
    }

    const { code, channelId } = item;
    if (challenge && !captchaAttempted) {
        if (captchaPaused || captchaSolvePromise) {
            requeueItem(item, Date.now() + 1000);
            return;
        }

        pauseForCaptcha("captcha required", false);
        const apiKey = settings.store.noneCapApiKey.trim();
        if (challenge.service === "hcaptcha" && challenge.sitekey && apiKey) {
            let solveResult: CaptchaSolveResult;
            const solvePromise = captchaSolvePromise ??= trySolveCaptcha(challenge.sitekey, challenge.rqdata, location.href);
            try {
                solveResult = await solvePromise;
            } catch (error) {
                logger.warn(`NoneCap solve failed for ${code}:`, error);
                pauseForCaptcha("captcha required", true);
                requeueItem(item, Date.now() + 1000);
                return;
            } finally {
                if (captchaSolvePromise === solvePromise) captchaSolvePromise = null;
            }
            if (!isCurrentJob(item, jobGeneration)) return;
            if (!isMessageCodeCurrent(item) || !isItemAllowed(item)) {
                cancelItem(item);
                resumeAfterCaptcha();
                return;
            }
            if (solveResult.success && solveResult.token) {
                let headers: Record<string, string>;
                try {
                    headers = buildCaptchaHeaders(solveResult.token, challenge);
                } catch (error) {
                    logger.warn(`NoneCap returned an invalid CAPTCHA token for ${code}:`, error);
                    pauseForCaptcha("captcha required", true);
                    requeueItem(item, Date.now() + 1000);
                    return;
                }
                try {
                    const result = await RestAPI.post({
                        url: `/entitlements/gift-codes/${code}/redeem`,
                        retries: 0,
                        headers,
                        body: { channel_id: channelId },
                    });
                    await completeRedeem(item, result.body, jobGeneration);
                    if (isCurrentJob(item, jobGeneration)) resumeAfterCaptcha();
                    return;
                } catch (retryError) {
                    if (!isCurrentJob(item, jobGeneration)) return handleRedeemError(item, retryError, jobGeneration, true);
                    captchaPaused = false;
                    pauseToastShown = false;
                    return handleRedeemError(item, retryError, jobGeneration, true);
                }
            }
            if (solveResult.error) logger.warn(`NoneCap solve failed for ${code}: ${solveResult.error}`);
        }
        pauseForCaptcha("captcha required", true);
        requeueItem(item, Date.now() + 1000);
        return;
    }

    if (status === 429) {
        item.submitted = false;
        const retryAt = getRetryAt(error);
        notifyPaused(`rate limited (retry at ${new Date(retryAt).toISOString()})`, retryAt);
        requeueItem(item, retryAt);
        return;
    }

    if (challenge) {
        if (captchaAttempted) logger.warn("CAPTCHA retry was challenged again; the retry headers may not have been accepted.");
        pauseForCaptcha("captcha required", true);
        requeueItem(item, Date.now() + 1000);
        return;
    }

    if (status === 0 || status >= 500) {
        item.uncertain = true;
        await failItem(item, `uncertain: ${getErrorMessage(error)}`, jobGeneration);
        return;
    }

    item.submitted = false;
    await failItem(item, getErrorMessage(error), jobGeneration);
}

async function handleRedeem(item: QueueItem, jobGeneration: number) {
    if (!isCurrentJob(item, jobGeneration)) return;
    if (!isMessageCodeCurrent(item) || !isItemAllowed(item)) {
        cancelItem(item);
        return;
    }
    const { code, channelId, messageId, guildId } = item;
    const fast = settings.store.speedMode || settings.store.instantMode;
    const skipPrecheck = settings.store.instantMode
        || (fast && TestcordRequestCoordinator.aggressiveNetworkEnabled());

    if (!skipPrecheck && (fast || settings.store.prevalidate)) {
        const pre = await precheckGift(code);
        if (!isCurrentJob(item, jobGeneration)) return;
        if (!pre.captcha && !pre.ok) {
            if (pre.retryAt) {
                notifyPaused("precheck rate limited", pre.retryAt);
                requeueItem(item, pre.retryAt);
                return;
            }
            const reason = pre.reason ?? "unredeemable";
            if (reason === "captcha required") {
                pauseForCaptcha("captcha required", true);
                requeueItem(item, Date.now() + 1000);
                return;
            }
            await failItem(item, reason, jobGeneration);
            return;
        }
    }

    if (!isCurrentJob(item, jobGeneration)) return;
    if (!isMessageCodeCurrent(item) || !isItemAllowed(item)) {
        cancelItem(item);
        return;
    }
    if (isPaused()) {
        requeueItem(item, Math.max(Date.now() + 1000, blockedUntil));
        return;
    }
    if (isExternalClaimed(code)) {
        requeueItem(item, Date.now() + 1000);
        return;
    }

    item.submitted = true;
    try {
        const result = await RestAPI.post({
            url: `/entitlements/gift-codes/${code}/redeem`,
            retries: 0,
            body: { channel_id: channelId },
        });
        await completeRedeem(item, result.body, jobGeneration);
    } catch (error) {
        await handleRedeemError(item, error, jobGeneration);
    }
}

function isMessageCodeCurrent(item: QueueItem) {
    return messageCodeState.codesForMessage(item.messageId).some(code => code.toUpperCase() === item.code.toUpperCase());
}

function cancelItem(item: QueueItem) {
    if (activeJobs.get(codeKey(item.code))?.jobId === item.jobId) {
        messageCodeState.release(item.messageId, item.code);
        activeJobs.delete(codeKey(item.code));
    }
}

function isItemAllowed(item: QueueItem) {
    let { authorId, authorBot } = item;
    if ((settings.store.ignoreBots || settings.store.ignoreSelf) && !authorId) {
        try {
            const message = MessageStore.getMessage(item.channelId, item.messageId);
            authorId = message?.author?.id ?? authorId;
            authorBot = message?.author?.bot ?? authorBot;
        } catch (error) {
            logger.debug("AutoRedeem could not refresh message author:", error);
        }
    }
    if (settings.store.ignoreBots && authorBot) return false;
    if (settings.store.ignoreSelf && authorId && authorId === UserStore.getCurrentUser()?.id) return false;
    return true;
}

function retainDeferredMessage(message: Message, guildId?: string) {
    if (deferredMessages.has(message.id)) {
        deferredMessages.set(message.id, { message, guildId });
        return;
    }
    if (deferredMessages.size >= DEFERRED_CAP) {
        if (!deferredLimitWarningShown) {
            deferredLimitWarningShown = true;
            logger.error("AutoRedeem deferred-message memory limit reached; new overflow messages will be dropped.");
        }
        return;
    }
    deferredMessages.set(message.id, { message, guildId });
}

function rememberPendingObservation(code: string, message: Message, guildId?: string) {
    pendingObservations.set(codeKey(code), { message, guildId });
}

function drainPendingObservations() {
    if (!started || isPaused() || pendingObservations.size === 0) return;
    for (const [code, observation] of [...pendingObservations]) {
        if (isPaused()) return;
        if (isExternalClaimed(code)) continue;
        const active = activeJobs.get(codeKey(code));
        if (active && active.generation !== generation) continue;
        pendingObservations.delete(code);
        enqueueGifts(observation.message, observation.guildId);
    }
}

function enqueueGifts(message: any, guildId?: string) {
    if (!started || !message || message.deleted || message.state === "SENDING") return;
    if (!message.channel_id || !message.id) return;
    if (!Array.isArray(message.giftCodes) && typeof message.content !== "string") return;

    let { author } = message;
    if (!author && (settings.store.ignoreBots || settings.store.ignoreSelf)) {
        try {
            author = MessageStore.getMessage(message.channel_id, message.id)?.author;
        } catch (error) {
            logger.debug("AutoRedeem could not read message author:", error);
        }
    }
    if (settings.store.ignoreBots && author?.bot) return;
    if (settings.store.ignoreSelf && author?.id === UserStore.getCurrentUser()?.id) return;

    const currentCodes = messageCodeState.codesForMessage(message.id);
    for (const code of currentCodes) isKnownCode(code);
    const freshCodes = messageCodeState.sync(message as GiftCodeMessage, { emit: false });
    const observedCodes = new Set([...currentCodes, ...freshCodes]);
    const oldActiveCodes = [...observedCodes].filter(code => {
        const active = activeJobs.get(codeKey(code));
        return active && active.generation !== generation;
    });
    const externalCodes = freshCodes.filter(isExternalClaimed);
    if (oldActiveCodes.length > 0 || externalCodes.length > 0) {
        for (const code of [...oldActiveCodes, ...externalCodes]) rememberPendingObservation(code, message, guildId);
        return;
    }
    const candidates = freshCodes.filter(code => !isKnownCode(code));
    if (candidates.length === 0) {
        deferredMessages.delete(message.id);
        return;
    }
    if (captchaPaused) {
        retainDeferredMessage(message, guildId);
        return;
    }
    const available = Math.max(0, QUEUE_CAP - queue.length - running);
    const accepted = candidates.slice(0, available);
    if (accepted.length < candidates.length) {
        retainDeferredMessage(message, guildId);
        if (!queueFullWarningShown) {
            queueFullWarningShown = true;
            logger.warn(`AutoRedeem queue is full; deferred ${candidates.length - accepted.length} gift code(s)`);
        }
    }
    if (accepted.length === 0) return;
    if (accepted.length === candidates.length) deferredMessages.delete(message.id);
    for (const code of accepted) {
        messageCodeState.claim(message.id, code);
        if (isKnownCode(code)) continue;
        const jobId = nextJobId++;
        activeJobs.set(codeKey(code), { jobId, generation });
        queue.push({
            jobId,
            generation,
            code,
            channelId: message.channel_id,
            messageId: message.id,
            guildId: guildId ?? message.guild_id,
            authorId: author?.id,
            authorBot: author?.bot === true,
        });
    }
    pumpQueue();
}

function drainDeferredMessages() {
    if (!started || isPaused() || drainingDeferred) return;
    drainingDeferred = true;
    try {
        drainPendingObservations();
        if (isPaused()) return;
        for (const deferred of [...deferredMessages.values()]) {
            if (queue.length + running >= QUEUE_CAP) break;
            enqueueGifts(deferred.message, deferred.guildId);
        }
    } finally {
        drainingDeferred = false;
        if (deferredMessages.size < DEFERRED_CAP) deferredLimitWarningShown = false;
    }
}

function latestMessages(messages: Message[], limit: number) {
    return [...messages].sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0).slice(0, limit);
}

function waitForMessages(channelId: string) {
    if (typeof MessageStore.isLoadingMessages !== "function" || !MessageStore.isLoadingMessages(channelId)) return Promise.resolve();
    return new Promise<void>(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            warmupWaitTimers.delete(timeout);
            warmupWaitResolvers.delete(finish);
            resolve();
        };
        const timeout = setTimeout(finish, 5_000);
        warmupWaitTimers.add(timeout);
        warmupWaitResolvers.add(finish);
        try {
            MessageStore.whenReady(channelId, finish);
            if (!MessageStore.isLoadingMessages(channelId)) finish();
        } catch (error) {
            logger.debug(`AutoRedeem could not wait for channel ${channelId}:`, error);
            finish();
        }
    });
}

const WARMUP_CHANNEL_BUDGET = 50;
const WARMUP_STALE_MS = 5 * 60_000;
let warmupRunning = false;
let warmupPending = false;
let warmupRunId = 0;
let activeWarmupRun = 0;
let warmupBlockedUntil = 0;
let warmupRetryTimer: ReturnType<typeof setTimeout> | undefined;
let warmupBatchTimer: ReturnType<typeof setTimeout> | undefined;
const lastWarmedAt = new Map<string, number>();
const warmupWaitTimers = new Set<ReturnType<typeof setTimeout>>();
const warmupWaitResolvers = new Set<() => void>();
let warmupCursor = 0;
let warmupRunCurrentIncluded = false;

function pauseWarmup(retryAt: number) {
    const pauseGeneration = generation;
    const previousDeadline = warmupBlockedUntil;
    warmupBlockedUntil = Math.max(warmupBlockedUntil, retryAt);
    if (warmupRetryTimer !== undefined) clearTimeout(warmupRetryTimer);
    warmupRetryTimer = setTimeout(() => {
        warmupRetryTimer = undefined;
        if (!started || pauseGeneration !== generation) return;
        if (Date.now() < warmupBlockedUntil) {
            pauseWarmup(warmupBlockedUntil);
            return;
        }
        warmupBlockedUntil = 0;
        requestWarmup();
    }, Math.max(0, warmupBlockedUntil - Date.now()));
    if (warmupBlockedUntil > previousDeadline) logger.warn(`AutoRedeem channel warmup paused until ${new Date(warmupBlockedUntil).toISOString()}.`);
}

function scheduleNextWarmup() {
    if (!started || captchaPaused || !settings.store.instantMode || warmupBatchTimer !== undefined || warmupBlockedUntil > Date.now() || blockedUntil > Date.now()) return;
    try {
        if (warmupCursor >= ChannelStore.getChannelIds().length) return;
    } catch (error) {
        logger.debug("AutoRedeem could not count channels for warmup:", error);
        return;
    }
    const jobGeneration = generation;
    warmupBatchTimer = setTimeout(() => {
        warmupBatchTimer = undefined;
        if (started && jobGeneration === generation) requestWarmup();
    }, 500);
}

function requestWarmup() {
    if (!started || captchaPaused || !settings.store.instantMode || warmupBlockedUntil > Date.now() || blockedUntil > Date.now()) return;
    try {
        if (warmupCursor >= ChannelStore.getChannelIds().length) warmupCursor = 0;
    } catch (error) {
        logger.debug("AutoRedeem could not count channels for warmup:", error);
        return;
    }
    if (warmupRunning) {
        warmupPending = true;
        return;
    }
    void warmChannels(generation);
}

async function warmChannels(jobGeneration = generation) {
    if (!started || captchaPaused || jobGeneration !== generation || !settings.store.instantMode || warmupBlockedUntil > Date.now() || blockedUntil > Date.now()) return;
    if (warmupRunning) {
        warmupPending = true;
        return;
    }
    if (typeof MessageActions.fetchMessages !== "function") return;
    const runId = ++warmupRunId;
    activeWarmupRun = runId;
    warmupRunCurrentIncluded = false;
    warmupRunning = true;
    let attempted = 0;
    let unique = 0;
    let completed = false;
    try {
        if (typeof ChannelStore.loadAllGuildAndPrivateChannelsFromDisk === "function") {
            await ChannelStore.loadAllGuildAndPrivateChannelsFromDisk();
        }
        if (!started || jobGeneration !== generation || !settings.store.instantMode) return;
        const result = await warmupChannels({
            enumerateChannels: function* () {
                const ids = ChannelStore.getChannelIds();
                const currentId = SelectedChannelStore.getChannelId();
                const hasCurrent = Boolean(currentId && ids.includes(currentId));
                warmupRunCurrentIncluded = hasCurrent;
                const otherIds = hasCurrent ? ids.filter(id => id !== currentId) : ids;
                const offset = otherIds.length > 0 ? warmupCursor % otherIds.length : 0;
                const rotated = otherIds.length > 0 ? [...otherIds.slice(offset), ...otherIds.slice(0, offset)] : otherIds;
                const ordered = hasCurrent && currentId ? [currentId, ...rotated] : rotated;
                for (let index = 0; index < ordered.length; index++) {
                    const id = ordered[index];
                    try {
                        const channel = ChannelStore.getChannel(id);
                        if (channel) yield channel;
                    } catch (error) {
                        logger.debug(`AutoRedeem could not inspect channel ${id}:`, error);
                    }
                }
            },
            getCurrentChannelId: () => SelectedChannelStore.getChannelId(),
            canReadChannel: channel => {
                if (channel.type === 4 || channel.type === 15) return false;
                if (!channel.guild_id) return true;
                return PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)
                    && PermissionStore.can(PermissionsBits.READ_MESSAGE_HISTORY, channel);
            },
            isChannelFetched: channelId => MessageStore.getMessages(channelId)?.hasFetched ?? false,
            isChannelLoading: channelId => MessageStore.isLoadingMessages(channelId),
            getPriority: channel => channel.id === SelectedChannelStore.getChannelId()
                ? 0
                : channel.guild_id ? 2 : 1,
            fetchMessages: async request => {
                let cached = MessageStore.getMessages(request.channelId);
                if (cached?.loadingMore) await waitForMessages(request.channelId);
                cached = MessageStore.getMessages(request.channelId);
                const lastWarmed = lastWarmedAt.get(request.channelId);
                const cacheIsFresh = lastWarmed !== undefined && Date.now() - lastWarmed < WARMUP_STALE_MS;
                if (cached?.loadingMore && (cached._array?.length ?? 0) > 0) return latestMessages(cached._array ?? [], request.limit);
                if (cached?.hasFetched && cacheIsFresh) return latestMessages(cached._array ?? [], request.limit);
                await MessageActions.fetchMessages({ channelId: request.channelId, limit: request.limit });
                if (started && jobGeneration === generation) lastWarmedAt.set(request.channelId, Date.now());
                return latestMessages(MessageStore.getMessages(request.channelId)?._array ?? [], request.limit);
            },
            onMessages: (channelId, messages) => {
                const guildId = ChannelStore.getChannel(channelId)?.guild_id;
                for (const message of messages) enqueueGifts(message, guildId);
            },
            onError: (_channelId, error) => {
                const status = Number((error as { status?: number; })?.status ?? 0);
                if (status === 429 || getErrorBody(error)?.retry_after != null) pauseWarmup(getRetryAt(error));
            },
            isCurrent: () => started && jobGeneration === generation && settings.store.instantMode && !isPaused() && warmupBlockedUntil <= Date.now(),
            concurrency: DEFAULT_CHANNEL_WARMUP_CONCURRENCY,
            maxChannels: WARMUP_CHANNEL_BUDGET,
            processFetched: true,
        });
        attempted = result.attempted;
        unique = result.unique;
        completed = !result.stopped;
        logger.debug(`AutoRedeem channel warmup finished: ${result.processed} processed, ${result.failed} failed`);
    } catch (error) {
        logger.debug("AutoRedeem channel warmup failed:", error);
    } finally {
        if (activeWarmupRun !== runId) return;
        warmupRunning = false;
        if (jobGeneration === generation) {
            const consumed = completed ? unique : attempted;
            if (consumed > 0) warmupCursor += consumed - (warmupRunCurrentIncluded ? 1 : 0);
            if (warmupPending && settings.store.instantMode) {
                warmupPending = false;
                void warmChannels(generation);
            } else {
                scheduleNextWarmup();
            }
        } else {
            warmupPending = false;
            if (started && settings.store.instantMode) {
                warmupPending = true;
                void warmChannels(generation);
            }
        }
    }
}

onExternalClaimRelease(() => {
    if (!started) return;
    drainDeferredMessages();
    pumpQueue();
});

export default definePlugin({
    name: "AutoRedeem",
    description: "Automatically redeems any Discord gift link (Nitro, decorations, etc.) sent in any channel.",
    authors: [TestcordDevs.x2b],
    settings,

    start() {
        started = true;
        generation++;
        running = 0;
        nextSerialStart = 0;
        queue.length = 0;
        drainingDeferred = false;
        clearCaptchaRetry();
        captchaRetryAttempt = 0;
        captchaPaused = false;
        blockedUntil = 0;
        pauseToastShown = false;
        queueFullWarningShown = false;
        warmupPending = false;
        if (pumpTimer !== undefined) clearTimeout(pumpTimer);
        if (resumeTimer !== undefined) clearTimeout(resumeTimer);
        pumpTimer = undefined;
        pumpTimerAt = 0;
        resumeTimer = undefined;
        messageCodeState.reset();
        drainDeferredMessages();
        pumpQueue();
        void loadLogs();
        warmupConnection();
        if (settings.store.instantMode) requestWarmup();
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
        started = false;
        generation++;
        clearPendingQueue();
        if (deferredMessages.size > 0) logger.debug(`AutoRedeem discarded ${deferredMessages.size} deferred message(s) while stopping.`);
        deferredMessages.clear();
        drainingDeferred = false;
        running = 0;
        clearCaptchaRetry();
        captchaRetryAttempt = 0;
        captchaPaused = false;
        blockedUntil = 0;
        pauseToastShown = false;
        captchaSolvePromise = null;
        warmupPending = false;
        lastWarmedAt.clear();
        warmupCursor = 0;
        warmupRunId++;
        warmupBlockedUntil = 0;
        if (warmupRetryTimer !== undefined) clearTimeout(warmupRetryTimer);
        warmupRetryTimer = undefined;
        for (const resolver of warmupWaitResolvers) resolver();
        warmupWaitResolvers.clear();
        for (const timer of warmupWaitTimers) clearTimeout(timer);
        warmupWaitTimers.clear();
        if (warmupBatchTimer !== undefined) clearTimeout(warmupBatchTimer);
        warmupBatchTimer = undefined;
        if (pumpTimer !== undefined) clearTimeout(pumpTimer);
        if (resumeTimer !== undefined) clearTimeout(resumeTimer);
        pumpTimer = undefined;
        pumpTimerAt = 0;
        resumeTimer = undefined;
        removeFromArray(SettingsPlugin.customEntries, e => e.key === SETTINGS_KEY);
        void Native?.cancelAll();
    },

    flux: {
        MESSAGE_CREATE({ optimistic, type, message, guildId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            enqueueGifts(message, guildId);
        },
        MESSAGE_UPDATE({ message, guildId }: { message: any; guildId?: string; }) {
            enqueueGifts(message, guildId);
        },
        MESSAGE_DELETE({ id }: { id: string; }) {
            deferredMessages.delete(id);
            for (const [code, observation] of pendingObservations) {
                if (observation.message.id === id) pendingObservations.delete(code);
            }
            messageCodeState.remove(id);
        },
        MESSAGE_DELETE_BULK({ ids }: { ids: string[]; }) {
            for (const id of ids) {
                deferredMessages.delete(id);
                for (const [code, observation] of pendingObservations) {
                    if (observation.message.id === id) pendingObservations.delete(code);
                }
                messageCodeState.remove(id);
            }
        },
    },
});
