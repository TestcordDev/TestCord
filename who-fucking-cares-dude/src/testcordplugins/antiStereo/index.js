/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
const settings = definePluginSettings({
    forceMono: {
        description: "Force mono (disable stereo)",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    showNotifications: {
        description: "Show notifications",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
    },
});
export default definePlugin({
    name: "AntiStereo",
    description: "Forces Discord to use mono instead of stereo for audio output",
    tags: ["Voice", "Utility"],
    authors: [
        {
            name: "Bash",
            id: 1327483363518582784n,
        },
        TestcordDevs.x2b,
    ],
    settings,
    patches: [
        {
            find: "Audio codecs",
            replacement: {
                match: /channels:\d+(?:\.\d+)?,/,
                replace: "channels:1,",
                predicate: () => settings.store.forceMono,
            },
        },
        {
            find: "stereo",
            replacement: {
                match: /stereo:\s*["']?\d+(?:\.\d+)?["']?/g,
                replace: "stereo:false",
                predicate: () => settings.store.forceMono,
            },
        },
        {
            find: "AudioContext",
            replacement: {
                match: /sampleRate:\s*\d+/g,
                replace: "sampleRate:48000",
                predicate: () => settings.store.forceMono,
            },
        },
    ],
    start() {
        if (settings.store.forceMono) {
            console.log("[AntiStereo] AntiStereo plugin enabled - Forcing mono");
            if (settings.store.showNotifications) {
                // Note: Notifications would require importing @api/Notifications
                console.log("[AntiStereo] Notifications enabled");
            }
        }
    },
    stop() {
        console.log("[AntiStereo] AntiStereo plugin disabled");
    },
});
