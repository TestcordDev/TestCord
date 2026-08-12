/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import {Devs} from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { TestcordDevs } from "@utils/constants";

const settings = definePluginSettings({
    stereochannel: {
        description: "Stereo Channel",
        type: OptionType.SELECT,
        options: [
            { label: "1.0 Mono", value: 1 },
            { label: "2.0 Stereo", value: 2 },
            { label: "7.1 Surround", value: 7.1, default: true },
        ],
    }
});

export default definePlugin({
    name: "EnableStereo",
    description: "Allows the use of stereo and surround sound in voice chats. Note: Requires restart after every change. Noise suppression and Echo Cancellation must be disabled for it to work correctly!",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    patches: [
        {
            find: "Audio codecs",
            replacement: {
                match: /channels:1,/,
                replace: "channels:1,prams:{stereo:\"1\"},",
                predicate: () => settings.store.stereochannel === 1
            }
        },
        {
            find: "Audio codecs",
            replacement: {
                match: /channels:1,/,
                replace: "channels:2,prams:{stereo:\"2\"},",
                predicate: () => settings.store.stereochannel === 2
            }
        },
        {
            find: "Audio codecs",
            replacement: {
                match: /channels:1,/,
                replace: "channels:7.1,prams:{stereo:\"7.1\"},",
                predicate: () => settings.store.stereochannel === 7.1
            }
        }
    ]
});





