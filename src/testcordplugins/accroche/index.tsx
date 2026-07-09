/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import {
    Constants,
    Menu,
    React,
    RestAPI,
    UserStore,
} from "@webpack/common";

// Retrieval of necessary stores and actions
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelActions = findByPropsLazy("selectVoiceChannel");
const SelectedGuildStore = findStoreLazy("SelectedGuildStore");

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    guildId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    selfStream: boolean;
    selfVideo: boolean;
    sessionId: string;
    suppress: boolean;
    requestToSpeakTimestamp: string | null;
}

interface HookedUserInfo {
    userId: string;
    username: string;
    lastChannelId: string | null;
    isHooked: boolean;
}

interface AnchoredUserInfo {
    userId: string;
    username: string;
    lastChannelId: string | null;
    isAnchored: boolean;
}

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Hook plugin",
        default: true,
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications during actions",
        default: true,
    },
    verboseLogs: {
        type: OptionType.BOOLEAN,
        description: "Show detailed logs in console",
        default: true,
    },
    preventSelfMove: {
        type: OptionType.BOOLEAN,
        description: "Prevent the hooked user from moving manually",
        default: true,
    },
    autoReconnectDelay: {
        type: OptionType.NUMBER,
        description: "Delay before reconnecting the user (in milliseconds)",
        default: 1000,
        min: 500,
        max: 5000,
    },
    enableAnchor: {
        type: OptionType.BOOLEAN,
        description:
            "Enable anchoring feature (automatically return to the anchored person's channel)",
        default: true,
    },
    anchorDelay: {
        type: OptionType.NUMBER,
        description:
            "Delay before returning to the anchored person's channel (in milliseconds)",
        default: 2000,
        min: 1000,
        max: 10000,
    },
    anchorNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications during anchoring actions",
        default: true,
    },
});

// Global variables
let hookedUserInfo: HookedUserInfo | null = null;
let anchoredUserInfo: AnchoredUserInfo | null = null;
let originalSelectVoiceChannel: any = null;
const isPreventingMove = false;
let anchorMonitoringInterval: NodeJS.Timeout | null = null;

