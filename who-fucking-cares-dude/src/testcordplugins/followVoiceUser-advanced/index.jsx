/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Forms, Menu, React, VoiceStateStore } from "@webpack/common";
let followedUserInfo = null;
const voiceChannelAction = findByPropsLazy("selectVoiceChannel");
const UserStore = findStoreLazy("UserStore");
// const RelationshipStore = findStoreLazy("RelationshipStore");  // Artık gerek yok
const settings = definePluginSettings({
    onlyWhenInVoice: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Only follow the user when you are in a voice channel"
    },
    leaveWhenUserLeaves: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Leave the voice channel when the user leaves. (That can cause you to sometimes enter infinite leave/join loop)"
    }
});
const UserContextMenuPatch = (children, { channel, user }) => {
    if (UserStore.getCurrentUser().id === user.id)
        return;
    const isFollowed = followedUserInfo?.userId === user.id;
    children.push(<Menu.MenuSeparator />, <Menu.MenuCheckboxItem id="fvu-follow-user" label="Follow User" checked={isFollowed} action={() => {
            if (followedUserInfo?.userId === user.id) {
                followedUserInfo = null;
                return;
            }
            followedUserInfo = {
                lastChannelId: UserStore.getCurrentUser().id,
                userId: user.id
            };
        }}/>);
};
export default definePlugin({
    name: "FollowVoiceUser-Extand",
    description: "Follow a friend in voice chat.",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    settingsAboutComponent: () => <>
        <Forms.FormText className="plugin-warning">
            This Plugin is used to follow a Friend/Friends into voice chat(s).
        </Forms.FormText>
    </>,
    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }) {
            if (!followedUserInfo)
                return;
            if (settings.store.onlyWhenInVoice
                && VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id) === null)
                return;
            voiceStates.forEach(voiceState => {
                if (voiceState.userId === followedUserInfo.userId
                    && voiceState.channelId
                    && voiceState.channelId !== followedUserInfo.lastChannelId) {
                    followedUserInfo.lastChannelId = voiceState.channelId;
                    voiceChannelAction.selectVoiceChannel(followedUserInfo.lastChannelId);
                }
                else if (voiceState.userId === followedUserInfo.userId
                    && !voiceState.channelId
                    && settings.store.leaveWhenUserLeaves) {
                    voiceChannelAction.selectVoiceChannel(null);
                }
            });
        }
    },
    contextMenus: {
        "user-context": UserContextMenuPatch
    }
});
