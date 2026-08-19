/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@utils/css";
import { makeRange } from "@utils/types";
export const cl = classNameFactory("vc-pinterest-profiles-");
export const settings = definePluginSettings({
    avatarSlots: {
        type: 5 /* OptionType.SLIDER */,
        description: "How many avatar results to show per page",
        markers: makeRange(1, 8),
        default: 4
    },
    bannerSlots: {
        type: 5 /* OptionType.SLIDER */,
        description: "How many banner results to show per page",
        markers: makeRange(1, 6),
        default: 2
    }
});
export const Native = VencordNative.pluginHelpers.PinterestSearch;
