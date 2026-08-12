/*
 * IllegalCord Stereo Sound Plugin
 * Ported from BetterDiscord StereoSound plugin
 * Copyright (c) 2026 Hisako
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";

const settings = definePluginSettings({
    enableToasts: {
        description: "Enable Toasts",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    },
    stereoChannels: {
        description: "Stereo Channels (1.0 = Mono, 2.0 = Stereo, etc.)",
        type: OptionType.SLIDER,
        markers: [1.0, 2.0, 4.0, 7.1],
        default: 2.0,
        stickToMarkers: true
    },
    bitrate: {
        description: "Voice Bitrate (kbps)",
        type: OptionType.SLIDER,
        markers: [32, 64, 96, 128, 256, 384, 512],
        default: 512,
        stickToMarkers: true
    }
});

const VoiceModule = findByPropsLazy("updateVideoQuality");
const VoiceSettingsStore = findByPropsLazy("getEchoCancellation");

export default definePlugin({
    name: "StereoSound",
    authors: [{ name: "shaun", id: 840347082430873611n }],
    description: "Adds stereo sound to your own microphone's output. Requires a capable stereo microphone.",
    tags: ["Voice", "Utility"],
    settings,

    patches: [
        {
            find: "updateVideoQuality",
            replacement: {
                match: /updateVideoQuality\(\i\){/,
                replace: "$&$self.patchVoiceSettings(this);"
            }
        }
    ],

    patchVoiceSettings(thisObj: any) {
        try {
            console.log("[StereoSound] Starting voice settings patch...");
            
            // Check voice settings warnings
            const hasWarnings = this.settingsWarning();
            console.log(`[StereoSound] Voice settings warnings: ${hasWarnings}`);

            if (!thisObj.conn?.setTransportOptions) {
                console.warn("[StereoSound] conn.setTransportOptions not found");
                return;
            }

            const originalSetTransportOptions = thisObj.conn.setTransportOptions;
            console.log("[StereoSound] Successfully hooked setTransportOptions");
            
            thisObj.conn.setTransportOptions = function(obj: any) {
                console.log("[StereoSound] Transport options being modified:", obj);
                
                if (obj.audioEncoder) {
                    // Set stereo channels
                    obj.audioEncoder.params = {
                        stereo: settings.store.stereoChannels.toString()
                    };
                    obj.audioEncoder.channels = settings.store.stereoChannels;
                    console.log(`[StereoSound] Set stereo channels to: ${settings.store.stereoChannels}`);
                }
                
                // Disable FEC (Forward Error Correction) for better quality
                if (obj.fec) {
                    obj.fec = false;
                    console.log("[StereoSound] Disabled FEC");
                }
                
                // Set custom bitrate
                const bitrateValue = settings.store.bitrate * 1000; // Convert kbps to bps
                if (obj.encodingVoiceBitRate < bitrateValue) {
                    const oldValue = obj.encodingVoiceBitRate;
                    obj.encodingVoiceBitRate = bitrateValue;
                    console.log(`[StereoSound] Updated bitrate from ${oldValue} to ${bitrateValue} bps (${settings.store.bitrate} kbps)`);
                }
                
                // Priority speaker settings
                if (obj.prioritySpeaker) {
                    obj.prioritySpeaker = true;
                    if (obj.prioritySpeakerDucking) {
                        obj.prioritySpeakerDucking = 10e9;
                        console.log("[StereoSound] Set priority speaker ducking to maximum");
                    }
                    console.log("[StereoSound] Enabled priority speaker");
                }
                
                const result = originalSetTransportOptions.call(this, obj);
                console.log("[StereoSound] Transport options applied successfully");
                return result;
            };
            
            // Show success notification
            if (!this.settingsWarning() && settings.store.enableToasts) {
                showNotification({
                    title: "StereoSound",
                    body: "Stereo sound enabled successfully!",
                    color: "var(--green-360)"
                });
            }
        } catch (err) {
            console.error("[StereoSound] Error patching voice settings:", err);
        }
    },

    settingsWarning() {
        try {
            if (!VoiceSettingsStore) return false;
            
            const hasIssues = 
                VoiceSettingsStore.getNoiseSuppression?.() ||
                VoiceSettingsStore.getNoiseCancellation?.() ||
                VoiceSettingsStore.getEchoCancellation?.();
            
            if (hasIssues && settings.store.enableToasts) {
                showNotification({
                    title: "StereoSound Warning",
                    body: "Please disable echo cancellation, noise reduction, and noise suppression in Discord voice settings for optimal stereo quality.",
                    color: "var(--yellow-360)"
                });
            }
            
            return hasIssues;
        } catch (err) {
            console.error("[StereoSound] Error checking voice settings:", err);
            return false;
        }
    },

    start() {
        console.log("[StereoSound] Plugin started successfully");
        console.log(`[StereoSound] Current settings - Stereo Channels: ${settings.store.stereoChannels}, Bitrate: ${settings.store.bitrate}kbps`);
        
        // Plugin started
        if (settings.store.enableToasts) {
            showNotification({
                title: "StereoSound",
                body: "Plugin loaded. Make sure to disable noise suppression in Discord settings.",
                color: "var(--brand-500)"
            });
        }
    },

    stop() {
        console.log("[StereoSound] Plugin stopped");
        // Cleanup if needed
    }
});
