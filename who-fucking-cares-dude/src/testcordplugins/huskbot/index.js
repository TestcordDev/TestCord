/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { RestAPI, UserStore } from "@webpack/common";
const settings = definePluginSettings({
    channelIDs: {
        type: 0 /* OptionType.STRING */,
        description: "Comma-separated list of channel IDs to watch"
    },
    userIDs: {
        type: 0 /* OptionType.STRING */,
        description: "Comma-separated list of user IDs to ignore"
    },
    maxChars: {
        type: 1 /* OptionType.NUMBER */,
        description: "Maximum chars to check",
        default: 500
    }
});
let cachedUserIds = [];
let cachedUserIdsRaw;
let cachedChannelIds = [];
let cachedChannelIdsRaw;
function getUserIds() {
    const raw = settings.store.userIDs || "";
    if (raw === cachedUserIdsRaw)
        return cachedUserIds;
    cachedUserIdsRaw = raw;
    cachedUserIds = raw.split(",").map(s => s.trim()).filter(Boolean);
    return cachedUserIds;
}
function getChannelIds() {
    const raw = settings.store.channelIDs || "";
    if (raw === cachedChannelIdsRaw)
        return cachedChannelIds;
    cachedChannelIdsRaw = raw;
    cachedChannelIds = raw.split(",").map(s => s.trim()).filter(Boolean);
    return cachedChannelIds;
}
export default definePlugin({
    name: "Huskbot",
    description: "A bot to husk. THIS IS A SELFBOT AND MIGHT GET YOU BANNED",
    tags: ["Utility", "Fun"],
    authors: [Devs.nin0dev],
    settings,
    flux: {
        async MESSAGE_CREATE({ guildId, message }) {
            const msg = message;
            if (UserStore.getCurrentUser().id === msg.author.id || getUserIds().includes(msg.author.id))
                return;
            if (!getChannelIds().includes(msg.channel_id) || msg.content.length > settings.store.maxChars)
                return;
            const res = await fetch("https://huskapi.nin0.dev", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    message: msg.content
                })
            });
            const content = await res.json();
            if (content.huskable)
                RestAPI.put({
                    url: `/channels/${msg.channel_id}/messages/${msg.id}/reactions/huisk:1226906570055749652/@me`
                });
        },
    }
});
