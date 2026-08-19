/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
const CLEAR_URLS_JSON_URL = "https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json";
const HAS_URL_RE = /https?:\/\//;
const URL_MATCH_RE = /(https?:\/\/[^\s<]+[^<.,:;"'>)|\]\s])/g;
export default definePlugin({
    name: "ClearURLs",
    description: "Automatically removes tracking elements from URLs you send",
    dependencies: ["MessageEventsAPI"],
    tags: ["Privacy", "Utility"],
    authors: [Devs.adryd, Devs.thororen],
    rules: [],
    async start() {
        await this.createRules();
    },
    stop() {
        this.rules = [];
    },
    onBeforeMessageSend(_, msg) {
        return this.cleanMessage(msg);
    },
    onBeforeMessageEdit(_cid, _mid, msg) {
        return this.cleanMessage(msg);
    },
    async createRules() {
        const res = await fetch(CLEAR_URLS_JSON_URL)
            .then(res => res.json());
        this.rules = [];
        for (const [name, provider] of Object.entries(res.providers)) {
            const urlPattern = new RegExp(provider.urlPattern, "i");
            const rules = provider.rules?.map(rule => new RegExp(rule, "i"));
            const rawRules = provider.rawRules?.map(rule => new RegExp(rule, "i"));
            const exceptions = provider.exceptions?.map(ex => new RegExp(ex, "i"));
            this.rules.push({
                name,
                urlPattern,
                rules,
                rawRules,
                exceptions,
            });
        }
    },
    replacer(match) {
        // Parse URL without throwing errors
        try {
            var url = new URL(match);
        }
        catch (error) {
            // Don't modify anything if we can't parse the URL
            return match;
        }
        // Cheap way to check if there are any search params
        if (url.searchParams.entries().next().done)
            return match;
        // Check rules for each provider that matches
        this.rules.forEach(({ urlPattern, exceptions, rawRules, rules }) => {
            if (!urlPattern.test(url.href) || exceptions?.some(ex => ex.test(url.href)))
                return;
            const toDelete = [];
            if (rules) {
                // Add matched params to delete list
                url.searchParams.forEach((_, param) => {
                    if (rules.some(rule => rule.test(param))) {
                        toDelete.push(param);
                    }
                });
            }
            // Delete matched params from list
            toDelete.forEach(param => url.searchParams.delete(param));
            // Match and remove any raw rules
            let cleanedUrl = url.href;
            rawRules?.forEach(rawRule => {
                cleanedUrl = cleanedUrl.replace(rawRule, "");
            });
            url = new URL(cleanedUrl);
        });
        return url.toString();
    },
    cleanMessage(msg) {
        // Only run on messages that contain URLs
        if (HAS_URL_RE.test(msg.content)) {
            msg.content = msg.content.replace(URL_MATCH_RE, match => this.replacer(match));
        }
    },
});
