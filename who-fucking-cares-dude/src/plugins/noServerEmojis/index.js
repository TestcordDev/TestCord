/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
const settings = definePluginSettings({
    shownEmojis: {
        description: "The types of emojis to show in the autocomplete menu.",
        type: 4 /* OptionType.SELECT */,
        default: "onlyUnicode",
        options: [
            { label: "Only unicode emojis", value: "onlyUnicode" },
            { label: "Unicode emojis and server emojis from current server", value: "currentServer" },
            { label: "Unicode emojis and all server emojis (Discord default)", value: "all" }
        ]
    }
});
export default definePlugin({
    name: "NoServerEmojis",
    authors: [Devs.UlyssesZhan],
    description: "Do not show server emojis in the autocomplete menu.",
    tags: ["Emotes", "Servers"],
    settings,
    patches: [
        {
            find: "}searchWithoutFetchingLatest(",
            replacement: {
                match: /\.nameMatchesChain\(\i\)\.reduce\(\((\i),(\i)\)=>\{(?<=channel:(\i).+?)/,
                replace: "$&if($self.shouldSkip($3,$2))return $1;"
            }
        }
    ],
    shouldSkip(channel, emoji) {
        if (emoji.type !== 1) {
            return false;
        }
        if (settings.store.shownEmojis === "onlyUnicode") {
            return true;
        }
        if (settings.store.shownEmojis === "currentServer") {
            return emoji.guildId !== (channel != null ? channel.getGuildId() : null);
        }
        return false;
    }
});
