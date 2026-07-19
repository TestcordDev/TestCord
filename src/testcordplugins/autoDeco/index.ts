/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    NavContextMenuPatchCallback,
} from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { FluxDispatcher, Menu, React } from "@webpack/common";

const VoiceActions = findByPropsLazy("leaveChannel");
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const UserStore = findStoreLazy("UserStore");
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Enable AutoDeco",
    },
});

let targetUserId: string | null = null;
const lastProcessedStates: Map<string, string | null> = new Map();

const UserContextMenuPatch: NavContextMenuPatchCallback = (
    children,
    { user }: { user: User; }
) => {
    const currentUser = UserStore.getCurrentUser();
    if (!user || user.id === currentUser.id) return;
    const isTarget = targetUserId === user.id;
    children.push(
        React.createElement(Menu.MenuSeparator, {}),
        React.createElement(Menu.MenuCheckboxItem, {
            id: "autodeco-context",
            label: isTarget ? "Disable AutoDeco" : "Enable AutoDeco",
            checked: isTarget,
            action: () => {
                if (targetUserId === user.id) {
                    targetUserId = null;
                    showNotification({
                        title: "AutoDeco",
                        body: `AutoDeco disabled for ${user.username}`,
                    });
                } else {
                    targetUserId = user.id;
                    showNotification({
                        title: "AutoDeco",
                        body: `AutoDeco enabled for ${user.username}`,
                    });
                }
            },
        })
    );
};

export default definePlugin({
    name: "AutoDisconnect",
    description:
        "Automatically disconnects from voice channel when a specific user joins",
    tags: ["Utility", "Customisation"],
    authors: [TestcordDevs.x2b],
    settings,
    contextMenus: {
        "user-context": UserContextMenuPatch,
    },
    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }) {
            if (!targetUserId || !settings.store.enabled) return;
            const currentUserId = UserStore.getCurrentUser().id;
            const currentChannelId = SelectedChannelStore.getVoiceChannelId();

            for (const state of voiceStates) {
                if (state.userId === targetUserId) {
                    const previousChannelId = lastProcessedStates.get(state.userId);

                    // Check if the user just joined our voice channel
                    if (
                        state.channelId &&
                        currentChannelId &&
                        state.channelId === currentChannelId &&
                        previousChannelId !== currentChannelId
                    ) {
                        // Target user just joined the same voice channel as us
                        console.log("AutoDeco: Automatic disconnection triggered", {
                            targetUser: state.user?.username,
                            channelId: state.channelId,
                            currentChannelId,
                            previousChannelId,
                        });

                        // Use FluxDispatcher to disconnect (more reliable)
                        FluxDispatcher.dispatch({
                            type: "VOICE_CHANNEL_SELECT",
                            channelId: null,
                        });
                        showNotification({
                            title: "AutoDeco",
                            body: `Automatic disconnection: ${state.user?.username || "User"
                                } joined your voice channel`,
                        });
                    }

                    // Update previous state
                    lastProcessedStates.set(state.userId, state.channelId);
                }
            }
        },
    },
    start() { },
    stop() {
        targetUserId = null;
        lastProcessedStates.clear();
    },
});
