/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
function getToken() {
    try {
        const id = Math.random().toString();
        const arr = webpackChunkdiscord_app.push([[id], {}, req => req.c]);
        const token = Object.values(arr)
            .find((m) => 
        // @ts-ignore dynamic
        m?.exports?.default?.getToken !== undefined)?.exports.default.getToken();
        return token || null;
    }
    catch (err) {
        console.error("[Clan Switcher] Failed to extract token:", err);
        return null;
    }
}
const settings = definePluginSettings({
    clans: {
        type: 0 /* OptionType.STRING */,
        default: "",
        description: "Clan IDs (comma-separated)"
    },
    intervalSeconds: {
        type: 1 /* OptionType.NUMBER */,
        default: 5,
        description: "Interval between clan join attempts (in seconds)"
    }
});
let loop = null;
export default definePlugin({
    name: "Clan Switcher",
    description: "Automatically switches discord clantags",
    tags: ["Servers", "Utility"],
    authors: [],
    settings,
    start() {
        const token = getToken();
        console.log("[Clan Switcher] Using extracted token.");
        const clanList = settings.store.clans
            .split(",")
            .map(c => c.trim())
            .filter(Boolean);
        const interval = Math.max(1, settings.store.intervalSeconds || 5) * 1000;
        if (!token || clanList.length === 0) {
            console.warn("[Clan Switcher] Token or clans not configured.");
            return;
        }
        let index = 0;
        loop = setInterval(() => {
            const clanId = clanList[index % clanList.length];
            index++;
            fetch("https://discord.com/api/v9/users/@me/clan", {
                method: "PUT",
                headers: {
                    "authority": "discord.com",
                    "accept": "*/*",
                    "accept-language": "en-US",
                    "authorization": token, // Keep this dynamic
                    "cache-control": "no-cache",
                    "content-type": "application/json",
                    "cookie": "__dcfduid=generic_dcfduid; __sdcfduid=generic_sdcfduid; __cfruid=generic_cfruid; _cfuvid=generic_cfuvid",
                    "origin": "https://discord.com",
                    "pragma": "no-cache",
                    "referer": "https://discord.com/channels/@me",
                    "sec-ch-ua": '"Not.A/Brand";v="8", "Chromium";v="114", "Microsoft Edge";v="114"',
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": '"Windows"',
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-origin",
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                    "x-debug-options": "bugReporterEnabled",
                    "x-discord-locale": "en-US",
                    "x-discord-timezone": "UTC",
                    "x-super-properties": "eyJvcyI6IkdlbmVyaWMiLCJicm93c2VyIjoiR2VuZXJpYyIsImRldmljZSI6IkdlbmVyaWMiLCJzeXN0ZW1fbG9jYWxlIjoiZW4tVVMifQ=="
                },
                body: JSON.stringify({
                    identity_enabled: true,
                    identity_guild_id: clanId
                })
            }).catch(err => console.error("[Clan Switcher] Error:", err));
        }, interval);
    },
    stop() {
        if (loop) {
            clearInterval(loop);
            loop = null;
            console.log("[Clan Switcher] Stopped.");
        }
    }
});
