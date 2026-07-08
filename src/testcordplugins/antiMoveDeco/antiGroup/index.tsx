/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable the AntiGroup plugin",
        default: false
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications when automatically leaving",
        default: true
    },
    verboseLogs: {
        type: OptionType.BOOLEAN,
        description: "Show detailed logs in the console",
        default: false
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Delay before leaving the group (in milliseconds)",
        default: 1000,
        min: 100,
        max: 10000
    },
    whitelist: {
        type: OptionType.STRING,
        description: "Allowed user IDs (comma-separated)",
        default: ""
    },
    autoReply: {
        type: OptionType.BOOLEAN,
        description: "Send an automatic message before leaving",
        default: true
    },
    replyMessage: {
        type: OptionType.STRING,
        description: "Message to send before leaving",
        default: "I do not wish to be added to groups. Please contact me privately."
    }
});

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[AntiGroup ${timestamp}]`;
    switch (level) {
        case "warn": console.warn(prefix, message); break;
        case "error": console.error(prefix, message); break;
        default: console.log(prefix, message);
    }
}

function verboseLog(message: string) {
    if (settings.store.verboseLogs) log(message);
}

async function leaveGroupDM(channelId: string) {
    try {
        const channel = ChannelStore.getChannel(channelId);
        const channelName = channel?.name || "Unnamed group";

        if (settings.store.autoReply && settings.store.replyMessage.trim()) {
            try {
                await RestAPI.post({
                    url: Constants.Endpoints.MESSAGES(channelId),
                    body: { content: settings.store.replyMessage }
                });
                await sleep(500);
            } catch (msgError) {
                log(`❌ Error sending automatic message: ${msgError}`, "error");
            }
        }

        await RestAPI.del({ url: Constants.Endpoints.CHANNEL(channelId) });

        if (settings.store.showNotifications) {
            showNotification({
                title: "🛡️ AntiGroup - Group left",
                body: `You automatically left the group "${channelName}"`,
                icon: undefined
            });
        }
    } catch (error) {
        const channel = ChannelStore.getChannel(channelId);
        const channelName = channel?.name || "Unknown group";
        log(`❌ ERROR leaving group "${channelName}" (${channelId}): ${error}`, "error");
        if (settings.store.showNotifications) {
            showNotification({
                title: "❌ AntiGroup - Error",
                body: `Unable to automatically leave the group "${channelName}"`,
                icon: undefined
            });
        }
    }
}

function isUserWhitelisted(userId: string): boolean {
    const whitelist = settings.store.whitelist
        .split(",")
        .map(id => id.trim())
        .filter(id => id.length > 0);
    return whitelist.includes(userId);
}

function wasRecentlyAdded(channel: any, currentUserId: string): boolean {
    if (channel.type !== 3) return false;
    return channel.ownerId !== currentUserId;
}

export default definePlugin({
    name: "AntiGroup",
    enabledByDefault: false,
    description: "Automatically leaves group DMs as soon as you're added",
    authors: [{ name: "Bash", id: 1327483363518582784n }],
    settings,

    flux: {
        CHANNEL_CREATE(event: { channel: any; }) {
            if (!settings.store.enabled) return;

            const { channel } = event;
            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!channel || !currentUserId) return;
            if (channel.type !== 3) return;
            if (!wasRecentlyAdded(channel, currentUserId)) return;

            if (channel.ownerId && isUserWhitelisted(channel.ownerId)) return;

            const whitelistedMember = channel.recipients?.find((recipient: any) =>
                isUserWhitelisted(recipient.id)
            );
            if (whitelistedMember) return;

            if (settings.store.showNotifications) {
                showNotification({
                    title: "🚨 AntiGroup - Group detected",
                    body: `Added to group "${channel.name || "Unnamed"}" - Automatic leave in ${settings.store.delay / 1000}s`,
                    icon: undefined
                });
            }

            setTimeout(() => leaveGroupDM(channel.id), settings.store.delay);
        }
    },

    start() {
        log("[AntiGroup] Plugin started");
    },

    stop() {
        log("[AntiGroup] Plugin stopped");
    }
});
