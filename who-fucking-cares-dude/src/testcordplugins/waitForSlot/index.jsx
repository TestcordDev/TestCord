/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { playAudio } from "@api/AudioPlayer";
import { popNotice, showNotice } from "@api/Notices";
import { definePluginSettings } from "@api/Settings";
import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelActions, ChannelStore, Menu, VoiceStateStore } from "@webpack/common";
let waitingChannelId = null;
const NOTIFICATION_AUDIO_URL = "https://raw.githubusercontent.com/Eazvy/Utils/694219a1d69f2e27912943ed9b41a75fca051d9d/notification.mp3";
const settings = definePluginSettings({
    autoJoin: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Join the channel immediately instead of showing a notice.",
        default: false,
    },
    notificationSound: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Play a sound when a slot becomes available.",
        default: true,
    },
});
const ChannelContext = (children, { channel }) => {
    if (channel?.type !== 2 /* ChannelType.GUILD_VOICE */ || !channel.userLimit)
        return;
    if (Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id)).length < channel.userLimit)
        return;
    const isWaiting = waitingChannelId === channel.id;
    children.splice(-1, 0, <Menu.MenuItem id="vc-wait-for-slot" label={isWaiting ? "Leave Queue" : "Join Queue"} action={() => { waitingChannelId = isWaiting ? null : channel.id; }}/>);
};
function promptVoiceChannel(channel) {
    if (!channel || channel.type !== 2 /* ChannelType.GUILD_VOICE */ || !channel.userLimit)
        return false;
    if (Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id)).length < channel.userLimit)
        return false;
    if (waitingChannelId === channel.id)
        return true;
    showNotice(`Voice channel ${channel.name} is full. Wait for a slot?`, "Wait", () => {
        popNotice();
        waitingChannelId = channel.id;
    });
    return true;
}
export default definePlugin({
    name: "WaitForSlot",
    description: "Automatically join a full voice channel when a slot opens.",
    tags: ["Utility", "Voice"],
    authors: [EquicordDevs.omaw, Devs.prism],
    settings,
    patches: [
        {
            find: "VoiceChannel, transitionTo: Channel does not have a guildId",
            noWarn: true,
            replacement: {
                match: /(?<=\|\|\i\|\|)\i\.default\.selectVoiceChannel\((\i)\.id\)/,
                replace: "$self.promptVoiceChannel($1)||$&"
            }
        }
    ],
    contextMenus: {
        "channel-context": ChannelContext,
    },
    promptVoiceChannel,
    flux: {
        VOICE_STATE_UPDATES() {
            if (!waitingChannelId)
                return;
            const channel = ChannelStore.getChannel(waitingChannelId);
            if (!channel?.userLimit) {
                waitingChannelId = null;
                return;
            }
            if (Object.keys(VoiceStateStore.getVoiceStatesForChannel(waitingChannelId)).length < channel.userLimit) {
                const channelId = waitingChannelId;
                waitingChannelId = null;
                if (settings.store.notificationSound) {
                    playAudio(NOTIFICATION_AUDIO_URL);
                }
                if (settings.store.autoJoin) {
                    ChannelActions.selectVoiceChannel(channelId);
                }
                else {
                    showNotice(`Hey, someone just left #${channel.name} and there's a spot for you now!`, "Join", () => {
                        popNotice();
                        ChannelActions.selectVoiceChannel(channelId);
                    });
                }
            }
        },
    },
    stop() {
        waitingChannelId = null;
    },
});