// Log function with prefix
function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[Hook ${timestamp}]`;

    switch (level) {
        case "warn":
            console.warn(prefix, message);
            break;
        case "error":
            console.error(prefix, message);
            break;
        default:
            console.log(prefix, message);
    }
}

// Verbose log function (only if enabled)
function verboseLog(message: string) {
    if (settings.store.verboseLogs) {
        log(message);
    }
}

// Function to move a user to a voice channel
async function moveUserToVoiceChannel(
    userId: string,
    channelId: string
): Promise<void> {
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) {
        throw new Error("No server selected");
    }

    try {
        verboseLog(`🔄 Attempting to move user ${userId} to channel ${channelId}`);

        // Use Discord API to move the user
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
            body: {
                channel_id: channelId,
            },
        });

        verboseLog(`✅ User ${userId} successfully moved to channel ${channelId}`);

        if (settings.store.showNotifications) {
            const user = UserStore.getUser(userId);
            showNotification({
                title: "🔗 Hook - Success",
                body: `${user?.username || "User"
                    } has been brought back to your voice channel`,
            });
        }
    } catch (error) {
        console.error("Hook: Discord API error:", error);
        throw error;
    }
}

// Function to hook a user
async function hookUser(userId: string, username: string) {
    verboseLog(
        `🚀 Starting hookUser function for ${username} (${userId})`
    );

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) {
        log("❌ Current user not available", "error");
        return;
    }

    verboseLog(
        `✅ Current user found: ${currentUser.username} (${currentUser.id})`
    );

    const currentUserId = currentUser.id;
    if (userId === currentUserId) {
        log("❌ Cannot hook to yourself", "warn");
        if (settings.store.showNotifications) {
            showNotification({
                title: "🔗 Hook - Error",
                body: "You cannot hook to yourself!",
            });
        }
        return;
    }

    // Check if user is already hooked
    if (hookedUserInfo && hookedUserInfo.userId === userId) {
        log(`⚠️ User ${username} is already hooked`, "warn");
        if (settings.store.showNotifications) {
            showNotification({
                title: "🔗 Hook - Info",
                body: `${username} is already hooked to you`,
            });
        }
        return;
    }

    // Get current voice state of the user with a delay to allow RTC connection to establish
    let userVoiceState = VoiceStateStore.getVoiceStateForUser(userId);
    let currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);

    verboseLog(
        `🔍 Initial voice state - User: ${userVoiceState?.channelId || "null"
        }, You: ${currentVoiceState?.channelId || "null"}`
    );

    // If voice state is not immediately available, wait a bit
    if (!userVoiceState?.channelId || !currentVoiceState?.channelId) {
        verboseLog("⏳ Voice state not immediately available, waiting 500ms...");

        await sleep(500);

        userVoiceState = VoiceStateStore.getVoiceStateForUser(userId);
        currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);

        verboseLog(
            `🔍 Voice state after wait - User: ${userVoiceState?.channelId || "null"
            }, You: ${currentVoiceState?.channelId || "null"}`
        );
    }

    if (!userVoiceState?.channelId) {
        log(`❌ User ${username} is not in a voice channel`, "warn");
        if (settings.store.showNotifications) {
            showNotification({
                title: "🔗 Hook - Error",
                body: `${username} is not in a voice channel`,
            });
        }
        return;
    }

    if (!currentVoiceState?.channelId) {
        log("❌ You are not in a voice channel", "warn");
        if (settings.store.showNotifications) {
            showNotification({
                title: "🔗 Hook - Error",
                body: "You must be in a voice channel to hook someone",
            });
        }
        return;
    }

    // Hook the user
    hookedUserInfo = {
        userId,
        username,
        lastChannelId: userVoiceState.channelId,
        isHooked: true,
    };

    log(`🔗 User ${username} (${userId}) hooked successfully`);
    verboseLog(`📊 Hook information:
- User: ${username} (${userId})
- Current channel: ${userVoiceState.channelId}
- Your channel: ${currentVoiceState.channelId}`);

    if (settings.store.showNotifications) {
        showNotification({
            title: "🔗 Hook - Enabled",
            body: `${username} is now hooked to you`,
        });
    }
}

// Function to unhook a user
function unhookUser() {
    if (!hookedUserInfo) {
        log("⚠️ No user hooked", "warn");
        return;
    }

    const { username } = hookedUserInfo;
    hookedUserInfo = null;

    log(`🔓 User ${username} unhooked`);

    if (settings.store.showNotifications) {
        showNotification({
            title: "🔗 Hook - Disabled",
            body: `${username} is no longer hooked`,
        });
    }
}

// Function to anchor a user (follow them)
async function anchorUser(userId: string, username: string) {
    verboseLog(
        `🚀 Starting anchorUser function for ${username} (${userId})`
    );

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) {
        log("❌ Current user not available", "error");
        return;
    }

    verboseLog(
        `✅ Current user found: ${currentUser.username} (${currentUser.id})`
    );

    const currentUserId = currentUser.id;
    if (userId === currentUserId) {
        log("❌ Cannot anchor to yourself", "warn");
        if (settings.store.anchorNotifications) {
            showNotification({
                title: "⚓ Anchor - Error",
                body: "You cannot anchor to yourself!",
            });
        }
        return;
    }

    // Check if user is already anchored
    if (anchoredUserInfo && anchoredUserInfo.userId === userId) {
        log(`⚠️ User ${username} is already anchored`, "warn");
        if (settings.store.anchorNotifications) {
            showNotification({
                title: "⚓ Anchor - Info",
                body: `${username} is already anchored`,
            });
        }
        return;
    }

    // Get current voice state of the user with a delay to allow RTC connection to establish
    let userVoiceState = VoiceStateStore.getVoiceStateForUser(userId);
    let currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);

    verboseLog(
        `🔍 Initial voice state (anchoring) - User: ${userVoiceState?.channelId || "null"
        }, You: ${currentVoiceState?.channelId || "null"}`
    );

    // If voice state is not immediately available, wait a bit
    if (!userVoiceState?.channelId || !currentVoiceState?.channelId) {
        verboseLog(
            "⏳ Voice state not immediately available for anchoring, waiting 500ms..."
        );

        await sleep(500);

        userVoiceState = VoiceStateStore.getVoiceStateForUser(userId);
        currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);

        verboseLog(
            `🔍 Voice state after wait (anchoring) - User: ${userVoiceState?.channelId || "null"
            }, You: ${currentVoiceState?.channelId || "null"}`
        );
    }

    if (!userVoiceState?.channelId) {
        log(`❌ User ${username} is not in a voice channel`, "warn");
        if (settings.store.anchorNotifications) {
            showNotification({
                title: "⚓ Anchor - Error",
                body: `${username} is not in a voice channel`,
            });
        }
        return;
    }

    if (!currentVoiceState?.channelId) {
        log("❌ You are not in a voice channel", "warn");
        if (settings.store.anchorNotifications) {
            showNotification({
                title: "⚓ Anchor - Error",
                body: "You must be in a voice channel to anchor someone",
            });
        }
        return;
    }

    // Anchor the user
    anchoredUserInfo = {
        userId,
        username,
        lastChannelId: userVoiceState.channelId,
        isAnchored: true,
    };

    log(`⚓ User ${username} (${userId}) anchored successfully`);
    verboseLog(`📊 Anchoring information:
