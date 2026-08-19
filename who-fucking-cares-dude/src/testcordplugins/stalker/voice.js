/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { showNotification } from "@api/Notifications";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, GuildStore, UserStore } from "@webpack/common";
import { logStalkerEvent, settings, targets } from ".";
const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const NOTIFICATION_COLOR = "#5865f2";
const voiceStateLabels = [
    ["mute", "Server muted", "Server unmuted"],
    ["deaf", "Server deafened", "Server undeafened"],
    ["selfMute", "Muted", "Unmuted"],
    ["selfDeaf", "Deafened", "Undeafened"],
    ["selfVideo", "Enabled video", "Disabled video"],
    ["selfStream", "Started streaming", "Stopped streaming"],
    ["suppress", "Suppressed by stage", "Unsuppressed by stage"],
];
let lastVoiceState = {};
const getChannelName = (channelId) => {
    if (!channelId)
        return "Unknown channel";
    const channel = ChannelStore.getChannel(channelId);
    if (!channel)
        return "Unknown channel";
    if (channel.isGuildVoice() || channel.isGuildStageVoice()) {
        const guild = GuildStore.getGuild(channel.guild_id);
        return `${channel.name} from ${guild?.name ?? "Unknown server"}`;
    }
    return channel.name ?? "Unknown channel";
};
const getGuildName = (channelId) => {
    if (!channelId)
        return;
    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id)
        return;
    return GuildStore.getGuild(channel.guild_id)?.name;
};
const getVoiceStateChanges = (previousState, currentState) => {
    const changes = [];
    for (const [key, enabledLabel, disabledLabel] of voiceStateLabels) {
        const wasEnabled = Boolean(previousState[key]);
        const isEnabled = Boolean(currentState[key]);
        if (wasEnabled === isEnabled)
            continue;
        changes.push(isEnabled ? enabledLabel : disabledLabel);
    }
    return changes;
};
const logVoiceEvent = (userId, username, action, details, channelId) => {
    const channel = channelId ? ChannelStore.getChannel(channelId) : undefined;
    logStalkerEvent({
        timestamp: new Date().toISOString(),
        userId,
        username,
        action,
        details,
        channelName: channel?.name,
        guildName: getGuildName(channelId),
        metadata: {
            channelId: channelId ?? null,
            guildId: channel?.guild_id ?? null
        }
    });
};
export const init = () => {
    const initialState = {};
    for (const id of targets) {
        const voiceState = VoiceStateStore.getVoiceStateForUser(id);
        if (voiceState)
            initialState[id] = voiceState;
    }
    lastVoiceState = initialState;
    VoiceStateStore.addChangeListener(voiceStateChange);
};
export const deinit = () => {
    VoiceStateStore.removeChangeListener(voiceStateChange);
    lastVoiceState = {};
};
export const voiceStateChange = () => {
    const newVoiceState = {};
    for (const id of targets) {
        const voiceState = VoiceStateStore.getVoiceStateForUser(id);
        const lastVoiceStateForUser = lastVoiceState[id];
        if (voiceState)
            newVoiceState[id] = voiceState;
        const joinedVoice = Boolean(voiceState && !lastVoiceStateForUser);
        const leftVoice = Boolean(!voiceState && lastVoiceStateForUser);
        const switchedChannel = Boolean(voiceState && lastVoiceStateForUser && voiceState.channelId !== lastVoiceStateForUser.channelId);
        if (voiceState && (joinedVoice || switchedChannel)) {
            const user = UserStore.getUser(id);
            if (!user)
                continue;
            const channelName = getChannelName(voiceState.channelId);
            if (settings.store.notifyCallJoin && voiceState.channelId) {
                const { channelId } = voiceState;
                showNotification({
                    title: "Stalker",
                    body: `${user.username} joined VC: ${channelName}\nClick to join them.`,
                    icon: user.getAvatarURL(),
                    color: NOTIFICATION_COLOR,
                    onClick: () => VoiceActions.selectVoiceChannel(channelId),
                });
            }
            logVoiceEvent(user.id, user.username, joinedVoice ? "voice_join" : "voice_update", joinedVoice
                ? `Joined voice channel: ${channelName}.`
                : `Moved from ${getChannelName(lastVoiceStateForUser.channelId)} to ${channelName}.`, voiceState.channelId);
        }
        if (leftVoice && lastVoiceStateForUser) {
            const user = UserStore.getUser(id);
            if (!user)
                continue;
            const channelName = getChannelName(lastVoiceStateForUser.channelId);
            if (settings.store.notifyCallLeave) {
                showNotification({
                    title: "Stalker",
                    body: `${user.username} left VC: ${channelName}`,
                    icon: user.getAvatarURL(),
                    color: NOTIFICATION_COLOR,
                });
            }
            logVoiceEvent(user.id, user.username, "voice_leave", `Left voice channel: ${channelName}.`, lastVoiceStateForUser.channelId);
        }
        if (voiceState && lastVoiceStateForUser && !switchedChannel && settings.store.logVoiceStateChanges) {
            const changes = getVoiceStateChanges(lastVoiceStateForUser, voiceState);
            if (!changes.length)
                continue;
            const user = UserStore.getUser(id);
            if (!user)
                continue;
            logVoiceEvent(user.id, user.username, "voice_update", `Voice state changed in ${getChannelName(voiceState.channelId)}: ${changes.join(", ")}.`, voiceState.channelId);
        }
    }
    lastVoiceState = newVoiceState;
};
