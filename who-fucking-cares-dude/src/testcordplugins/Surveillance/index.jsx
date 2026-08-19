/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { LogIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import { removeFromArray } from "@utils/misc";
import { formatDurationMs } from "@utils/text";
import definePlugin from "@utils/types";
import { ChannelStore, GuildStore, IconUtils, Menu, PresenceStore, SettingsRouter, UserStore, VoiceStateStore } from "@webpack/common";
import { loadEvents, recordEvent, trimEvents } from "./store";
const SETTINGS_ENTRY_KEY = "surveillance";
const NOTIFICATION_COLOR = "#5865f2";
const MESSAGE_PREVIEW_LIMIT = 220;
const TYPING_COOLDOWN = 15_000;
const MEMBER_JOIN_FRESHNESS = 300_000;
const URL_REGEX = /https?:\/\/[^\s<>)"']+/gi;
const IDENTITY_HISTORY_LIMIT = 24;
let targets = [];
let serverTargets = [];
let targetSet = new Set();
let serverTargetSet = new Set();
let isStartupPhase = true;
let startupTimer = null;
let cachedTodayPrefix = "";
let lastPrefixUpdate = 0;
const getTodayPrefix = () => {
    const now = Date.now();
    if (now - lastPrefixUpdate > 60_000) {
        cachedTodayPrefix = new Date(now).toISOString().slice(0, 10);
        lastPrefixUpdate = now;
    }
    return cachedTodayPrefix;
};
const targetListeners = new Set();
const serverTargetListeners = new Set();
const messageCache = new Map();
const MESSAGE_CACHE_LIMIT = 2000;
const previousVoiceStates = new Map();
const voiceSessions = new Map();
const typingCooldowns = new Map();
const seenServerUsers = new Map();
let lastStatuses = new Map();
let lastActivities = new Map();
const userCoreProfiles = new Map();
const userDetailProfiles = new Map();
const guildMemberProfiles = new Map();
const identityHistories = new Map();
const voiceStateLabels = [
    ["mute", "Server muted", "Server unmuted"],
    ["deaf", "Server deafened", "Server undeafened"],
    ["selfMute", "Muted", "Unmuted"],
    ["selfDeaf", "Deafened", "Undeafened"],
    ["selfVideo", "Enabled video", "Disabled video"],
    ["selfStream", "Started streaming", "Stopped streaming"],
    ["suppress", "Suppressed by stage", "Unsuppressed by stage"],
];
const updateTargets = (value) => {
    targets = [...new Set(value.match(/\d+/g) ?? [])];
    targetSet = new Set(targets);
    targetListeners.forEach(listener => listener());
    return targets;
};
const updateServerTargets = (value) => {
    serverTargets = [...new Set(value.match(/\d+/g) ?? [])];
    serverTargetSet = new Set(serverTargets);
    serverTargetListeners.forEach(listener => listener());
    return serverTargets;
};
export const getTargets = () => targets;
export const getServerTargets = () => serverTargets;
export const subscribeTargets = (listener) => {
    targetListeners.add(listener);
    return () => targetListeners.delete(listener);
};
export const subscribeServerTargets = (listener) => {
    serverTargetListeners.add(listener);
    return () => serverTargetListeners.delete(listener);
};
export function setTargets(nextTargets) {
    settings.store.targets = [...new Set(nextTargets.filter(Boolean))].join(",");
    updateTargets(settings.store.targets);
}
export function addTarget(userId) {
    setTargets([...targets, userId]);
}
export function removeTarget(userId) {
    setTargets(targets.filter(target => target !== userId));
}
export function setServerTargets(nextServerTargets) {
    settings.store.serverTargets = [...new Set(nextServerTargets.filter(Boolean))].join(",");
    updateServerTargets(settings.store.serverTargets);
}
export function addServerTarget(guildId) {
    setServerTargets([...serverTargets, guildId]);
}
export function removeServerTarget(guildId) {
    setServerTargets(serverTargets.filter(target => target !== guildId));
}
export const settings = definePluginSettings({
    targets: {
        type: 0 /* OptionType.STRING */,
        placeholder: "1234,5678",
        description: "Discord user IDs to monitor from live visible events.",
        default: "",
        onChange: updateTargets,
    },
    serverTargets: {
        type: 0 /* OptionType.STRING */,
        placeholder: "1234,5678",
        description: "Discord server IDs to monitor from live visible events.",
        default: "",
        onChange: updateServerTargets,
    },
    addContextMenu: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Add a Surveillance toggle to user context menus.",
    },
    ignoreBots: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Ignore bot accounts while logging user activity.",
    },
    logMessages: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log live messages from monitored users.",
    },
    captureMessageContent: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Include message previews in local logs.",
    },
    logMessageChanges: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log edits and deletes for messages seen during this session.",
    },
    logTyping: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log typing signals with a short cooldown.",
    },
    logReactions: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log live reaction adds and removals.",
    },
    logStatus: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log online, idle, dnd, and offline transitions.",
    },
    logActivities: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log activity starts, stops, and updates.",
    },
    logProfileChanges: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log profile changes like display name, avatar, bio, pronouns, and server profile updates.",
    },
    logVoice: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log voice joins, leaves, moves, and state changes.",
    },
    logVoiceChannelMembers: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Include other visible voice channel members on voice events.",
    },
    logMemberUpdates: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log server member update events.",
    },
    notifyEvents: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Send notifications for high signal surveillance events.",
    },
    enableOsintAnalysis: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Enable OSINT-style analysis of surveillance activity patterns, timings, and behavioral profiles.",
    },
    trackSelf: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Include your own account if its ID is in the target list.",
    },
    maxEvents: {
        type: 1 /* OptionType.NUMBER */,
        default: 1000,
        description: "Maximum number of local events to keep.",
        onChange: value => void trimEvents(value),
    },
});
const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const getUsername = (userId, fallback) => fallback ?? UserStore.getUser(userId)?.globalName ?? UserStore.getUser(userId)?.username ?? userId;
const getAvatarUrl = (userId, user) => {
    const targetUser = user ?? UserStore.getUser(userId);
    return targetUser ? IconUtils.getUserAvatarURL(targetUser, true, 64) : undefined;
};
const preview = (content) => content.length > MESSAGE_PREVIEW_LIMIT
    ? `${content.slice(0, MESSAGE_PREVIEW_LIMIT)}...`
    : content;
