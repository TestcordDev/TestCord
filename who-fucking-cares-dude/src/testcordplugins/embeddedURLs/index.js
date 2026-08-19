/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import definePlugin from "@utils/types";
const urlMap = new Map([
    ["https://www.tiktok.com", "https://www.tnktok.com"],
    ["https://vt.tiktok.com", "https://www.tnktok.com"],
    ["https://x.com", "https://www.fxtwitter.com"],
    ["https://www.twitter.com", "https://www.fxtwitter.com"],
    ["https://www.instagram.com", "https://www.kkinstagram.com"]
]);
export default definePlugin({
    name: "EmbeddedURLs",
    description: `Turns plain social links into embeddable URLs so posts
    and videos are fully viewable in Discord instead of forcing users to open the external site.`,
    tags: ["Chat", "Utility"],
    authors: [{ name: "Dadian1", id: 131825869302792192n }],
    replaceUrl(originalUrl) {
        try {
            var newUrl = new URL(originalUrl);
        }
        catch (error) {
            // Don't modify anything if we can't parse the URL
            return originalUrl;
        }
        if (urlMap.has(newUrl.origin)) {
            return urlMap.get(newUrl.origin) + newUrl.pathname + newUrl.search;
        }
        // If we can't find the URL in the map, return the original
        return originalUrl;
    },
    onBeforeMessageSend(_, msg) {
        // Only modify URL
        if (/https:\/\//.test(msg.content)) {
            msg.content = this.replaceUrl(msg.content); // needs fixing because this only works with raw url message
        }
    }
});
