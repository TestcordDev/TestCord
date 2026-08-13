/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { React, RestAPI, useState } from "@webpack/common";

// ── Stores ─────────────────────────────────────────────────────────────────────

const UserStore = findStoreLazy("UserStore");

// ── Settings ───────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    location: {
        type: OptionType.SELECT,
        description: "Where to show the button",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true,
    },
    active: {
        type: OptionType.BOOLEAN,
        description: "Auto-reply active (toggle in the text bar)",
        default: false,
        restartNeeded: false,
    },
    messages: {
        type: OptionType.STRING,
        description: "Reply messages separated by | — e.g.: Hi!|I'm away|Come back later",
        default: "Hi! I'm currently away, I'll get back to you as soon as possible.",
        restartNeeded: false,
    },
    replyToUsers: {
        type: OptionType.STRING,
        description: "User IDs to reply to (comma-separated). Empty = everyone.",
        default: "",
        restartNeeded: false,
    },
    replyToChannels: {
        type: OptionType.STRING,
        description: "Enabled channel IDs (comma-separated). Empty = all channels.",
        default: "",
        restartNeeded: false,
    },
    replyMode: {
        type: OptionType.SELECT,
        description: "Reply message selection mode",
        options: [
            { label: "Random message from list", value: "random", default: true },
            { label: "Sequential messages", value: "sequential" },
            { label: "Always the first message", value: "first" },
        ],
    },
    cooldown: {
        type: OptionType.SLIDER,
        description: "Cooldown between replies to the same user (seconds). 0 = no limit.",
        markers: [0, 10, 30, 60, 120, 300],
        default: 30,
        restartNeeded: false,
    },
    replyWithMention: {
        type: OptionType.BOOLEAN,
        description: "Mention the user in the automatic reply",
        default: false,
        restartNeeded: false,
    },
    replyAsQuote: {
        type: OptionType.BOOLEAN,
        description: "Reply by quoting the original message (Discord reply)",
        default: true,
        restartNeeded: false,
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Do not reply to bots",
        default: true,
        restartNeeded: false,
    },
    minDelayMs: {
        type: OptionType.SLIDER,
        description: "Minimum delay before reply (ms) — to appear natural",
        markers: [0, 200, 500, 1000, 2000],
        default: 1000,
        restartNeeded: false,
    },
    maxDelayMs: {
        type: OptionType.SLIDER,
        description: "Maximum delay before reply (ms)",
        markers: [300, 500, 1000, 2000, 5000],
        default: 3000,
        restartNeeded: false,
    },
});

// ── Internal state ──────────────────────────────────────────────────────────────

const lastReplied = new Map<string, number>();
const pendingReplies = new Set<ReturnType<typeof setTimeout>>();
let sequentialIndex = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

function getMessages(): string[] {
    const raw = settings.store.messages ?? "";
    return raw.split("|").map((m: string) => m.trim()).filter(Boolean);
}

function pickMessage(): string {
    const msgs = getMessages();
    if (msgs.length === 0) return "...";
    const mode = settings.store.replyMode ?? "random";
    if (mode === "first") return msgs[0];
    if (mode === "sequential") {
        const msg = msgs[sequentialIndex % msgs.length];
        sequentialIndex++;
        return msg;
    }
    return msgs[Math.floor(Math.random() * msgs.length)];
}

function shouldReply(message: any, currentUserId: string): boolean {
    if (!settings.store.active) return false;
    if (message.author?.id === currentUserId) return false;
    if (settings.store.ignoreBots && message.author?.bot) return false;

    // Reply only in private DMs (channel_type 1 = private 1:1 DM)
    // channel_type 0 = server channel, 2 = voice, 3 = DM group, etc.
    if (message.channel_type !== 1) return false;

    // Dismiss messages that are replies (someone replying to you)
    if (message.message_reference) return false;

    const allowedUsers = (settings.store.replyToUsers ?? "")
        .split(",").map((s: string) => s.trim()).filter(Boolean);
    if (allowedUsers.length > 0 && !allowedUsers.includes(message.author?.id)) return false;

    const allowedChannels = (settings.store.replyToChannels ?? "")
        .split(",").map((s: string) => s.trim()).filter(Boolean);
    if (allowedChannels.length > 0 && !allowedChannels.includes(message.channel_id)) return false;

    const cooldownMs = (settings.store.cooldown ?? 0) * 1000;
    if (cooldownMs > 0) {
        const last = lastReplied.get(message.author?.id);
        if (last && Date.now() - last < cooldownMs) return false;
    }
    return true;
}

