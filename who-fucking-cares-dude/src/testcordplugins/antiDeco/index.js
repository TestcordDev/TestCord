/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { UserStore } from "@webpack/common";
// Retrieval of necessary stores and actions
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelActions = findByPropsLazy("selectVoiceChannel");
// Variables to detect voluntary disconnections
let isVoluntaryDisconnect = false;
let disconnectTimeout = null;
let lastChannelId = null;
let isChannelSwitching = false;
let switchTimeout = null;
let originalSelectVoiceChannel = null;
let isActive = false;
const reconnectTimeouts = new Set();
function scheduleReconnectTimeout(callback, ms) {
    const timeout = setTimeout(() => {
        reconnectTimeouts.delete(timeout);
        if (isActive)
            callback();
    }, ms);
    reconnectTimeouts.add(timeout);
}
// Function to mark a disconnection as voluntary
function markVoluntaryDisconnect() {
    isVoluntaryDisconnect = true;
    console.log("[AntiDéco] Voluntary disconnection marked");
    // Reset the flag after a longer delay
    if (disconnectTimeout)
        clearTimeout(disconnectTimeout);
    disconnectTimeout = setTimeout(() => {
        isVoluntaryDisconnect = false;
        console.log("[AntiDéco] Voluntary disconnection flag reset");
    }, 3000);
}
// Function to mark a channel change
function markChannelSwitch() {
    isChannelSwitching = true;
    console.log("[AntiDéco] Channel change in progress");
    if (switchTimeout)
        clearTimeout(switchTimeout);
    switchTimeout = setTimeout(() => {
        isChannelSwitching = false;
        console.log("[AntiDéco] Channel change flag reset");
    }, 3000);
}
export default definePlugin({
    name: "AntiDisconnect",
    description: "Automatically reconnects to voice channel in case of forced disconnection",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.x2b],
    // Using the flux system to listen to voice events
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            // Security check for current user
            const currentUser = UserStore.getCurrentUser();
            if (!currentUser) {
                console.warn("[AntiDéco] Current user not available");
                return;
            }
            const currentUserId = currentUser.id;
            // Process each voice state change
            for (const state of voiceStates) {
                const { userId, channelId, oldChannelId } = state;
                // Only interested in events for the current user
                if (userId !== currentUserId)
                    continue;
                // Store the current channel for next time
                if (channelId) {
                    lastChannelId = channelId;
                }
                // Detection of a disconnection:
                // User was in a channel (oldChannelId exists)
                // but is no longer in any channel (channelId is null/undefined)
                if (oldChannelId && !channelId) {
                    console.log(`[AntiDéco] Disconnection detected from channel ${oldChannelId}`);
                    // Check if it's a voluntary disconnection
                    if (isVoluntaryDisconnect) {
                        console.log("[AntiDéco] Voluntary disconnection confirmed, no reconnection");
                        return;
                    }
                    // Check if it's a channel change in progress
                    if (isChannelSwitching) {
                        console.log("[AntiDéco] Channel change in progress, no reconnection");
                        return;
                    }
                    // Wait a bit to see if a new channel is selected (quick change)
                    scheduleReconnectTimeout(() => {
                        // Check again if it's not a voluntary disconnection
                        if (isVoluntaryDisconnect || isChannelSwitching) {
                            console.log("[AntiDéco] Voluntary disconnection or channel change detected during wait");
                            return;
                        }
                        const currentState = VoiceStateStore.getVoiceStateForUser(currentUserId);
                        // If user is now in another channel, it was a change
                        if (currentState?.channelId) {
                            console.log(`[AntiDéco] Channel change detected (${oldChannelId} -> ${currentState.channelId}), no reconnection`);
                            return;
                        }
                        // If we get here, it's really a forced disconnection
                        console.log(`[AntiDéco] FORCED disconnection confirmed from channel ${oldChannelId}`);
                        // Attempt reconnection
                        scheduleReconnectTimeout(() => {
                            try {
                                console.log(`[AntiDéco] Attempting reconnection to channel ${oldChannelId}`);
                                // Use original function to avoid loops
                                if (originalSelectVoiceChannel) {
                                    originalSelectVoiceChannel.call(ChannelActions, oldChannelId);
                                }
                                else {
                                    ChannelActions.selectVoiceChannel(oldChannelId);
                                }
                            }
                            catch (error) {
                                console.error("[AntiDéco] Error during reconnection:", error);
                            }
                        }, 100);
                    }, 200);
                }
            }
        },
        // Listen to voluntary disconnection actions
        VOICE_CHANNEL_SELECT({ channelId }) {
            const currentUser = UserStore.getCurrentUser();
            if (!currentUser)
                return;
            const currentUserId = currentUser.id;
            const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
            if (currentVoiceState?.channelId) {
                if (channelId === null) {
                    // Voluntary disconnection
                    console.log("[AntiDéco] Voluntary disconnection action detected via VOICE_CHANNEL_SELECT");
                    markVoluntaryDisconnect();
                }
                else if (channelId !== currentVoiceState.channelId) {
                    // Channel change
                    console.log(`[AntiDéco] Channel change detected via VOICE_CHANNEL_SELECT (${currentVoiceState.channelId} -> ${channelId})`);
                    markChannelSwitch();
                }
            }
        },
    },
    start() {
        isActive = true;
        console.log("[AntiDéco] AntiDisconnection plugin initialized");
        // Check that stores are available
        if (!ChannelActions || !VoiceStateStore || !UserStore) {
            console.error("[AntiDéco] Error: Discord stores not available");
            return;
        }
        // Save the original function
        originalSelectVoiceChannel = ChannelActions.selectVoiceChannel;
        // Listen to click events on the disconnect button
        ChannelActions.selectVoiceChannel = function (channelId) {
            const currentUser = UserStore.getCurrentUser();
            if (!currentUser)
                return originalSelectVoiceChannel.call(this, channelId);
            const currentUserId = currentUser.id;
            const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
            if (currentVoiceState?.channelId) {
                if (channelId === null) {
                    // Voluntary disconnection
                    console.log("[AntiDéco] Voluntary disconnection intercepted via selectVoiceChannel");
                    markVoluntaryDisconnect();
                }
                else if (channelId !== currentVoiceState.channelId) {
                    // Channel change
                    console.log(`[AntiDéco] Channel change intercepted via selectVoiceChannel (${currentVoiceState.channelId} -> ${channelId})`);
                    markChannelSwitch();
                }
            }
            return originalSelectVoiceChannel.call(this, channelId);
        };
    },
    stop() {
        isActive = false;
        console.log("[AntiDéco] AntiDisconnection plugin stopped");
        // Restore the original function
        if (originalSelectVoiceChannel && ChannelActions) {
            ChannelActions.selectVoiceChannel = originalSelectVoiceChannel;
            originalSelectVoiceChannel = null;
        }
        if (disconnectTimeout) {
            clearTimeout(disconnectTimeout);
            disconnectTimeout = null;
        }
        if (switchTimeout) {
            clearTimeout(switchTimeout);
            switchTimeout = null;
        }
        for (const timeout of reconnectTimeouts)
            clearTimeout(timeout);
        reconnectTimeouts.clear();
        isVoluntaryDisconnect = false;
        isChannelSwitching = false;
        lastChannelId = null;
    },
});
