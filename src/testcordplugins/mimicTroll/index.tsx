/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, Menu, Toasts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Toggle mimicking on/off without disabling the plugin",
        default: true,
        onChange: (value: boolean) => {
            if (!value) try { mimicManager.clearQueue(); } catch { }
        }
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Delay before sending mimic message (milliseconds)",
        default: 1000,
        validators: [value => value >= 500 && value <= 10000]
    },
    messageTemplate: {
        type: OptionType.STRING,
        description: "Message template. Use {mimic} as placeholder for the mimicked message",
        default: "{mimic}",
    },
    showMimicStatus: {
        type: OptionType.BOOLEAN,
        description: "Show status messages when starting/stopping mimic",
        default: true,
    },
    customBlockedWords: {
        type: OptionType.STRING,
        description: "Extra comma-separated words to block beyond the built-in list",
        default: "",
    },
    blockedResponse: {
        type: OptionType.STRING,
        description: "Message to send when content is blocked",
        default: "Nice try buddy",
    }
});

interface MimicTarget {
    userId: string;
    username: string;
    channelId: string;
    active: boolean;
    startTime: number;
}

const processedMessageIds = new Set<string>();

class ContentFilter {
    // Core prohibited terms
    private static readonly BLOCKED_TERMS = [
        // Age-related inappropriate content
        "underage", "under age", "minor", "child", "kid", "young", "teen", "teenager",
        "cp", "c p", "child porn", "childporn", "loli", "shota", "pedo", "pedophile",
        "im underage", "i'm underage", "i am underage", "13", "14", "15", "16",
        "years old", "yo ", " yo", "age verification", "jailbait", "12", "11", "10",

        // Add other categories as needed
        "illegal", "drugs", "weapons", "harm", "suicide", "self harm", "nigger", "sped", "kys"
    ];

    // Unicode character mappings for bypass detection
    private static readonly UNICODE_REPLACEMENTS: { [key: string]: string; } = {
        // Cyrillic look-alikes
        "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
        "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
        "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X",

        // Greek look-alikes
        "α": "a", "β": "b", "γ": "y", "δ": "d", "ε": "e", "ζ": "z", "η": "n",
        "θ": "o", "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "v", "ξ": "e",
        "ο": "o", "π": "n", "ρ": "p", "σ": "o", "τ": "t", "υ": "y", "φ": "o",
        "χ": "x", "ψ": "y", "ω": "w",

        // Mathematical and other Unicode
        "𝐚": "a", "𝐛": "b", "𝐜": "c", "𝐝": "d", "𝐞": "e", "𝐟": "f", "𝐠": "g",
        "𝐡": "h", "𝐢": "i", "𝐣": "j", "𝐤": "k", "𝐥": "l", "𝐦": "m", "𝐧": "n",
        "𝐨": "o", "𝐩": "p", "𝐪": "q", "𝐫": "r", "𝐬": "s", "𝐭": "t", "𝐮": "u",
        "𝐯": "v", "𝐰": "w", "𝐱": "x", "𝐲": "y", "𝐳": "z",

        // Full-width characters
        "ａ": "a", "ｂ": "b", "ｃ": "c", "ｄ": "d", "ｅ": "e", "ｆ": "f", "ｇ": "g",
        "ｈ": "h", "ｉ": "i", "ｊ": "j", "ｋ": "k", "ｌ": "l", "ｍ": "m", "ｎ": "n",
        "ｏ": "o", "ｐ": "p", "ｑ": "q", "ｒ": "r", "ｓ": "s", "ｔ": "t", "ｕ": "u",
        "ｖ": "v", "ｗ": "w", "ｘ": "x", "ｙ": "y", "ｚ": "z",

        // Numbers and symbols often used in bypasses
        "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
        "@": "a", "$": "s", "!": "i", "|": "l", "()": "o", "[]": "o",

        // Zero-width and invisible characters
        "\u200B": "", "\u200C": "", "\u200D": "", "\uFEFF": "", "\u2060": "",
        "\u00A0": " ", "\u2000": " ", "\u2001": " ", "\u2002": " ", "\u2003": " ",
        "\u2004": " ", "\u2005": " ", "\u2006": " ", "\u2007": " ", "\u2008": " ",
        "\u2009": " ", "\u200A": " ",
    };