- User: ${username} (${userId})
- Current channel: ${userVoiceState.channelId}
- Your channel: ${currentVoiceState.channelId}`);

    // Start periodic monitoring
    startAnchorMonitoring();

    if (settings.store.anchorNotifications) {
        showNotification({
            title: "⚓ Anchor - Enabled",
            body: `You will automatically return to ${username}'s channel if you are moved`,
        });
    }
}

// Function to unanchor a user
function unanchorUser() {
    if (!anchoredUserInfo) {
        log("⚠️ No user anchored", "warn");
        return;
    }

    const { username } = anchoredUserInfo;
    anchoredUserInfo = null;

    // Stop periodic monitoring
    stopAnchorMonitoring();

    log(`⚓ User ${username} unanchored`);

    if (settings.store.anchorNotifications) {
        showNotification({
            title: "⚓ Anchor - Disabled",
            body: `You are no longer anchored to ${username}`,
        });
    }
}

// Function to start periodic anchoring monitoring
function startAnchorMonitoring() {
    if (anchorMonitoringInterval) {
        clearInterval(anchorMonitoringInterval);
    }

    console.log("🔍🔍🔍 STARTING ANCHOR MONITORING 🔍🔍🔍");

    anchorMonitoringInterval = setInterval(() => {
        if (!anchoredUserInfo) {
            verboseLog("🔍 Anchor monitoring: No user anchored");
            return;
        }

        const currentUser = UserStore.getCurrentUser();
        if (!currentUser) {
            verboseLog("🔍 Anchor monitoring: Current user not available");
            return;
        }

        const currentUserId = currentUser.id;
        const myVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
        const anchoredUserVoiceState = VoiceStateStore.getVoiceStateForUser(
            anchoredUserInfo.userId
        );

        if (!myVoiceState?.channelId || !anchoredUserVoiceState?.channelId) {
            verboseLog(
                `🔍 Anchor monitoring: One of the users is not in a voice channel - You: ${myVoiceState?.channelId || "null"
                }, Anchored: ${anchoredUserVoiceState?.channelId || "null"}`
            );
            return;
        }

        // Periodic log to check state
        if (Math.random() < 0.1) {
            // 10% chance on each check
            verboseLog(
                `🔍 Anchor monitoring: You: ${myVoiceState.channelId}, ${anchoredUserInfo.username}: ${anchoredUserVoiceState.channelId}`
            );
        }

        // If we're not in the same channel as the anchored person
        if (myVoiceState.channelId !== anchoredUserVoiceState.channelId) {
            console.log("🚨🚨🚨 ANCHOR MONITORING - MOVEMENT DETECTED 🚨🚨🚨");
            console.log(
                `You: ${myVoiceState.channelId}, Anchored person: ${anchoredUserVoiceState.channelId}`
            );

            log(
                `⚠️ Monitoring: You have been moved, automatic return to ${anchoredUserInfo.username}'s channel`
            );

            // Return to the anchored person's channel
            setTimeout(async () => {
                try {
                    await moveCurrentUserToVoiceChannel(anchoredUserVoiceState.channelId);
                } catch (error) {
                    log(`❌ Error during automatic return: ${error}`, "error");
                }
            }, settings.store.anchorDelay);
        }
    }, 1000); // Check every second
}

