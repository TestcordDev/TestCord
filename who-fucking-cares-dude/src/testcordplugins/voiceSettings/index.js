/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import definePlugin, { makeRange } from "@utils/types";
const settings = definePluginSettings({
    voiceBitrateKbps: {
        description: "Voice chat encoding bitrate in kbps. Discord default is 64. Higher values improve call quality and use more bandwidth.",
        type: 5 /* OptionType.SLIDER */,
        markers: [32, 64, 96, 128, 192, 256, 320, 510],
        default: 128,
        stickToMarkers: true,
    },
    pttDelayMax: {
        description: "Maximum push-to-talk release delay in milliseconds. Discord default max is 2000.",
        type: 5 /* OptionType.SLIDER */,
        markers: makeRange(2000, 10000, 1000),
        default: 5000,
        stickToMarkers: true,
    },
});
export default definePlugin({
    name: "VoiceSettings",
    description: "Extends voice chat audio bitrate beyond Discord's default and unlocks the push-to-talk release delay slider above its 2-second cap.",
    tags: ["Voice", "Utility"],
    authors: [{ name: "Sharp", id: 0n }],
    settings,
    patches: [
        // Raise Opus voice chat bitrate (Discord default: 64 kbps)
        {
            find: "mediaBitrate:",
            replacement: {
                match: /(?<=mediaBitrate:)\d+/,
                replace: "$self.settings.store.voiceBitrateKbps*1000",
            },
            noWarn: true,
        },
        // Extend PTT release delay slider maximum beyond 2000ms
        {
            find: "pttReleaseDelay",
            replacement: {
                match: /(?<=pttReleaseDelay.{0,200})maxValue:2000/,
                replace: "maxValue:$self.settings.store.pttDelayMax",
            },
            noWarn: true,
        },
    ],
});
