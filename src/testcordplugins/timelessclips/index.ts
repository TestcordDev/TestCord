/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { makeRange, OptionType, } from "@utils/types";

const settings = definePluginSettings({
    clipLength: {
        description: "Add clip length option in minutes",
        type: OptionType.SLIDER,
        markers: makeRange(3, 30, 1),
        default: 5,
        stickToMarkers: true,
    },
});

export default definePlugin({
    name: "TimelessClips",
    authors: [TestcordDevs.x2b],
    description: "Add a your own clip length",
    tags: ["Voice", "Utility"],
    patches: [
        {
            find: '"Save clip keybind unset"',
            replacement: {
                match: /(\{value:\i,label:.+?\}\])/,
                replace: "$1.concat({value:$self.getClipLength(true),label:$self.getClipLength(false)})"
            }
        },
    ],
    settings,
    getClipLength(millis: boolean) {
        const minutes = settings.store.clipLength;
        return millis ? minutes * 6e4 : `${minutes} minutes`;
    }
});