// Function to stop periodic anchoring monitoring
function stopAnchorMonitoring() {
    if (anchorMonitoringInterval) {
        console.log("🛑🛑🛑 STOPPING ANCHOR MONITORING 🛑🛑🛑");
        clearInterval(anchorMonitoringInterval);
        anchorMonitoringInterval = null;
    }
}

// Function to move current user to a voice channel
async function moveCurrentUserToVoiceChannel(channelId: string): Promise<void> {
    console.log("🚀🚀🚀 MOVING CURRENT USER TO CHANNEL 🚀🚀🚀", channelId);

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) {
        console.error("❌❌❌ CURRENT USER NOT AVAILABLE ❌❌❌");
        throw new Error("Current user not available");
    }

    try {
        console.log(
            `🔄 Attempting to move ${currentUser.username} to channel ${channelId}`
        );
        verboseLog(`🔄 Attempting to move to channel ${channelId}`);

        // Use Discord API to move
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(
                SelectedGuildStore.getGuildId(),
                currentUser.id
            ),
            body: {
                channel_id: channelId,
            },
        });

        verboseLog(`✅ Move to channel ${channelId} successful`);

        if (settings.store.anchorNotifications) {
            showNotification({
                title: "⚓ Anchor - Automatic return",
                body: `You have returned to ${anchoredUserInfo?.username}'s channel`,
            });
        }
    } catch (error) {
        console.error("Anchor: Discord API error:", error);
        throw error;
    }
}

// Context menu for users
const UserContextMenuPatch: NavContextMenuPatchCallback = (
    children,
    { user }: { user: any; }
) => {
    // Keep this path quiet: it runs on every user right-click when the plugin is enabled.
    verboseLog(`🔍 Context menu called for ${user?.username || "unknown user"}`);

    if (!settings.store.enabled || !user) {
        verboseLog(
            `❌ Plugin disabled or user missing - enabled: ${settings.store.enabled
            }, user: ${!!user}`
        );
        return;
    }

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || user.id === currentUser.id) {
        verboseLog(
            `❌ Current user missing or same user - currentUser: ${!!currentUser}, sameUser: ${user.id === currentUser?.id
            }`
        );
        return;
    }

    verboseLog(`✅ Context menu added for ${user.username}`);

    const isCurrentlyHooked = hookedUserInfo?.userId === user.id;
    const isCurrentlyAnchored = anchoredUserInfo?.userId === user.id;

    children.push(
        React.createElement(Menu.MenuSeparator, {}),
        React.createElement(Menu.MenuItem, {
            id: "hook-user",
            label: isCurrentlyHooked
                ? `🔓 Unhook ${user.username}`
                : `🔗 Hook ${user.username}`,
            action: async () => {
                if (isCurrentlyHooked) {
                    unhookUser();
                } else {
                    await hookUser(user.id, user.username);
                }
            },
        })
    );

    // Add anchoring option if enabled
    if (settings.store.enableAnchor) {
        children.push(
            React.createElement(Menu.MenuItem, {
                id: "anchor-user",
                label: isCurrentlyAnchored
                    ? `⚓ Unanchor ${user.username}`
                    : `⚓ Anchor ${user.username}`,
                action: async () => {
                    if (isCurrentlyAnchored) {
                        unanchorUser();
                    } else {
                        await anchorUser(user.id, user.username);
                    }
                },
            })
        );
    }
};