    // Precomputed single-pass look-alike regex. Built once instead of ~80 regexes per call.
    // All look-alike keys are single literal characters, so output is identical to the
    // original per-key replacement loop, just faster.
    private static readonly LOOKALIKE_REGEX = new RegExp(
        Object.keys(ContentFilter.UNICODE_REPLACEMENTS)
            .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|"),
        "g"
    );

    // NOTE: ordering is intentional and must stay this way. Punctuation is stripped to spaces
    // BEFORE the leet pass, which means the symbol leet keys (@ $ ! |) never reach it. They are
    // effectively inert. Reordering so they fire would mangle digit blocked terms like "13" into
    // "ie" and "15" into "is", flooding the filter with false positives on a child-safety path.
    // Do not reorder without a test harness.
    private static readonly LEET_MAP: { [key: string]: string; } = {
        "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
        "@": "a", "$": "s", "!": "i", "|": "l", "ph": "f", "ck": "k"
    };

    private static readonly LEET_REGEX = new RegExp(
        Object.keys(ContentFilter.LEET_MAP)
            .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|"),
        "g"
    );

    private static baseNormalize(text: string): string {
        let normalized = text.toLowerCase();
        normalized = normalized.replace(this.LOOKALIKE_REGEX, m => this.UNICODE_REPLACEMENTS[m]);
        normalized = normalized.replace(/[^\w\s]/g, " ");
        normalized = normalized.replace(/\s+/g, " ");
        return normalized.trim();
    }

    private static leetNormalize(text: string): string {
        return text.replace(this.LEET_REGEX, m => this.LEET_MAP[m]);
    }

    public static normalizeText(text: string): string {
        return this.leetNormalize(this.baseNormalize(text));
    }

    private static getCustomTerms(): string[] {
        const raw = settings.store.customBlockedWords;
        if (!raw) return [];
        return raw.split(",").map(s => s.trim()).filter(Boolean);
    }

    public static containsBlockedContent(message: string): boolean {
        const msgBase = this.baseNormalize(message);
        if (!msgBase) return false;

        // Leet-normalized version for catching leet bypasses like "n1gger"
        const msgLeet = this.leetNormalize(msgBase);

        console.warn(`[MimicTroll] 🔎 Checking: "${message}" → base: "${msgBase}" leet: "${msgLeet}" (len=${msgBase.length})`);

        // Normalize blocked terms WITHOUT leet mapping, so digits stay as digits
        // Prevents e.g. "15" → "is" matching "this guy be beggin"
        const normalizedTerms = this.getNormalizedTerms();

        // Forward: message contains blocked term (e.g., "say child" → blocked)
        // Check both plain and leet-normalized for leet bypass detection
        for (const { original, term } of normalizedTerms) {
            if (msgBase.includes(term)) {
                console.warn(`[MimicTroll] 🚫 Forward blocked: "${message}" contains "${original}"`);
                return true;
            }
        }
        for (const { original, term } of normalizedTerms) {
            if (msgLeet.includes(term)) {
                console.warn(`[MimicTroll] 🚫 Leet-forward blocked: "${message}" contains "${original}"`);
                return true;
            }
        }

        // Spaced forward: message contains spaced-out term (e.g., "c h i l d" → blocked)
        for (const { original, term } of normalizedTerms) {
            const spaced = term.split("").join(" ");
            if (msgBase.includes(spaced) || msgLeet.includes(spaced)) {
                console.warn(`[MimicTroll] 🚫 Spaced blocked: "${message}" contains spaced "${original}"`);
                return true;
            }
        }

        // Prefix match: blocked term starts with message (catches partials like "nigg" → "nigger")
        // Only for messages >= 3 chars to avoid single-letter false positives
        if (msgBase.length >= 3) {
            for (const { original, term } of normalizedTerms) {
                if (term.startsWith(msgBase)) {
                    console.warn(`[MimicTroll] 🚫 Prefix blocked: "${original}" starts with "${message}"`);
                    return true;
                }
            }
        }

        // Additional pattern-based checks
        if (this.containsSuspiciousPatterns(msgBase)) {
            console.warn(`[MimicTroll] 🚫 Pattern blocked: "${message}" matched suspicious pattern`);
            return true;
        }

        console.warn(`[MimicTroll] ✅ Not blocked: "${message}"`);
        return false;
    }

    private static _normalizedTerms: { original: string; term: string }[] | null = null;

    private static getNormalizedTerms() {
        if (this._normalizedTerms) return this._normalizedTerms;
        const allTerms = [...this.BLOCKED_TERMS, ...this.getCustomTerms()];
        this._normalizedTerms = allTerms
            .map(t => ({ original: t, term: this.baseNormalize(t) }))
            .filter(e => e.term.length > 0);
        return this._normalizedTerms;
    }

