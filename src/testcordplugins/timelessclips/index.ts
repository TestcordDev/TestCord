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
            find: ".SECONDS_30,label:",
            replacement: {
                match: /\[\{.{0,100}\i\.\i\.SECONDS_30.{0,500}\}\]/,
                replace: "$self.patchTimeslots($&)"
            }
        },
    ],
    settings,
    patchTimeslots(timeslots: { id: string; value: number; label: string; }[]) {
        return [...timeslots, {
            id: `${settings.store.clipLength}min`,
            value: settings.store.clipLength * 6e4,
            label: `${settings.store.clipLength} minutes`
        }].sort((a, b) => a.value - b.value);
    }
});
