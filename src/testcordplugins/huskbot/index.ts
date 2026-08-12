/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    channelIDs: {
        type: OptionType.STRING,
        description: "Comma-separated list of channel IDs to watch"
    },
    userIDs: {
        type: OptionType.STRING,
        description: "Comma-separated list of user IDs to ignore"
    },
    maxChars: {
        type: OptionType.NUMBER,
        description: "Maximum chars to check",
        default: 500
    }
});

let cachedUserIds: string[] = [];
let cachedUserIdsRaw: string | undefined;
let cachedChannelIds: string[] = [];
let cachedChannelIdsRaw: string | undefined;
function getUserIds(): string[] {
    const raw = settings.store.userIDs || "";
    if (raw === cachedUserIdsRaw) return cachedUserIds;
    cachedUserIdsRaw = raw;
    cachedUserIds = raw.split(",").map(s => s.trim()).filter(Boolean);
    return cachedUserIds;
}
function getChannelIds(): string[] {
    const raw = settings.store.channelIDs || "";
    if (raw === cachedChannelIdsRaw) return cachedChannelIds;
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
        async MESSAGE_CREATE
            ({ guildId, message }) {

            const msg = message as Message;
            if (UserStore.getCurrentUser().id === msg.author.id || getUserIds().includes(msg.author.id)) return;
            if (!getChannelIds().includes(msg.channel_id) || msg.content.length > settings.store.maxChars) return;

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
            if (content.huskable) RestAPI.put({
                url: `/channels/${msg.channel_id}/messages/${msg.id}/reactions/huisk:1226906570055749652/@me`
            });
        },
    }
});
