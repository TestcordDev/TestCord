/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    audioBitrate: {
        type: OptionType.SLIDER,
        description: "Audio Bitrate (kbps) - 510kbps recommended for maximum quality",
        markers: [64, 96, 128, 192, 256, 320, 384, 448, 510],
        default: 510,
        stickToMarkers: true,
        restartNeeded: false
    },

    enableKrispNoiseSuppression: {
        type: OptionType.BOOLEAN,
        description: "Krisp AI Noise Suppression - Remove background noise (Disable for raw quality)",
        default: false,
        restartNeeded: false
    },

    enableEchoCancellation: {
        type: OptionType.BOOLEAN,
        description: "Echo Cancellation - Remove echo feedback (Disable for raw quality)",
        default: false,
        restartNeeded: false
    },

    enableAutoGainControl: {
        type: OptionType.BOOLEAN,
        description: "Auto Gain Control - Automatically adjust volume levels (Disable for natural sound)",
        default: false,
        restartNeeded: false
    },

    prioritizeAudioQuality: {
        type: OptionType.BOOLEAN,
        description: "Prioritize Audio Quality - Maximum quality over bandwidth savings",
        default: true,
        restartNeeded: false
    }
});

export default definePlugin({
    name: "rzStudioAudio",
    description: "🎙️ Professional studio-grade audio quality for Discord. 510kbps OPUS @ 48kHz with maximum quality settings. Optimized for 192kHz microphones.",
    tags: ["Voice", "Customisation"],
    authors: [
        { name: "irritably", id: 928787166916640838n },
        { name: "rz30", id: 0n },
    ],

    settings,

    patches: [
        {
            find: "voiceBitrate:",
            replacement: {
                match: /voiceBitrate:\i/,
                replace: "voiceBitrate:$self.getAudioBitrate()*1000"
            }
        },
        {
            find: "setVoiceBitRate",
            replacement: {
                match: /setVoiceBitRate\((\i)\)/,
                replace: "setVoiceBitRate($self.getAudioBitrate()*1000)"
            }
        },
        {
            find: "noiseSuppression:",
            replacement: {
                match: /noiseSuppression:!?[a-zA-Z0-9_$]+/,
                replace: "noiseSuppression:$self.getNoiseSuppression()"
            }
        },
        {
            find: "echoCancellation:",
            replacement: {
                match: /echoCancellation:!?[a-zA-Z0-9_$]+/,
                replace: "echoCancellation:$self.getEchoCancellation()"
            }
        },
        {
            find: "autoGainControl:",
            replacement: {
                match: /autoGainControl:!?[a-zA-Z0-9_$]+/,
                replace: "autoGainControl:$self.getAutoGainControl()"
            }
        },
        {
            find: "x-google-max-bitrate",
            replacement: {
                match: /x-google-max-bitrate=\$\{(\i)\}/,
                replace: (_, varName) => "x-google-max-bitrate=${$self.getAudioBitrate()*1000}"
            }
        },
        {
            find: "b=AS:${",
            replacement: {
                match: /b=AS:\$\{Math\.floor\(this\.bitrate\/1e3\)\}/,
                replace: "b=AS:${$self.getAudioBitrate()}"
            }
        },
        {
            find: 'priority:"low"',
            replacement: {
                match: /priority:"low"/,
                replace: "priority:$self.getAudioPriority()"
            }
        },
        {
            find: "googHighStartBitrate",
            replacement: {
                match: /googHighStartBitrate:\i/,
                replace: "googHighStartBitrate:$self.getPrioritizeAudioQuality()"
            }
        }
    ],

    getAudioBitrate() {
        const bitrate = settings.store.audioBitrate;
        const boosted = settings.store.prioritizeAudioQuality
            ? Math.min(bitrate, 510)
            : bitrate;
        console.log(`🎙️ [rz Plugin] Audio Bitrate: ${boosted} kbps`);
        return boosted;
    },

    getNoiseSuppression() {
        return !settings.store.enableKrispNoiseSuppression;
    },

    getEchoCancellation() {
        return settings.store.enableEchoCancellation;
    },

    getAutoGainControl() {
        return settings.store.enableAutoGainControl;
    },

    getPrioritizeAudioQuality() {
        return settings.store.prioritizeAudioQuality;
    },

    getAudioPriority() {
        return settings.store.prioritizeAudioQuality ? "high" : "low";
    },

    start() {
        console.log("🎙️ [rz Studio Audio] ACTIVATED");
        console.log("📊 Settings:");
        console.log("   • Bitrate: " + settings.store.audioBitrate + " kbps");
        console.log("   • Krisp: " + (settings.store.enableKrispNoiseSuppression ? "ON" : "OFF"));
        console.log("   • Echo Cancel: " + (settings.store.enableEchoCancellation ? "ON" : "OFF"));
        console.log("   • AGC: " + (settings.store.enableAutoGainControl ? "ON" : "OFF"));
        console.log("   • Prioritize Quality: " + (settings.store.prioritizeAudioQuality ? "ON" : "OFF"));
        console.log("🔥 Maximum quality mode enabled!");
    },

    stop() {
        console.log("🎙️ [rz Studio Audio] Deactivated");
    }
});
