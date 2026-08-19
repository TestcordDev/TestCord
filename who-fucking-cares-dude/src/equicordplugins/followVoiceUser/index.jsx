/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Notice } from "@components/Notice";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu, React, RelationshipStore, UserStore, VoiceStateStore } from "@webpack/common";
let followedUserInfo = null;
const voiceChannelAction = findByPropsLazy("selectVoiceChannel");
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
    if (UserStore.getCurrentUser().id === user.id || !RelationshipStore.getFriendIDs().includes(user.id))
        return;
    const checked = followedUserInfo?.userId === user.id;
    children.push(<Menu.MenuSeparator />, <Menu.MenuCheckboxItem id="fvu-follow-user" label="Follow User" checked={checked} action={() => {
            if (followedUserInfo?.userId === user.id) {
                followedUserInfo = null;
            }
            else {
                followedUserInfo = {
                    lastChannelId: UserStore.getCurrentUser().id,
                    userId: user.id
                };
            }
        }}/>);
};
export default definePlugin({
    name: "FollowVoiceUser",
    description: "Follow a friend in voice chat.",
    tags: ["Voice"],
    authors: [EquicordDevs.TheArmagan],
    settings,
    settingsAboutComponent: () => (<Notice.Info>
            This Plugin is used to follow a Friend/Friends into voice chat(s).
        </Notice.Info>),
    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }) {
            if (!followedUserInfo)
                return;
            if (!RelationshipStore.getFriendIDs().includes(followedUserInfo.userId))
                return;
            if (settings.store.onlyWhenInVoice
                && !VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id))
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
