/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Constants, Menu, React, RestAPI, SelectedGuildStore, VoiceStateStore, } from "@webpack/common";
let leashedUserInfo = null;
let myLastChannelId = null;
const ChannelActions = findByPropsLazy("selectChannel", "selectVoiceChannel");
const UserStore = findStoreLazy("UserStore");
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const settings = definePluginSettings({
    enabled: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Enable Leash plugin",
    },
    onlyWhenInVoice: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Only move the user when you are in a voice channel",
    },
    showNotifications: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Show notifications during moves",
    },
});
// Function to move a user to a voice channel
async function moveUserToVoiceChannel(userId, channelId) {
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) {
        throw new Error("No server selected");
    }
    try {
        // Use Discord API to move the user
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
            body: {
                channel_id: channelId,
            },
        });
        if (settings.store.showNotifications) {
            const user = UserStore.getUser(userId);
            showNotification({
                title: "Leash - Success",
                body: `${user?.username || "User"} has been moved to your voice channel`,
            });
        }
    }
    catch (error) {
        console.error("Leash: Discord API error:", error);
        throw error;
    }
}
const UserContextMenuPatch = (children, { channel, user }) => {
    if (UserStore.getCurrentUser().id === user.id)
        return;
    const isLeashed = leashedUserInfo?.userId === user.id;
    children.push(<Menu.MenuSeparator />, <Menu.MenuCheckboxItem id="laisse-leash-user" label="Leash - Hook the user" checked={isLeashed} action={() => {
            if (leashedUserInfo?.userId === user.id) {
                leashedUserInfo = null;
                showNotification({
                    title: "Leash",
                    body: `User ${user.username} is no longer hooked`,
                });
                return;
            }
            leashedUserInfo = {
                userId: user.id,
                lastChannelId: null,
            };
            showNotification({
                title: "Leash",
                body: `User ${user.username} is now hooked to you`,
            });
        }}/>);
};
export default definePlugin({
    name: "Leash",
    description: "Leashes a user to you by automatically moving them to the voice channel you go to",
    tags: ["Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    contextMenus: {
        "user-context": UserContextMenuPatch,
    },
    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }) {
            if (!leashedUserInfo || !settings.store.enabled)
                return;
            const myId = UserStore.getCurrentUser().id;
            const myCurrentChannelId = SelectedChannelStore.getVoiceChannelId();
            // Check if we should only act when in voice
            if (settings.store.onlyWhenInVoice && !myCurrentChannelId)
                return;
            for (const voiceState of voiceStates) {
                // Detect when current user changes voice channel
                if (voiceState.userId === myId &&
                    voiceState.channelId !== myLastChannelId) {
                    myLastChannelId = voiceState.channelId;
                    // If we have a hooked user and we join a voice channel
                    if (voiceState.channelId && leashedUserInfo.userId) {
                        const leashedUserVoiceState = VoiceStateStore.getVoiceStateForUser(leashedUserInfo.userId);
                        // If the hooked user is in a different voice channel
                        if (leashedUserVoiceState &&
                            leashedUserVoiceState.channelId !== voiceState.channelId) {
                            try {
                                // Try to move the hooked user to our channel
                                // Note: This feature requires moderation permissions
                                const user = UserStore.getUser(leashedUserInfo.userId);
                                if (settings.store.showNotifications) {
                                    showNotification({
                                        title: "Leash",
                                        body: `Attempting to move ${user?.username || "user"} to your voice channel`,
                                    });
                                }
                                // Use Discord API to move the user
                                await moveUserToVoiceChannel(leashedUserInfo.userId, voiceState.channelId);
                            }
                            catch (error) {
                                console.error("Leash: Error during move:", error);
                                if (settings.store.showNotifications) {
                                    showNotification({
                                        title: "Leash - Error",
                                        body: "Unable to move user (insufficient permissions)",
                                    });
                                }
                            }
                        }
                    }
                }
            }
        },
    },
    start() {
        myLastChannelId = SelectedChannelStore.getVoiceChannelId();
    },
    stop() {
        leashedUserInfo = null;
        myLastChannelId = null;
    },
});
