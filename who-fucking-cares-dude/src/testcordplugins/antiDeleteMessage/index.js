/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { Constants, React, RestAPI, UserStore } from "@webpack/common";
const settings = definePluginSettings({
    enabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable automatic message restoration (toggle with toolbar button)",
        default: true,
    },
    dmProtection: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Also protect DMs (not just servers)",
        default: false,
    },
    maxCacheSize: {
        type: 1 /* OptionType.NUMBER */,
        description: "Maximum number of messages kept in cache",
        default: 500,
    },
    serverBlacklist: {
        type: 0 /* OptionType.STRING */,
        description: "Server IDs to ignore (comma-separated). Messages sent in these servers will NOT be resent.",
        default: "",
        placeholder: "e.g. 123456789, 987654321",
    }
});
const DB_KEY = "AntiDeleteMessage_cache";
// In-memory cache — mirror of IndexedDB for fast access
let memCache = {};
let dbLoaded = false;
// Load cache from IndexedDB on startup
async function loadCache() {
    try {
        const stored = await DataStore.get(DB_KEY);
        if (stored) {
            memCache = stored;
        }
        dbLoaded = true;
    }
    catch (e) {
        console.warn("[AntiDeleteMessage] Failed to load cache:", e);
        dbLoaded = true;
    }
}
// Persist cache to IndexedDB (debounced to avoid writing on every message)
let saveTimer = null;
function scheduleSave() {
    if (saveTimer)
        clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try {
            await DataStore.set(DB_KEY, memCache);
        }
        catch (e) {
            console.warn("[AntiDeleteMessage] Failed to save cache:", e);
        }
    }, 1000); // writes to disk 1s after the last received message
}
function getBlacklistedGuildIds() {
    const raw = settings.store.serverBlacklist ?? "";
    return new Set(raw.split(",")
        .map(s => s.trim())
        .filter(s => s.length > 0));
}
function addToCache(messageId, data) {
    const maxSize = settings.store.maxCacheSize ?? 500;
    // Evict oldest entries if cache exceeds the limit
    const ids = Object.keys(memCache);
    if (ids.length >= maxSize) {
        // Sort by savedAt and remove the oldest 10%
        const sorted = ids.sort((a, b) => (memCache[a].savedAt ?? 0) - (memCache[b].savedAt ?? 0));
        const toDelete = Math.max(1, Math.floor(maxSize * 0.1));
        for (let i = 0; i < toDelete; i++)
            delete memCache[sorted[i]];
    }
    memCache[messageId] = data;
    scheduleSave();
}
async function resendMessage(cached) {
    try {
        const body = {
            content: cached.content,
            flags: 0,
            mobile_network_type: "unknown",
            nonce: cached.nonce, // same nonce = same visual position in chat
            tts: false,
        };
        if (cached.messageReference) {
            body.message_reference = cached.messageReference;
        }
        await RestAPI.post({
            url: Constants.Endpoints.MESSAGES(cached.channelId),
            body
        });
    }
    catch (err) {
        console.warn("[AntiDeleteMessage] Failed to resend message:", err);
    }
}
function AntiDeleteIcon({ size = 18 }) {
    const { enabled } = settings.store;
    const color = enabled ? "#3ba55c" : "#72767d";
    return React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: color }, React.createElement("path", { d: "M19.73 4.87l-1.52-1.52L12 9.43 5.79 3.35 4.27 4.87 10.41 11H2v2h20V9h-8.41l6.14-6.13zM4 15h16v2H4v-2z" }));
}
export default definePlugin({
    name: "AntiDeleteMessage",
    description: "Automatically resends your messages if someone deletes them. Cache persisted across restarts.",
    tags: ["Privacy", "Notifications", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    enabledByDefault: false,
    settings,
    headerBarButton: {
        location: "channeltoolbar",
        icon: AntiDeleteIcon,
        label: "Toggle AntiDeleteMessage",
        render() {
            return React.createElement(ChannelToolbarButton, {
                icon: AntiDeleteIcon,
                tooltip: settings.store.enabled ? "AntiDelete: ON (click to disable)" : "AntiDelete: OFF (click to enable)",
                onClick: () => {
                    settings.store.enabled = !settings.store.enabled;
                },
                selected: settings.store.enabled
            });
        }
    },
    flux: {
        MESSAGE_CREATE({ message, guildId }) {
            if (!settings.store.enabled)
                return;
            if (!dbLoaded)
                return; // not ready yet
            const currentUser = UserStore.getCurrentUser();
            if (!currentUser || message.author.id !== currentUser.id)
                return;
            // Ignore messages with no text content (stickers, etc.)
            if (!message.content?.trim())
                return;
            // Ignore DMs if the option is disabled
            if (!guildId && !settings.store.dmProtection)
                return;
            // Ignore servers in the blacklist
            if (guildId && getBlacklistedGuildIds().has(guildId))
                return;
            addToCache(message.id, {
                content: message.content,
                channelId: message.channel_id,
                nonce: message.id,
                guildId,
                messageReference: message.message_reference,
                savedAt: Date.now(),
            });
        },
        MESSAGE_DELETE({ id, channelId }) {
            if (!settings.store.enabled)
                return;
            const cached = memCache[id];
            if (!cached)
                return;
            // Check blacklist at delete-time too (in case the setting changed)
            if (cached.guildId && getBlacklistedGuildIds().has(cached.guildId)) {
                delete memCache[id];
                scheduleSave();
                return;
            }
            // Remove from cache to prevent infinite loops
            delete memCache[id];
            scheduleSave();
            setTimeout(() => resendMessage(cached), 400);
        },
    },
    async start() {
        await loadCache();
    },
    stop() {
        if (saveTimer) {
            clearTimeout(saveTimer);
            // Final synchronous save
            DataStore.set(DB_KEY, memCache).catch(() => { });
        }
        memCache = {};
        dbLoaded = false;
    }
});
