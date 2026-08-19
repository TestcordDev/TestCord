/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { RelationshipStore, SelectedChannelStore } from "@webpack/common";
const settings = definePluginSettings({
    regex: {
        type: 0 /* OptionType.STRING */,
        description: "Regex to trigger on",
        default: "hop on (?:fortnite|fn)"
    },
    url: {
        type: 0 /* OptionType.STRING */,
        description: "URL to open",
        default: "com.epicgames.launcher://apps/fn%3A4fe75bbc5a674f4f9b356b5c90567da5%3AFortnite?action=launch&silent=true"
    }
});
export default definePlugin({
    name: "HopOn",
    description: "Hop on! Opens a configurable URL when a message matches a custom regex in the current channel.",
    tags: ["Fun"],
    authors: [Devs.ImLvna],
    settings,
    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }) {
            if (optimistic || type !== "MESSAGE_CREATE")
                return;
            if (message.state === "SENDING")
                return;
            if (RelationshipStore.isBlocked(message.author?.id))
                return;
            if (channelId !== SelectedChannelStore.getChannelId())
                return;
            if (!message.content?.match(new RegExp(settings.store.regex, "i")))
                return;
            VencordNative.native.openExternal(settings.store.url);
        }
    }
});