    private static containsSuspiciousPatterns(message: string): boolean {
        // Age declarations
        const agePatterns = [
            /i.*am.*\d{1,2}$/,
            /im.*\d{1,2}$/,
            /\d{1,2}.*years.*old/,
            /\d{1,2}.*yo/,
            /age.*\d{1,2}/,
            /born.*\d{4}/
        ];

        for (const pattern of agePatterns) {
            if (pattern.test(message)) {
                const match = message.match(/\d+/);
                if (match) {
                    const age = parseInt(match[0]);
                    if (age < 18 && age > 5) { // Reasonable age range
                        console.warn(`[MimicTroll] 🚫 Blocked age declaration: ${age}`);
                        return true;
                    }
                }
            }
        }

        // Check for excessive obfuscation (too many special characters)
        const specialCharCount = (message.match(/[^a-z0-9\s]/g) || []).length;
        const totalLength = message.length;
        if (totalLength > 10 && (specialCharCount / totalLength) > 0.4) {
            console.warn("[MimicTroll] 🚫 Blocked heavily obfuscated message");
            return true;
        }

        return false;
    }

    public static getBlockedResponse(): string {
        const responses = [
            settings.store.blockedResponse
        ];

        return responses[Math.floor(Math.random() * responses.length)];
    }
}

class MimicManager {
    private activeTargets = new Map<string, MimicTarget>();
    private messageQueue: Array<{ channelId: string, content: string, delay: number; }> = [];
    private isProcessing = false;
    private intervalId: ReturnType<typeof setInterval> | null = null;

    public addTarget(userId: string, username: string, channelId: string): boolean {
        if (userId === UserStore.getCurrentUser()?.id) {
            console.log("[MimicTroll] Cannot mimic yourself!");
            return false;
        }

        this.activeTargets.set(userId, {
            userId,
            username,
            channelId,
            active: true,
            startTime: Date.now()
        });

        console.log(`[MimicTroll] 🎯 Started mimicking ${username} (${userId}) with content filtering enabled`);
        return true;
    }

    public removeTarget(userId: string): boolean {
        const target = this.activeTargets.get(userId);
        if (target) {
            this.activeTargets.delete(userId);
            console.log(`[MimicTroll] ℹ️ Stopped mimicking ${target.username}`);
            return true;
        }
        return false;
    }

    public toggleTarget(userId: string, username: string, channelId: string): boolean {
        if (this.activeTargets.has(userId)) {
            return this.removeTarget(userId);
        } else {
            return this.addTarget(userId, username, channelId);
        }
    }

    public isTargetActive(userId: string): boolean {
        return this.activeTargets.has(userId);
    }

    private currentUserId: string | null = null;

    public handleMessage(message: any) {
        if (!settings.store.enabled) return;

        // Deduplicate: flux can fire MESSAGE_CREATE twice for the same message
        if (processedMessageIds.has(message.id)) return;
        processedMessageIds.add(message.id);

        const target = this.activeTargets.get(message.author.id);
        if (!target || !target.active) return;

        // Don't mimic bot messages or system messages
        if (message.author.bot || message.type !== 0) return;

        // Don't mimic empty messages
        if (!message.content || message.content.trim() === "") return;

        // Use the message's own channel so mimic sends where the target is talking
        const sendChannelId = message.channel_id;
        if (!sendChannelId) return;

        // Process async to avoid blocking UI
        const { delay } = settings.store;
        setTimeout(() => {
            // Content filtering check. Blocked messages send the rejection on its own,
            // bypassing the template so it doesn't read like "someone really said <rejection>".
            if (ContentFilter.containsBlockedContent(message.content)) {
                console.warn(`[MimicTroll] 🚫 Blocked and replaced harmful content from ${message.author.username}`);
                this.queueMessage(sendChannelId, ContentFilter.getBlockedResponse(), delay);
                return;
            }

            // Apply message template
            const template = settings.store.messageTemplate || "{mimic}";
            const finalMessage = template.replace(/\{mimic\}/g, message.content);

            this.queueMessage(sendChannelId, finalMessage, delay);
        }, 0);
    }

    private queueMessage(channelId: string, content: string, delay: number) {
        this.messageQueue.push({ channelId, content, delay });
    }

