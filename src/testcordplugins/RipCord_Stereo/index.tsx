/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";

const settings = definePluginSettings({
    enableToasts: {
        description: "Enable Toasts",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    },
    stereoLevel: {
        description: "Stereo Level (2.0 = Full Stereo)",
        type: OptionType.SLIDER,
        markers: [1.0, 1.5, 2.0, 2.5, 3.0],
        default: 2.0,
        stickToMarkers: true
    },
    bitrate: {
        description: "Voice Bitrate (kbps)",
        type: OptionType.SLIDER,
        markers: [32, 64, 128, 256, 300],
        default: 300,
        stickToMarkers: true
    }
});

const VoiceModule = findByPropsLazy("updateVideoQuality");
const VoiceSettingsStore = findByPropsLazy("getEchoCancellation");

export default definePlugin({
    name: "RipCordStereoFixed",
    authors: [{ name: "Hahac", id: 1140323729432399882n }],
    description: "Enhanced stereo sound with configurable settings",
    tags: ["Voice", "Utility"],
    settings,

    patches: [
        {
            find: "updateVideoQuality",
            replacement: {
                match: /updateVideoQuality\(\i\){/,
                replace: "$&$self.enhanceAudio(this);"
            }
        }
    ],

    enhanceAudio(thisObj: any) {
        try {
            console.log("[RipCordStereo] Starting audio enhancement...");

            // Check voice settings warnings
            const hasWarnings = this.checkSettings();
            console.log(`[RipCordStereo] Voice settings warnings: ${hasWarnings}`);

            if (!thisObj.conn?.setTransportOptions) {
                console.warn("[RipCordStereo] conn.setTransportOptions not found");
                return;
            }

            const original = thisObj.conn.setTransportOptions;
            console.log("[RipCordStereo] Successfully hooked setTransportOptions");

            thisObj.conn.setTransportOptions = function (obj: any) {
                console.log("[RipCordStereo] Transport options being modified:", obj);

                if (obj.audioEncoder) {
                    obj.audioEncoder.params = { stereo: settings.store.stereoLevel.toString() };
                    obj.audioEncoder.channels = parseFloat(settings.store.stereoLevel.toString());
                    console.log(`[RipCordStereo] Set stereo level to: ${settings.store.stereoLevel}`);
                }

                if (obj.fec) {
                    obj.fec = false;
                    console.log("[RipCordStereo] Disabled FEC");
                }

                const targetBitrate = settings.store.bitrate * 1000;
                if (obj.encodingVoiceBitRate < targetBitrate) {
                    const oldValue = obj.encodingVoiceBitRate;
                    obj.encodingVoiceBitRate = targetBitrate;
                    console.log(`[RipCordStereo] Updated bitrate from ${oldValue} to ${targetBitrate} bps (${settings.store.bitrate} kbps)`);
                }

                const result = original.call(this, obj);
                console.log("[RipCordStereo] Transport options applied successfully");
                return result;
            };

            if (!this.checkSettings() && settings.store.enableToasts) {
                showNotification({
                    title: "RipCordStereoFixed",
                    body: "Stereo enhanced!",
                    color: "var(--green-360)"
                });
            }
        } catch (err) {
            console.error("[RipCordStereoFixed] Error:", err);
        }
    },

    checkSettings() {
        try {
            console.log("[RipCordStereo] Checking voice settings...");

            if (!VoiceSettingsStore) {
                console.warn("[RipCordStereo] VoiceSettingsStore not found");
                return false;
            }

            const hasIssues =
                VoiceSettingsStore.getNoiseSuppression?.() ||
                VoiceSettingsStore.getNoiseCancellation?.() ||
                VoiceSettingsStore.getEchoCancellation?.();

            console.log(`[RipCordStereo] Voice settings issues detected: ${!!hasIssues}`);

            if (hasIssues && settings.store.enableToasts) {
                showNotification({
                    title: "RipCordStereoFixed Warning",
                    body: "Disable echo cancellation and noise suppression in Discord settings!",
                    color: "var(--yellow-360)"
                });
            }
            return hasIssues;
        } catch (err) {
            console.error("[RipCordStereo] Error checking settings:", err);
            return false;
        }
    },

    start() {
        console.log("[RipCordStereo] Plugin started successfully");
        console.log(`[RipCordStereo] Current settings - Stereo Level: ${settings.store.stereoLevel}, Bitrate: ${settings.store.bitrate}kbps`);

        if (settings.store.enableToasts) {
            showNotification({
                title: "RipCordStereoFixed",
                body: "Plugin activated!",
                color: "var(--brand-500)"
            });
        }
    },

    stop() {
        console.log("[RipCordStereo] Plugin stopped");
    }
});