export default definePlugin({
    name: "Hook",
    description:
        "Hooks a user to prevent them from changing voice channels or anchors to a user to automatically return to their channel",
    tags: ["Voice", "Utility"],
    authors: [
        {
            name: "Bash",
            id: 1327483363518582784n,
        },
        TestcordDevs.x2b
    ],
    settings,

    contextMenus: {
        "user-context": UserContextMenuPatch,
    },

    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!settings.store.enabled) return;

            const currentUser = UserStore.getCurrentUser();
            if (!currentUser) return;

            const currentUserId = currentUser.id;
            const currentVoiceState =
                VoiceStateStore.getVoiceStateForUser(currentUserId);

            // If current user is not in a voice channel, do nothing
            if (!currentVoiceState?.channelId) {
                verboseLog(
                    "🔇 You are not in a voice channel, hooking/anchoring suspended"
                );
                return;
            }

            // Anchoring logic (automatically return to the anchored person's channel)
            if (anchoredUserInfo) {
                console.log(
                    "🔍🔍🔍 ANCHORING ACTIVE - Checking channel changes 🔍🔍🔍"
                );
                verboseLog(
                    `⚓ Anchoring active for ${anchoredUserInfo.username} (${anchoredUserInfo.userId})`
                );

                for (const voiceState of voiceStates) {
                    const { userId, channelId, oldChannelId } = voiceState;

                    // Detect when YOU are moved (current user)
                    if (
                        userId === currentUserId &&
                        channelId !== currentVoiceState.channelId
                    ) {
                        console.log(
                            "🚨🚨🚨 MOVEMENT DETECTED - ANCHORING IN PROGRESS 🚨🚨🚨"
                        );
                        console.log(
                            `You: ${currentUserId}, Old channel: ${currentVoiceState.channelId}, New channel: ${channelId}`
                        );
                        verboseLog(
                            `🔄 You have been moved: ${currentVoiceState.channelId} -> ${channelId}`
                        );

                        // Check if the person you're anchored to is still in a voice channel
                        const anchoredUserVoiceState = VoiceStateStore.getVoiceStateForUser(
                            anchoredUserInfo!.userId
                        );

                        if (!anchoredUserVoiceState?.channelId) {
                            log(
                                `🚪 ${anchoredUserInfo!.username
                                } left the voice channel, anchoring suspended`
                            );
                            if (settings.store.anchorNotifications) {
                                showNotification({
                                    title: "⚓ Anchor - Suspended",
                                    body: `${anchoredUserInfo!.username} left the voice channel`,
                                });
                            }
                            continue;
                        }

                        // If you're not in the same channel as the anchored person
                        if (channelId !== anchoredUserVoiceState.channelId) {
                            log(
                                `⚠️ You have been moved, automatic return to ${anchoredUserInfo!.username
                                }'s channel`
                            );

                            // Wait for a delay before returning to the anchored person's channel
                            setTimeout(async () => {
                                try {
                                    // Check that the user is still anchored
                                    const currentAnchoredState =
                                        VoiceStateStore.getVoiceStateForUser(
                                            anchoredUserInfo!.userId
                                        );
                                    const myCurrentState =
                                        VoiceStateStore.getVoiceStateForUser(currentUserId);

                                    if (!anchoredUserInfo || !currentAnchoredState?.channelId) {
                                        verboseLog(
                                            "🔍 User no longer anchored or anchored person no longer in a voice channel"
                                        );
                                        return;
                                    }

                                    if (
                                        myCurrentState?.channelId === currentAnchoredState.channelId
                                    ) {
                                        verboseLog("✅ You are already in the correct channel");
                                        return;
                                    }

                                    // Return to the anchored person's channel
                                    await moveCurrentUserToVoiceChannel(
                                        currentAnchoredState.channelId
                                    );
                                } catch (error) {
                                    log(
                                        `❌ Error during return to ${anchoredUserInfo!.username
                                        }: ${error}`,
                                        "error"
                                    );

                                    if (settings.store.anchorNotifications) {
                                        showNotification({
                                            title: "⚓ Anchor - Error",
                                            body: `Unable to return to ${anchoredUserInfo!.username
                                                }'s channel`,
                                        });
                                    }
                                }
                            }, settings.store.anchorDelay);
                        }
                    }
                }
            }

            // Hooking logic (prevent a user from moving)
            if (!hookedUserInfo) return;

            for (const voiceState of voiceStates) {
                const { userId, channelId, oldChannelId } = voiceState;

                // Detect when the hooked user changes voice channel
                if (
                    userId === hookedUserInfo!.userId &&
                    channelId !== hookedUserInfo!.lastChannelId
                ) {
                    verboseLog(
                        `🔄 Channel change detected for ${hookedUserInfo!.username
                        }: ${oldChannelId} -> ${channelId}`
                    );

                    // Update the last known channel
                    hookedUserInfo!.lastChannelId = channelId || null;

                    // If the hooked user left the voice channel
                    if (!channelId) {
                        log(`🚪 ${hookedUserInfo!.username} left the voice channel`);
                        if (settings.store.showNotifications) {
                            showNotification({
                                title: "🔗 Hook - Info",
                                body: `${hookedUserInfo!.username} left the voice channel`,
                            });
                        }
                        continue;
                    }

                    // If the hooked user is in a different channel than yours
                    if (channelId !== currentVoiceState.channelId) {
                        log(
                            `⚠️ ${hookedUserInfo!.username
                            } changed channels, attempting to bring back to your channel`
                        );

                        // Wait for a delay before bringing the user back
                        setTimeout(async () => {
                            try {
                                // Check that the user is still hooked and in a different channel
                                const currentHookedState =
                                    VoiceStateStore.getVoiceStateForUser(
                                        hookedUserInfo!.userId
                                    );
                                const myCurrentState =
                                    VoiceStateStore.getVoiceStateForUser(currentUserId);

                                if (!hookedUserInfo || !myCurrentState?.channelId) {
                                    verboseLog(
                                        "🔍 User no longer hooked or you are no longer in a voice channel"
                                    );
                                    return;
                                }

                                if (
                                    currentHookedState?.channelId === myCurrentState.channelId
                                ) {
                                    verboseLog("✅ User is already in your channel");
                                    return;
                                }

                                // Bring the user back to your channel
                                await moveUserToVoiceChannel(
                                    hookedUserInfo!.userId,
                                    myCurrentState.channelId
                                );
                            } catch (error) {
                                log(
                                    `❌ Error during move of ${hookedUserInfo!.username
                                    }: ${error}`,
                                    "error"
                                );

                                if (settings.store.showNotifications) {
                                    showNotification({
                                        title: "🔗 Hook - Error",
                                        body: `Unable to bring ${hookedUserInfo!.username
                                            } back to your channel`,
                                    });
                                }
                            }
                        }, settings.store.autoReconnectDelay);
                    }
                }

                // Detect when current user changes voice channel
                if (
                    userId === currentUserId &&
                    channelId !== currentVoiceState.channelId
                ) {
                    verboseLog(
                        `🔄 You changed channels: ${currentVoiceState.channelId} -> ${channelId}`
                    );

                    // If we have a hooked user and we join a new channel
                    if (channelId && hookedUserInfo) {
                        const hookedUserVoiceState =
                            VoiceStateStore.getVoiceStateForUser(hookedUserInfo.userId);

                        // If the hooked user is in a different voice channel
                        if (
                            hookedUserVoiceState?.channelId &&
                            hookedUserVoiceState.channelId !== channelId
                        ) {
                            log(
                                `🔄 You changed channels, moving ${hookedUserInfo!.username
                                } to your new channel`
                            );

                            setTimeout(async () => {
                                try {
                                    await moveUserToVoiceChannel(
                                        hookedUserInfo!.userId,
                                        channelId
                                    );
                                } catch (error) {
                                    log(
                                        `❌ Error during move of ${hookedUserInfo!.username
                                        }: ${error}`,
                                        "error"
                                    );
                                }
                            }, settings.store.autoReconnectDelay);
                        }
                    }
                }
            }
        },
    },

    start() {
        console.log("🚀🚀🚀 HOOK PLUGIN STARTED 🚀🚀🚀");
        log("🚀 Hook plugin started");
        log(`⚙️ Current configuration:
- Notifications: ${settings.store.showNotifications ? "ON" : "OFF"}
- Verbose logs: ${settings.store.verboseLogs ? "ON" : "OFF"}
- Prevent manual move: ${settings.store.preventSelfMove ? "ON" : "OFF"}
- Reconnect delay: ${settings.store.autoReconnectDelay}ms
- Anchoring enabled: ${settings.store.enableAnchor ? "ON" : "OFF"}
- Anchor delay: ${settings.store.anchorDelay}ms
- Anchor notifications: ${settings.store.anchorNotifications ? "ON" : "OFF"}`);

        // Check that stores are available
        console.log("🔍 Checking stores:");
        console.log("- VoiceStateStore:", !!VoiceStateStore);
        console.log("- ChannelActions:", !!ChannelActions);
        console.log("- UserStore:", !!UserStore);
        console.log("- PermissionStore: not imported (normal)");

        // Start periodic monitoring for anchoring
        if (settings.store.enableAnchor) {
            console.log("🔍🔍🔍 STARTING ANCHOR MONITORING AT START 🔍🔍🔍");
            startAnchorMonitoring();
        }

        // Save the original function if we want to prevent manual moves
        if (settings.store.preventSelfMove && ChannelActions) {
            originalSelectVoiceChannel = ChannelActions.selectVoiceChannel;

            // Intercept channel change attempts from the hooked user
            ChannelActions.selectVoiceChannel = function (channelId: string | null) {
                if (hookedUserInfo && !isPreventingMove) {
                    const currentUser = UserStore.getCurrentUser();
                    if (currentUser && hookedUserInfo.userId === currentUser.id) {
                        log(
                            `🚫 Manual move attempt blocked for ${hookedUserInfo.username}`
                        );

                        if (settings.store.showNotifications) {
                            showNotification({
                                title: "🔗 Hook - Blocked",
                                body: "You cannot change voice channels because you are hooked",
                            });
                        }
                        return;
                    }
                }

                return originalSelectVoiceChannel.call(this, channelId);
            };
        }

        if (settings.store.showNotifications) {
            showNotification({
                title: "🔗 Hook enabled",
                body: "User hooking and anchoring plugin enabled - You will automatically return to the anchored person's channel if you are moved",
            });
        }
    },

    stop() {
        log("🛑 Hook plugin stopped");

        // Stop periodic monitoring
        stopAnchorMonitoring();

        // Restore the original function
        if (originalSelectVoiceChannel && ChannelActions) {
            ChannelActions.selectVoiceChannel = originalSelectVoiceChannel;
            originalSelectVoiceChannel = null;
        }

        // Unhook the user if there is one
        if (hookedUserInfo) {
            unhookUser();
        }

        // Unanchor the user if there is one
        if (anchoredUserInfo) {
            unanchorUser();
        }

        if (settings.store.showNotifications) {
            showNotification({
                title: "🔗 Hook disabled",
                body: "User hooking and anchoring plugin disabled",
            });
        }
    },
});