    public start() {
        if (this.intervalId) return;
        this.currentUserId = UserStore.getCurrentUser()?.id ?? null;

        this.intervalId = setInterval(async () => {
            if (this.isProcessing || this.messageQueue.length === 0) return;

            this.isProcessing = true;

            try {
                while (this.messageQueue.length > 0) {
                    const item = this.messageQueue.shift()!;

                    // Respect the per-message delay before sending
                    if (item.delay > 0) await sleep(item.delay);

                    try {
                        await this.sendMessage(item.channelId, item.content);
                        console.log(`[MimicTroll] 📤 Sent mimic message: "${item.content}"`);
                    } catch (error) {
                        console.error("[MimicTroll] ❌ Failed to send message:", error);
                    }

                    // Small extra gap between messages to avoid rate limiting
                    await sleep(Math.random() * 500 + 200);
                }
            } finally {
                this.isProcessing = false;
            }
        }, 100);
    }

    public stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.clearAllTargets();
        this.currentUserId = null;
    }

    private async sendMessage(channelId: string, content: string): Promise<boolean> {
        try {
            await sendMessage(channelId, { content });
            return true;
        } catch (error) {
            console.error("[MimicTroll] Failed to send message:", error);
            return false;
        }
    }

    public clearQueue() {
        this.messageQueue = [];
        this.isProcessing = false;
    }

    public clearAllTargets() {
        this.activeTargets.clear();
        this.clearQueue();
    }
}

const mimicManager = new MimicManager();

// Get current channel ID from URL
function getCurrentChannelId(): string {
    const path = window.location.pathname;
    const matches = path.match(/\/channels\/[^/]+\/(\d+)/);
    return matches ? matches[1] : "";
}

// User context menu patch
const UserContext: NavContextMenuPatchCallback = (children, props) => {
    if (!settings.store.enabled) return;

    const { user } = props;
    if (!user) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || user.id === currentUser.id) return;

    const channelId = props?.channel?.id ?? ChannelStore.getDMFromUserId(user.id) ?? getCurrentChannelId();

    const userId = user.id;
    const isChecked = mimicManager.isTargetActive(userId);

    children.splice(-1, 0, <Menu.MenuGroup>
        <Menu.MenuCheckboxItem
            id="mimic-user"
            label="Mimic (Filtered)"
            checked={isChecked}
            action={async () => {
                const wasActive = mimicManager.isTargetActive(userId);
                const success = mimicManager.toggleTarget(userId, user.username, channelId);

                if (success) {
                    if (settings.store.showMimicStatus) {
                        const statusMessage = wasActive
                            ? `ℹ️ Stopped mimicking **${user.username}**`
                            : `✅ Started mimicking **${user.username}** with content filtering`;

                        Toasts.show({
                            message: statusMessage,
                            id: "mimic-troll-status",
                            type: wasActive ? Toasts.Type.MESSAGE : Toasts.Type.SUCCESS,
                            options: {
                                position: Toasts.Position.BOTTOM,
                            }
                        });
                    }
                } else {
                    Toasts.show({
                        message: "❌ Failed to toggle mimic status",
                        id: "mimic-troll-error",
                        type: Toasts.Type.FAILURE,
                        options: {
                            position: Toasts.Position.BOTTOM,
                        }
                    });
                }
            }}
        />
    </Menu.MenuGroup>);
};

// Handle message events for mimicking
function handleMessageCreate(data: any) {
    if (!settings.store.enabled) return;

    const { message } = data;
    if (!message?.author || !message.id || !message.channel_id) return;

    // Handle regular messages for mimicking
    mimicManager.handleMessage(message);
}

const contextMenus = {
    "user-context": UserContext
};

export default definePlugin({
    name: "MimicTroll",
    description: "Right-click users and toggle 'Mimic' to copy their messages with content filtering for safety",
    tags: ["Chat", "Fun"],
    authors: [TestcordDevs.dot, TestcordDevs.x2b],

    settings,
    contextMenus,

    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
        mimicManager.start();
        console.log("[MimicTroll] 🎭 Plugin started successfully with advanced content filtering");
        console.log("[MimicTroll] Right-click any user and toggle 'Mimic (Filtered)' to start/stop copying their messages");
        console.log("[MimicTroll] 🛡️ Content filtering is active to prevent harmful message mimicking");
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageCreate);
        mimicManager.stop();
        processedMessageIds.clear();
        console.log("[MimicTroll] 🛑 Plugin stopped");
    },
});