const formatDurationLabel = (durationMs) => formatDurationMs(durationMs, true);
const getMessageLinks = (content) => [...new Set((content.match(URL_REGEX) ?? []).map(link => link.replace(/[.,!?;:]+$/, "")))];
const getAttachmentContentType = (attachment) => attachment.content_type ?? attachment.contentType;
const getAttachmentProxyUrl = (attachment) => attachment.proxy_url ?? attachment.proxyUrl;
const getMessageAttachments = (message) => {
    const attachments = message.attachments.map(attachment => ({
        id: attachment.id,
        filename: attachment.filename,
        url: attachment.url,
        proxyUrl: getAttachmentProxyUrl(attachment),
        contentType: getAttachmentContentType(attachment),
        size: attachment.size,
        width: attachment.width,
        height: attachment.height,
        spoiler: attachment.spoiler,
    }));
    return attachments.length ? attachments : undefined;
};
const isCurrentUser = (userId) => userId === UserStore.getCurrentUser()?.id;
const isBotUser = (userId, user) => Boolean(user?.bot ?? UserStore.getUser(userId)?.bot);
const shouldIgnoreUser = (userId, user) => settings.store.ignoreBots && isBotUser(userId, user);
const shouldTrackUser = (userId) => {
    if (!targetSet.has(userId))
        return false;
    if (shouldIgnoreUser(userId))
        return false;
    if (settings.store.trackSelf)
        return true;
    return !isCurrentUser(userId);
};
const shouldTrackServer = (guildId) => guildId != null && serverTargetSet.has(guildId);
const getScope = (userId, guildId) => {
    if (shouldIgnoreUser(userId))
        return;
    if (shouldTrackServer(guildId) && !isCurrentUser(userId))
        return "server";
    if (shouldTrackUser(userId))
        return "person";
};
const shouldTrackEvent = (userId, guildId) => getScope(userId, guildId) != null;
const getChannelInfo = (channelId) => {
    if (!channelId)
        return {};
    const channel = ChannelStore.getChannel(channelId);
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : undefined;
    return {
        channelId,
        channelName: channel?.name,
        guildId: channel?.guild_id,
        guildName: guild?.name,
    };
};
const getGuildInfo = (guildId) => {
    const guild = guildId ? GuildStore.getGuild(guildId) : undefined;
    return {
        guildId,
        guildName: guild?.name,
    };
};
const getChannelEventInfo = (event) => {
    const channelId = event.channel?.id ?? event.channelId;
    const channelInfo = getChannelInfo(channelId);
    const guildId = event.channel?.guild_id ?? event.guildId ?? channelInfo.guildId;
    const guild = guildId ? GuildStore.getGuild(guildId) : undefined;
    return {
        channelId,
        channelName: event.channel?.name ?? channelInfo.channelName,
        guildId,
        guildName: guild?.name ?? channelInfo.guildName,
    };
};
const rememberServerUser = (userId, guildId) => {
    if (isCurrentUser(userId))
        return;
    if (shouldIgnoreUser(userId))
        return;
    if (!guildId || !serverTargets.includes(guildId))
        return;
    let guildIds = seenServerUsers.get(userId);
    if (!guildIds) {
        guildIds = new Set();
        seenServerUsers.set(userId, guildIds);
    }
    guildIds.add(guildId);
    if (!lastStatuses.has(userId)) {
        const statuses = PresenceStore.getState()?.statuses ?? {};
        lastStatuses.set(userId, statuses[userId] ?? "offline");
        lastActivities.set(userId, getActivityMap(userId));
    }
};
const getSeenServerGuildId = (userId) => {
    const guildIds = seenServerUsers.get(userId);
    if (!guildIds)
        return undefined;
    for (const guildId of guildIds) {
        if (serverTargets.includes(guildId))
            return guildId;
    }
};
const getPresenceUserIds = () => {
    const userIds = new Set(targets);
    for (const userId of seenServerUsers.keys()) {
        if (getSeenServerGuildId(userId))
            userIds.add(userId);
    }
    return userIds;
};
const notify = (event) => {
    if (!settings.store.notifyEvents)
        return;
    if (event.type === "typing" || event.type === "message_edit" || event.type === "message_delete")
        return;
    const user = UserStore.getUser(event.userId);
    showNotification({
        title: "Surveillance",
        body: `${event.username}: ${event.details}`,
        color: NOTIFICATION_COLOR,
        icon: user?.getAvatarURL(),
    });
};
const addEvent = (entry) => {
    const event = {
        id: makeId(),
        timestamp: Date.now(),
        ...entry,
    };
    void recordEvent(event, settings.store.maxEvents);
    notify(event);
};
const addUserEvent = (type, userId, details, extra = {}) => {
    const scope = extra.scope ?? getScope(userId, extra.guildId);
    if (!scope)
        return;
    addEvent({
        type,
        userId,
        username: getUsername(userId, extra.username),
        details,
        avatarUrl: extra.avatarUrl ?? getAvatarUrl(userId),
        scope,
        ...extra,
    });
};
const addServerEvent = (type, guildId, details, extra = {}) => {
    if (!shouldTrackServer(guildId))
        return;
    addEvent({
        type,
        userId: extra.userId ?? guildId ?? "server",
        username: extra.username ?? "Server",
        details,
        scope: "server",
        ...getGuildInfo(guildId),
        ...extra,
    });
};
const getActivityKey = (activity) => [activity.type, activity.application_id ?? "", activity.name, activity.platform ?? ""].join(":");
const formatActivityType = (type) => {
    switch (type) {
        case 1 /* ActivityType.STREAMING */:
            return "streaming";
        case 2 /* ActivityType.LISTENING */:
            return "listening to";
        case 3 /* ActivityType.WATCHING */:
            return "watching";
        case 5 /* ActivityType.COMPETING */:
            return "competing in";
        case 6 /* ActivityType.HANG_STATUS */:
            return "hanging out in";
        default:
            return "playing";
    }
};
const formatActivity = (activity) => {
    if (activity.type === 4 /* ActivityType.CUSTOM_STATUS */) {
        return [activity.emoji?.name, activity.state ?? activity.name].filter(Boolean).join(" ");
    }
    const details = activity.details ? `: ${activity.details}` : "";
    const state = activity.state ? ` (${activity.state})` : "";
    return `${formatActivityType(activity.type)} ${activity.name}${details}${state}`;
};
const getActivityMap = (userId) => {
    const activities = PresenceStore.getActivities(userId) ?? [];
    const activityMap = new Map();
    for (const activity of activities) {
        activityMap.set(getActivityKey(activity), formatActivity(activity));
    }
    return activityMap;
};
const isObject = (value) => typeof value === "object" && value !== null;
const readString = (source, key) => {
    const value = source[key];
    return typeof value === "string" ? value : undefined;
};
const stringifyProfileValue = (value) => {
    if (value == null)
        return null;
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
};
const putProfileValue = (snapshot, label, value) => {
    const formatted = stringifyProfileValue(value);
    if (formatted != null)
        snapshot[label] = formatted;
};
const getProfileSource = (event) => {
    const source = event.userProfile ?? event.profile ?? event.user;
    return isObject(source) ? source : undefined;
};
const snapshotUser = (user) => {
    const snapshot = {};
    putProfileValue(snapshot, "username", user.username);
    putProfileValue(snapshot, "display name", user.globalName);
    putProfileValue(snapshot, "avatar", user.avatar);
    putProfileValue(snapshot, "banner", user.banner);
    putProfileValue(snapshot, "avatar decoration", user.avatarDecorationData);
    putProfileValue(snapshot, "nameplate", user.nameplate);
    putProfileValue(snapshot, "primary guild", user.primaryGuild);
    putProfileValue(snapshot, "display name styles", user.displayNameStyles);
    return snapshot;
};
const snapshotUserProfile = (source, user) => {
    const snapshot = user ? snapshotUser(user) : {};
    putProfileValue(snapshot, "bio", source.bio);
    putProfileValue(snapshot, "pronouns", source.pronouns);
    putProfileValue(snapshot, "accent color", source.accentColor);
    putProfileValue(snapshot, "theme colors", source.themeColors);
    putProfileValue(snapshot, "profile effect", source.profileEffectId ?? source.profileEffect);
    putProfileValue(snapshot, "profile effect expires at", source.profileEffectExpiresAt);
    putProfileValue(snapshot, "badges", source.badges);
    putProfileValue(snapshot, "collectibles", source.collectibles);
    putProfileValue(snapshot, "connected accounts", source.connectedAccounts);
    putProfileValue(snapshot, "application role connections", source.applicationRoleConnections);
    putProfileValue(snapshot, "banner", source.banner ?? snapshot.banner);
    putProfileValue(snapshot, "premium since", source.premiumSince);
    putProfileValue(snapshot, "premium guild since", source.premiumGuildSince);
    putProfileValue(snapshot, "legacy username", source.legacyUsername);
    return snapshot;
};
const snapshotGuildMemberProfile = (member) => {
    const snapshot = {};
    putProfileValue(snapshot, "server display name", member.nick);
    putProfileValue(snapshot, "server avatar", member.avatar);
    putProfileValue(snapshot, "server avatar decoration", member.avatarDecoration);
    putProfileValue(snapshot, "server profile loaded at", member.fullProfileLoadedTimestamp);
    putProfileValue(snapshot, "server display name styles", member.displayNameStyles);
    putProfileValue(snapshot, "color role", member.colorRoleId);
    putProfileValue(snapshot, "role count", member.roles.length);
    return snapshot;
};
const getChangedProfileFields = (previous, current) => {
    if (!previous)
        return [];
    const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
    const changes = [];
    for (const key of keys) {
        const before = previous[key] ?? null;
        const after = current[key] ?? null;
        if (before !== after)
            changes.push(`${formatProfileLabel(key)} changed from ${formatProfileChangeValue(before)} to ${formatProfileChangeValue(after)}`);
    }
    return changes;
};
const identityFields = new Set(["avatar", "banner", "bio", "display name", "pronouns", "server display name", "username"]);
const getIdentityUpdates = (previous, current, timestamp, extra) => {
    if (!previous)
        return [];
    const updates = [];
    for (const field of identityFields) {
        const before = previous[field] ?? null;
        const after = current[field] ?? null;
        if (before !== after) {
            updates.push({
                field: formatProfileLabel(field),
                value: after == null || after === "" ? null : String(after),
                timestamp,
                guildId: extra.guildId,
                guildName: extra.guildName,
            });
        }
    }
    return updates;
};
const pushIdentityHistory = (userId, updates) => {
    if (!updates.length)
        return;
    const next = [...(identityHistories.get(userId) ?? []), ...updates].slice(-IDENTITY_HISTORY_LIMIT);
    identityHistories.set(userId, next);
};
const formatProfileLabel = (label) => label.replace(/^./, match => match.toUpperCase());
const formatProfileChangeValue = (value) => value == null || value === "" ? "unset" : String(value);
const logProfileChanges = (userId, current, store, extra = {}) => {
    if (!settings.store.logProfileChanges)
        return;
    if (shouldIgnoreUser(userId))
        return;
    const scope = extra.scope ?? getScope(userId, extra.guildId);
    if (!scope)
        return;
    const previous = store.get(userId);
    const changes = getChangedProfileFields(previous, current);
    const timestamp = Date.now();
    const identityUpdates = getIdentityUpdates(previous, current, timestamp, extra);
    store.set(userId, current);
    if (!changes.length)
        return;
    pushIdentityHistory(userId, identityUpdates);
    addUserEvent("profile_update", userId, `Updated profile: ${changes.join("; ")}.`, {
        scope,
        avatarUrl: getAvatarUrl(userId),
        after: changes.join("\n"),
        identityHistory: identityHistories.get(userId),
        ...extra,
        metadata: {
            ...(extra.metadata ?? {}),
            changedFieldCount: changes.length,
            identityFieldCount: identityUpdates.length,
        },
    });
};
const logUserUpdate = ({ user }) => {
    if (!user || !shouldTrackUser(user.id))
        return;
    logProfileChanges(user.id, snapshotUser(user), userCoreProfiles, {
        username: getUsername(user.id, user.globalName ?? user.username),
        avatarUrl: getAvatarUrl(user.id, user),
    });
};
const logUserProfile = (event) => {
    const source = getProfileSource(event);
    if (!source)
        return;
    const sourceUser = isObject(source.user) ? source.user : undefined;
    const userId = readString(source, "userId") ?? readString(sourceUser ?? {}, "id") ?? event.user?.id;
    if (!userId || !shouldTrackUser(userId))
        return;
    logProfileChanges(userId, snapshotUserProfile(source, event.user), userDetailProfiles, {
        username: getUsername(userId, event.user?.globalName ?? event.user?.username),
        avatarUrl: getAvatarUrl(userId, event.user),
    });
};
const logGuildMemberProfile = (event) => {
    const member = event.guildMember ?? event.member;
    const guildId = event.guildId ?? event.guild_id ?? member?.guildId;
    const userId = event.user?.id ?? member?.userId;
    if (!member || !userId)
        return;
    if (!shouldTrackEvent(userId, guildId))
        return;
    rememberServerUser(userId, guildId);
    logProfileChanges(userId, snapshotGuildMemberProfile(member), guildMemberProfiles, {
        username: getUsername(userId, event.user?.globalName ?? event.user?.username),
        avatarUrl: getAvatarUrl(userId, event.user),
        ...getGuildInfo(guildId),
        metadata: {
            serverProfile: true,
        },
    });
};
const seedPresence = () => {
    const statuses = PresenceStore.getState()?.statuses ?? {};
    lastStatuses = new Map();
    lastActivities = new Map();
    for (const userId of getPresenceUserIds()) {
        lastStatuses.set(userId, statuses[userId] ?? "offline");
        lastActivities.set(userId, getActivityMap(userId));
    }
};
const handlePresenceChange = () => {
    if (targets.length === 0 && serverTargets.length === 0)
        return;
    const statuses = PresenceStore.getState()?.statuses ?? {};
    for (const userId of getPresenceUserIds()) {
        const guildId = getSeenServerGuildId(userId);
        const scope = getScope(userId, guildId);
        if (!scope)
            continue;
        const guildInfo = scope === "server" ? getGuildInfo(guildId) : {};
        const previousStatus = lastStatuses.get(userId) ?? "offline";
        const currentStatus = statuses[userId] ?? "offline";
        if (settings.store.logStatus && previousStatus !== currentStatus) {
            addUserEvent("status", userId, `Status changed from ${previousStatus} to ${currentStatus}.`, {
                scope,
                ...guildInfo,
                metadata: {
                    from: previousStatus,
                    to: currentStatus,
                },
            });
        }
        const previousActivities = lastActivities.get(userId) ?? new Map();
        const currentActivities = getActivityMap(userId);
        if (settings.store.logActivities) {
            for (const [key, activity] of currentActivities) {
                const previousActivity = previousActivities.get(key);
                if (!previousActivity) {
                    addUserEvent("activity_start", userId, `Started ${activity}.`, {
                        scope,
                        ...guildInfo,
                        metadata: {
                            activity,
                        },
                    });
                    continue;
                }
                if (previousActivity !== activity) {
                    addUserEvent("activity_update", userId, `Changed activity from ${previousActivity} to ${activity}.`, {
                        scope,
                        ...guildInfo,
                        metadata: {
                            from: previousActivity,
                            to: activity,
                        },
                    });
                }
            }
            for (const [key, activity] of previousActivities) {
                if (!currentActivities.has(key)) {
                    addUserEvent("activity_stop", userId, `Stopped ${activity}.`, {
                        scope,
                        ...guildInfo,
                        metadata: {
                            activity,
                        },
                    });
                }
            }
        }
        lastStatuses.set(userId, currentStatus);
        lastActivities.set(userId, currentActivities);
    }
};
const getVoiceChanges = (previousState, currentState) => {
    const changes = [];
    for (const [key, enabledLabel, disabledLabel] of voiceStateLabels) {
        const wasEnabled = Boolean(previousState[key]);
        const isEnabled = Boolean(currentState[key]);
        if (wasEnabled !== isEnabled)
            changes.push(isEnabled ? enabledLabel : disabledLabel);
    }
    return changes;
};
const getVoiceParticipants = (channelId, actorUserId) => {
    if (!settings.store.logVoiceChannelMembers || !channelId)
        return;
    const states = VoiceStateStore.getVoiceStatesForChannel(channelId);
    if (!states)
        return;
    const participants = Object.values(states)
        .filter(state => state.userId !== actorUserId)
        .map(state => {
        const user = UserStore.getUser(state.userId);
        return {
            userId: state.userId,
            username: getUsername(state.userId),
            tag: user?.tag ?? user?.username,
            avatarUrl: getAvatarUrl(state.userId, user),
            mute: Boolean(state.mute),
            deaf: Boolean(state.deaf),
            selfMute: Boolean(state.selfMute),
            selfDeaf: Boolean(state.selfDeaf),
            selfVideo: Boolean(state.selfVideo),
            selfStream: Boolean(state.selfStream),
            suppress: Boolean(state.suppress),
        };
    });
    return participants.length ? participants : undefined;
};
const getVoiceMetadata = (state, channelId, durationMs) => ({
    channelId: channelId ?? null,
    mute: Boolean(state.mute),
    deaf: Boolean(state.deaf),
    selfMute: Boolean(state.selfMute),
    selfDeaf: Boolean(state.selfDeaf),
    selfVideo: Boolean(state.selfVideo),
    selfStream: Boolean(state.selfStream),
    suppress: Boolean(state.suppress),
    durationMs: durationMs ?? null,
});
const getVoiceDuration = (userId, channelId) => {
    const session = voiceSessions.get(userId);
    if (!session || session.channelId !== channelId)
        return undefined;
    return Date.now() - session.startedAt;
};
const handleVoiceState = (state) => {
    if (!settings.store.logVoice)
        return;
    const previousState = previousVoiceStates.get(state.userId);
    const { channelId, oldChannelId, userId } = state;
    const guildId = state.guildId ?? getChannelInfo(channelId ?? oldChannelId).guildId;
    if (!shouldTrackEvent(userId, guildId))
        return;
    rememberServerUser(userId, guildId);
    if (oldChannelId !== channelId) {
        if (!oldChannelId && channelId) {
            const channelInfo = getChannelInfo(channelId);
            voiceSessions.set(userId, { channelId, startedAt: Date.now() });
            addUserEvent("voice_join", userId, `Joined voice channel ${channelInfo.channelName ?? "Unknown channel"}.`, {
                ...channelInfo,
                voiceParticipants: getVoiceParticipants(channelId, userId),
                metadata: getVoiceMetadata(state, channelId),
            });
        }
        else if (oldChannelId && !channelId) {
            const channelInfo = getChannelInfo(oldChannelId);
            const durationMs = getVoiceDuration(userId, oldChannelId);
            voiceSessions.delete(userId);
            addUserEvent("voice_leave", userId, `Left voice channel ${channelInfo.channelName ?? "Unknown channel"}${durationMs != null ? ` after ${formatDurationLabel(durationMs)}` : ""}.`, {
                ...channelInfo,
                voiceParticipants: getVoiceParticipants(oldChannelId, userId),
                metadata: getVoiceMetadata(state, oldChannelId, durationMs),
            });
        }
        else if (oldChannelId && channelId) {
            const oldChannel = getChannelInfo(oldChannelId).channelName ?? "Unknown channel";
            const channelInfo = getChannelInfo(channelId);
            const durationMs = getVoiceDuration(userId, oldChannelId);
            voiceSessions.set(userId, { channelId, startedAt: Date.now() });
            addUserEvent("voice_move", userId, `Moved from ${oldChannel} to ${channelInfo.channelName ?? "Unknown channel"}${durationMs != null ? ` after ${formatDurationLabel(durationMs)}` : ""}.`, {
                ...channelInfo,
                voiceParticipants: getVoiceParticipants(channelId, userId),
                metadata: getVoiceMetadata(state, channelId, durationMs),
            });
        }
    }
    if (previousState && channelId && oldChannelId === channelId) {
        const changes = getVoiceChanges(previousState, state);
        if (changes.length) {
            addUserEvent("voice_update", userId, `Voice state changed: ${changes.join(", ")}.`, {
                ...getChannelInfo(channelId),
                voiceParticipants: getVoiceParticipants(channelId, userId),
                after: changes.join("\n"),
                metadata: getVoiceMetadata(state, channelId),
            });
        }
    }
    if (channelId) {
        previousVoiceStates.set(userId, state);
        if (!voiceSessions.has(userId))
            voiceSessions.set(userId, { channelId, startedAt: Date.now() });
    }
    else
        previousVoiceStates.delete(userId);
};
const logMessage = (message) => {
    const { author } = message;
    if (!settings.store.logMessages && !settings.store.logMessageChanges)
        return;
    if (shouldIgnoreUser(author.id, author))
        return;
    const isTargetUser = targetSet.has(author.id);
    if (!isTargetUser && serverTargetSet.size === 0)
        return;
    const info = getChannelInfo(message.channel_id);
    if (!shouldTrackEvent(author.id, info.guildId))
        return;
    rememberServerUser(author.id, info.guildId);
    const content = settings.store.captureMessageContent ? preview(message.content) : undefined;
    const attachments = getMessageAttachments(message);
    const links = getMessageLinks(message.content);
    messageCache.set(message.id, {
        userId: author.id,
        username: author.username,
        channelId: message.channel_id,
        guildId: info.guildId,
        content: message.content,
        attachments,
        links,
    });
    if (messageCache.size > MESSAGE_CACHE_LIMIT) {
        const oldest = messageCache.keys().next().value;
        if (oldest !== undefined)
            messageCache.delete(oldest);
    }
    if (!settings.store.logMessages)
        return;
    addEvent({
        type: "message",
        userId: author.id,
        username: author.username,
        details: content ? `Sent message: ${content}` : "Sent a message.",
        scope: getScope(author.id, info.guildId),
        content,
        attachments,
        links,
        ...info,
        metadata: {
            messageId: message.id,
            hasContent: message.content.length > 0,
            attachmentCount: message.attachments.length,
            linkCount: links.length,
        },
    });
};
const logMessageUpdate = (message) => {
    if (!settings.store.logMessageChanges)
        return;
    if (shouldIgnoreUser(message.author.id, message.author))
        return;
    const previousMessage = messageCache.get(message.id);
    const info = getChannelInfo(message.channel_id);
    const guildId = info.guildId ?? previousMessage?.guildId;
    if (!shouldTrackEvent(message.author.id, guildId))
        return;
    rememberServerUser(message.author.id, guildId);
    const content = settings.store.captureMessageContent ? preview(message.content) : undefined;
    const previousContent = previousMessage?.content;
    const attachments = getMessageAttachments(message);
    const links = getMessageLinks(message.content);
    messageCache.set(message.id, {
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channel_id,
        guildId: info.guildId,
        content: message.content,
        attachments,
        links,
    });
    if (messageCache.size > MESSAGE_CACHE_LIMIT) {
        const oldest = messageCache.keys().next().value;
        if (oldest !== undefined)
            messageCache.delete(oldest);
    }
    addEvent({
        type: "message_edit",
        userId: message.author.id,
        username: message.author.username,
        details: content ? `Edited message: ${content}` : "Edited a message.",
        scope: getScope(message.author.id, guildId),
        before: settings.store.captureMessageContent && previousContent ? preview(previousContent) : undefined,
        after: content,
        attachments,
        links,
        ...info,
        metadata: {
            messageId: message.id,
            hadCachedOriginal: Boolean(previousContent),
            attachmentCount: message.attachments.length,
            linkCount: links.length,
        },
    });
};
const logMessageDelete = (messageId, channelId) => {
    if (!settings.store.logMessageChanges)
        return;
    const snapshot = messageCache.get(messageId);
    const info = getChannelInfo(channelId);
    if (!snapshot) {
        addServerEvent("message_delete", info.guildId, "Deleted an uncached message.", {
            username: "Unknown user",
            ...info,
            metadata: {
                messageId,
                cached: false,
            },
        });
        return;
    }
    const guildId = snapshot.guildId ?? info.guildId;
    if (!shouldTrackEvent(snapshot.userId, guildId))
        return;
    rememberServerUser(snapshot.userId, guildId);
    const content = settings.store.captureMessageContent ? preview(snapshot.content) : undefined;
    addEvent({
        type: "message_delete",
        userId: snapshot.userId,
        username: snapshot.username,
        details: content ? `Deleted message: ${content}` : "Deleted a message.",
        scope: getScope(snapshot.userId, guildId),
        content,
        attachments: snapshot.attachments,
        links: snapshot.links,
        ...info,
        metadata: {
            messageId,
            cached: true,
            attachmentCount: snapshot.attachments?.length ?? 0,
            linkCount: snapshot.links?.length ?? 0,
        },
    });
    messageCache.delete(messageId);
};
const logTyping = (userId, channelId) => {
    if (!settings.store.logTyping)
        return;
    if (shouldIgnoreUser(userId))
        return;
    const isTargetUser = targets.includes(userId);
    if (!isTargetUser && serverTargets.length === 0)
        return;
    const info = getChannelInfo(channelId);
    if (!shouldTrackEvent(userId, info.guildId))
        return;
    const key = `${userId}:${channelId}`;
    const now = Date.now();
    const lastTypedAt = typingCooldowns.get(key) ?? 0;
    if (now - lastTypedAt < TYPING_COOLDOWN)
        return;
    typingCooldowns.set(key, now);
    rememberServerUser(userId, info.guildId);
    addUserEvent("typing", userId, "Started typing.", info);
};
const formatEmoji = (emoji) => emoji?.name ?? emoji?.id ?? "Unknown emoji";
const logReaction = (type, event) => {
    if (!settings.store.logReactions || !event.userId)
        return;
    if (shouldIgnoreUser(event.userId))
        return;
    const info = getChannelInfo(event.channelId);
    if (!shouldTrackEvent(event.userId, info.guildId))
        return;
    rememberServerUser(event.userId, info.guildId);
    addUserEvent(type, event.userId, type === "reaction_add" ? `Added reaction ${formatEmoji(event.emoji)}.` : `Removed reaction ${formatEmoji(event.emoji)}.`, {
        ...info,
        metadata: {
            messageId: event.messageId,
            emojiId: event.emoji?.id ?? null,
            emojiName: event.emoji?.name ?? null,
            animated: event.emoji?.animated ?? false,
        },
    });
};
const logReactionClear = (event) => {
    if (!settings.store.logReactions)
        return;
    const info = getChannelInfo(event.channelId);
    addServerEvent("reaction_remove_all", info.guildId, "Removed all reactions from a message.", {
        ...info,
        metadata: {
            messageId: event.messageId,
        },
    });
};
const logChannelEvent = (type, event) => {
    // Guard before doing any work. getChannelEventInfo hits ChannelStore and GuildStore
    // and builds an object, and CHANNEL_UPDATES delivers a whole batch of channels at
    // once - so on a big server this ran hundreds of store lookups per dispatch only to
    // throw the result away in addServerEvent. This was the single most expensive event
    // in the client by total time.
    const rawGuildId = event.channel?.guild_id ?? event.guildId;
    if (rawGuildId != null && !shouldTrackServer(rawGuildId))
        return;
    const info = getChannelEventInfo(event);
    if (!shouldTrackServer(info.guildId))
        return;
    const label = info.channelName ?? info.channelId ?? "Unknown channel";
    const verb = type === "channel_create" ? "Created" : type === "channel_delete" ? "Deleted" : "Updated";
    addServerEvent(type, info.guildId, `${verb} channel ${label}.`, {
        ...info,
        metadata: {
            channelId: info.channelId ?? null,
            channelType: event.channel?.type ?? null,
        },
    });
};
const logThreadEvent = (type, event) => {
    const rawGuildId = event.channel?.guild_id ?? event.guildId;
    if (rawGuildId != null && !shouldTrackServer(rawGuildId))
        return;
    const info = getChannelEventInfo(event);
    if (!shouldTrackServer(info.guildId))
        return;
    const label = info.channelName ?? info.channelId ?? "Unknown thread";
    const verb = type === "thread_create" ? "Created" : type === "thread_delete" ? "Deleted" : "Updated";
    addServerEvent(type, info.guildId, `${verb} thread ${label}.`, {
        ...info,
        metadata: {
            channelId: info.channelId ?? null,
            parentId: event.channel?.parent_id ?? null,
        },
    });
};
const logGuildMemberEvent = (type, event) => {
    if (type === "guild_member_update" && !settings.store.logMemberUpdates)
        return;
    const userId = event.user?.id ?? event.userId ?? event.member?.userId;
    const guildId = event.guildId ?? event.guild_id ?? event.member?.guildId;
    const isTargetUser = Boolean(userId && targetSet.has(userId));
    const isTargetServer = Boolean(guildId && serverTargetSet.has(guildId));
    if (!isTargetUser && !isTargetServer)
        return;
    if (type === "guild_member_add" && !isTargetUser) {
        const joinedAtStr = event.member?.joinedAt;
        if (!joinedAtStr)
            return;
        const todayPrefix = getTodayPrefix();
        if (!joinedAtStr.startsWith(todayPrefix))
            return;
        const joinedAt = Date.parse(joinedAtStr);
        if (isNaN(joinedAt) || Date.now() - joinedAt >= MEMBER_JOIN_FRESHNESS) {
            return;
        }
    }
    if (userId && isCurrentUser(userId))
        return;
    if (userId && shouldIgnoreUser(userId, event.user))
        return;
    const joinedAt = event.member?.joinedAt ? Date.parse(event.member.joinedAt) : undefined;
    const isFreshJoin = joinedAt != null && Date.now() - joinedAt < MEMBER_JOIN_FRESHNESS;
    const username = userId ? getUsername(userId, event.user?.username) : "Unknown user";
    const details = type === "guild_member_add"
        ? isFreshJoin ? "Joined the server." : "Member became visible in the live cache."
        : type === "guild_member_remove"
            ? "Left the server."
            : "Updated server member.";
    if (userId)
        rememberServerUser(userId, guildId);
    addServerEvent(type, guildId, details, {
        userId: userId ?? guildId,
        username,
        metadata: {
            joinedAt: event.member?.joinedAt ?? null,
            realJoin: type === "guild_member_add" ? isFreshJoin : null,
            nick: event.member?.nick ?? null,
            roleCount: event.member?.roles.length ?? null,
        },
    });
};
const logGuildEvent = (event) => {
    const guildId = event.guild?.id ?? event.guildId;
    if (!shouldTrackServer(guildId))
        return;
    const guildName = event.guild?.name ?? GuildStore.getGuild(guildId ?? "")?.name;
    addServerEvent("guild_update", guildId, `Server settings changed${guildName ? ` for ${guildName}` : ""}.`, {
        guildName,
    });
};
const logRoleEvent = (type, event) => {
    const guildId = event.role?.guildId ?? event.guildId ?? event.guild_id;
    const roleName = event.role?.name ?? event.roleId ?? "Unknown role";
    const verb = type === "role_create" ? "Created" : type === "role_delete" ? "Deleted" : "Updated";
    addServerEvent(type, guildId, `${verb} role ${roleName}.`, {
        metadata: {
            roleId: event.role?.id ?? event.roleId ?? null,
            roleName,
        },
    });
};
const patchUserContext = (children, { user }) => {
    if (!settings.store.addContextMenu || !user)
        return;
    const tracked = targets.includes(user.id);
    const group = findGroupChildrenByChildId("apps", children) ?? children;
    let index = group.findLastIndex(child => child?.props?.id === "ignore");
    if (index < 0)
        index = group.length - 1;
    group.splice(index, 0, <Menu.MenuItem id="vc-surveillance-toggle" label={tracked ? "Remove from Surveillance" : "Add to Surveillance"} action={() => {
            if (tracked)
                removeTarget(user.id);
            else
                addTarget(user.id);
        }}/>);
};
export default definePlugin({
    name: "Surveillance",
    description: "Adds a local live event dashboard for selected users and servers, lets you watch over your friends and their actions.",
    tags: ["Friends", "Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }, TestcordDevs.x2b, EquicordDevs.omaw],
    enabledByDefault: false,
    settings,
    contextMenus: {
        "user-context": patchUserContext,
    },
    toolboxActions: {
        "Open Surveillance": () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`),
    },
    start() {
        isStartupPhase = true;
        if (startupTimer)
            clearTimeout(startupTimer);
        startupTimer = setTimeout(() => {
            isStartupPhase = false;
        }, 15_000);
        updateTargets(settings.store.targets);
        updateServerTargets(settings.store.serverTargets);
        seedPresence();
        void loadEvents(settings.store.maxEvents);
        PresenceStore.addChangeListener(handlePresenceChange);
        if (!SettingsPlugin.customEntries.some(entry => entry.key === SETTINGS_ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_ENTRY_KEY,
                title: "Surveillance",
                Component: require("./components/SurveillanceTab").default,
                Icon: LogIcon,
            });
        }
    },
    stop() {
        isStartupPhase = false;
        if (startupTimer) {
            clearTimeout(startupTimer);
            startupTimer = null;
        }
        PresenceStore.removeChangeListener(handlePresenceChange);
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SETTINGS_ENTRY_KEY);
        previousVoiceStates.clear();
        messageCache.clear();
        typingCooldowns.clear();
        seenServerUsers.clear();
        lastStatuses.clear();
        lastActivities.clear();
        userCoreProfiles.clear();
        userDetailProfiles.clear();
        guildMemberProfiles.clear();
        identityHistories.clear();
        voiceSessions.clear();
    },
    flux: {
        MESSAGE_CREATE({ message }) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            if (!message || !message.author)
                return;
            const isTargetUser = targetSet.has(message.author.id);
            if (!isTargetUser && serverTargetSet.size === 0)
                return;
            logMessage(message);
        },
        MESSAGE_UPDATE({ message }) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            if (message)
                logMessageUpdate(message);
        },
        MESSAGE_DELETE({ id, channelId }) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            if (id && channelId)
                logMessageDelete(id, channelId);
        },
        MESSAGE_DELETE_BULK({ ids = [], channelId }) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            if (Array.isArray(ids) && channelId) {
                for (const id of ids) {
                    logMessageDelete(id, channelId);
                }
            }
        },
        MESSAGE_REACTION_ADD(event) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            if (event)
                logReaction("reaction_add", event);
        },
        MESSAGE_REACTION_REMOVE(event) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            if (event)
                logReaction("reaction_remove", event);
        },
        MESSAGE_REACTION_REMOVE_ALL(event) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            if (event)
                logReactionClear(event);
        },
        TYPING_START({ userId, channelId }) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            if (!userId || !channelId)
                return;
            const isTargetUser = targetSet.has(userId);
            if (!isTargetUser && serverTargetSet.size === 0)
                return;
            logTyping(userId, channelId);
        },
        VOICE_STATE_UPDATES({ voiceStates = [] }) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            if (Array.isArray(voiceStates)) {
                for (const voiceState of voiceStates) {
                    handleVoiceState(voiceState);
                }
            }
        },
        CHANNEL_CREATE(event) {
            if (serverTargetSet.size === 0)
                return;
            logChannelEvent("channel_create", event);
        },
        CHANNEL_DELETE(event) {
            if (serverTargetSet.size === 0)
                return;
            logChannelEvent("channel_delete", event);
        },
        CHANNEL_UPDATE(event) {
            if (serverTargetSet.size === 0)
                return;
            logChannelEvent("channel_update", event);
        },
        CHANNEL_UPDATES({ channels }) {
            if (serverTargetSet.size === 0)
                return;
            for (const channel of channels) {
                logChannelEvent("channel_update", { channel });
            }
        },
        THREAD_CREATE(event) {
            if (serverTargetSet.size === 0)
                return;
            logThreadEvent("thread_create", event);
        },
        THREAD_DELETE(event) {
            if (serverTargetSet.size === 0)
                return;
            logThreadEvent("thread_delete", event);
        },
        THREAD_UPDATE(event) {
            if (serverTargetSet.size === 0)
                return;
            logThreadEvent("thread_update", event);
        },
        GUILD_MEMBER_ADD(event) {
            if (isStartupPhase || (targetSet.size === 0 && serverTargetSet.size === 0))
                return;
            const joinedAtStr = event.member?.joinedAt;
            if (!joinedAtStr)
                return;
            const joinedAt = Date.parse(joinedAtStr);
            if (isNaN(joinedAt) || Date.now() - joinedAt > MEMBER_JOIN_FRESHNESS)
                return;
            const userId = event.user?.id ?? event.userId ?? event.member?.userId;
            const guildId = event.guildId ?? event.guild_id ?? event.member?.guildId;
            const isTargetUser = Boolean(userId && targetSet.has(userId));
            const isTargetServer = Boolean(guildId && serverTargetSet.has(guildId));
            if (!isTargetUser && !isTargetServer)
                return;
            logGuildMemberEvent("guild_member_add", event);
        },
        GUILD_MEMBER_REMOVE(event) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            const userId = event.user?.id ?? event.userId ?? event.member?.userId;
            const guildId = event.guildId ?? event.guild_id ?? event.member?.guildId;
            const isTargetUser = Boolean(userId && targetSet.has(userId));
            const isTargetServer = Boolean(guildId && serverTargetSet.has(guildId));
            if (!isTargetUser && !isTargetServer)
                return;
            logGuildMemberEvent("guild_member_remove", event);
        },
        GUILD_MEMBER_UPDATE(event) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            const userId = event.user?.id ?? event.userId ?? event.member?.userId;
            const guildId = event.guildId ?? event.guild_id ?? event.member?.guildId;
            const isTargetUser = Boolean(userId && targetSet.has(userId));
            const isTargetServer = Boolean(guildId && serverTargetSet.has(guildId));
            if (!isTargetUser && !isTargetServer)
                return;
            logGuildMemberEvent("guild_member_update", event);
        },
        GUILD_MEMBER_PROFILE_UPDATE(event) {
            if (targetSet.size === 0 && serverTargetSet.size === 0)
                return;
            logGuildMemberProfile(event);
        },
        USER_UPDATE(event) {
            if (targetSet.size === 0)
                return;
            logUserUpdate(event);
        },
        USER_PROFILE_FETCH_SUCCESS(event) {
            if (targetSet.size === 0)
                return;
            logUserProfile(event);
        },
        USER_PROFILE_UPDATE_SUCCESS(event) {
            if (targetSet.size === 0)
                return;
            logUserProfile(event);
        },
        CURRENT_USER_UPDATE(event) {
            if (targetSet.size === 0)
                return;
            logUserUpdate(event);
        },
        GUILD_UPDATE(event) {
            if (serverTargetSet.size === 0)
                return;
            logGuildEvent(event);
        },
        GUILD_ROLE_CREATE(event) {
            if (serverTargetSet.size === 0)
                return;
            logRoleEvent("role_create", event);
        },
        GUILD_ROLE_DELETE(event) {
            if (serverTargetSet.size === 0)
                return;
            logRoleEvent("role_delete", event);
        },
        GUILD_ROLE_UPDATE(event) {
            if (serverTargetSet.size === 0)
                return;
            logRoleEvent("role_update", event);
        },
    },
});