async function sendAutoReply(message: any) {
    const channelId: string = message.channel_id;
    let text = pickMessage();
    if (settings.store.replyWithMention) text = `<@${message.author?.id}> ${text}`;

    lastReplied.set(message.author?.id, Date.now());

    const body: any = { content: text, tts: false, flags: 0 };

    if (settings.store.replyAsQuote && message.id) {
        body.message_reference = { message_id: message.id, channel_id: channelId };
        if (message.guild_id) body.message_reference.guild_id = message.guild_id;
        body.allowed_mentions = { parse: ["users", "roles"], replied_user: settings.store.replyWithMention };
    }

    try {
        await RestAPI.post({
            url: `/channels/${channelId}/messages`,
            body,
        });
    } catch (e) {
        console.error("[AutoReply] Error:", e);
    }
}

// ── Icon ──────────────────────────────────────────────────────────────────────

function AutoReplyIcon({ active, height = 20, width = 20, className }: {
    active?: boolean; height?: string | number; width?: string | number; className?: string;
}) {
    return (
        <svg
            className={className}
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
            style={{ color: active ? "var(--status-positive)" : "currentColor" }}
        >
            <path
                fill="currentColor"
                d="M21 2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 1 1 0-2h3.93A8 8 0 0 0 6.97 5.78a1 1 0 0 1-1.26-1.56A9.98 9.98 0 0 1 20 6V3a1 1 0 0 1 1-1ZM3 22a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H5.07a8 8 0 0 0 11.96 2.22 1 1 0 1 1 1.26 1.56A9.99 9.99 0 0 1 4 18v3a1 1 0 0 1-1 1Z"
            />
        </svg>
    );
}

// ── Chat Bar Button ────────────────────────────────────────────────────────────

const AutoReplyButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [active, setActive] = useState(settings.store.active);

    if (!isMainChat || settings.store.location !== "chatbar") return null;

    function toggle() {
        // Session toggle only — does not persist between restarts
        settings.store.active = !settings.store.active;
        setActive(settings.store.active);
        // DO NOT write to settings.store.active directly if you want it to be persistent
    }

    const tooltip = active
        ? "Auto Reply: Enabled — click to disable"
        : "Auto Reply: Disabled — click to enable";

    return (
        <ChatBarButton tooltip={tooltip} onClick={toggle}>
            <AutoReplyIcon active={active} />
        </ChatBarButton>
    );
};

// ── Plugin ─────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "AutoReply",
    description: "Automatically replies to received messages. Button in the text bar (next to VoiceDictation).",
    authors: [{ name: "User", id: 0n }],
    tags: ["Utility"],
    dependencies: ["ChatInputButtonAPI", "HeaderBarAPI"],
    settings,

    chatBarButton: {
        icon: AutoReplyIcon,
        render: AutoReplyButton,
    },

    flux: {
        async MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic?: boolean; }) {
            if (optimistic) return;
            if (!message?.author?.id || !message?.channel_id) return;

            const currentUser = UserStore?.getCurrentUser?.();
            if (!currentUser) return;

            if (shouldReply(message, currentUser.id)) {
                const minDelay = settings.store.minDelayMs ?? 300;
                const maxDelay = Math.max(settings.store.maxDelayMs ?? 1500, minDelay);
                const delay = minDelay + Math.random() * (maxDelay - minDelay);
                const timeout = setTimeout(() => {
                    pendingReplies.delete(timeout);
                    sendAutoReply(message);
                }, delay);
                pendingReplies.add(timeout);
            }
        },
    },

    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("AutoReply", () => (
                <HeaderBarButton
                    icon={() => <AutoReplyIcon active={settings.store.active} />}
                    tooltip={`AutoReply: ${settings.store.active ? "ON" : "OFF"}`}
                    onClick={() => { settings.store.active = !settings.store.active; }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("AutoReply", () => (
                <ChannelToolbarButton
                    icon={() => <AutoReplyIcon active={settings.store.active} />}
                    tooltip={`AutoReply: ${settings.store.active ? "ON" : "OFF"}`}
                    onClick={() => { settings.store.active = !settings.store.active; }}
                />
            ), 5);
        }
    },

    stop() {
        for (const timeout of pendingReplies) clearTimeout(timeout);
        pendingReplies.clear();
        lastReplied.clear();
        removeHeaderBarButton("AutoReply");
        removeChannelToolbarButton("AutoReply");
    },
});
