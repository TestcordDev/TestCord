/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { ChannelStore, GuildStore, Menu, NavigationRouter, UserStore } from "@webpack/common";
import * as activity from "./activity";
import * as status from "./status";
import * as voice from "./voice";
export const logger = new Logger("Stalker");
const Native = VencordNative.pluginHelpers.Stalker;
if (!Native) {
    logger.warn("Stalker native module not available");
}
function OpenStalkingFolderButton() {
    return (<Button disabled={!Native?.openStalkerDataDir} onClick={() => void Native?.openStalkerDataDir?.()
            .then(error => {
            if (error)
                logger.error("Failed to open Stalking folder:", error);
        })
            .catch(error => logger.error("Failed to open Stalking folder:", error))}>
            Open Stalking Folder
        </Button>);
}
const cachedLogsPerUser = new Map();
const writeLocks = new Map();
const typingNotificationCooldowns = new Map();
const pendingWrites = new Map();
const writeTimers = new Map();
const WRITE_DEBOUNCE_MS = 2000;
function getTodayDate() {
    return new Date().toISOString().slice(0, 10);
}
async function getLogsFromFile(userId, username) {
    if (!Native?.readStalkerLog)
        return [];
    try {
        const fileContents = await Native.readStalkerLog(userId, username);
        const parsed = JSON.parse(fileContents);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (error) {
        logger.error(`Failed to parse stalker log for user ${userId}, starting fresh:`, error);
        return [];
    }
}
function getCacheForUser(userId) {
    const cache = cachedLogsPerUser.get(userId);
    if (cache && cache.date !== getTodayDate()) {
        cachedLogsPerUser.delete(userId);
        return undefined;
    }
    return cache;
}
export function logStalkerEvent(entry) {
    if (!settings.store.enableLogging)
        return;
    if (!Native?.writeStalkerLog)
        return;
    const pending = pendingWrites.get(entry.userId) ?? [];
    pending.push(entry);
    pendingWrites.set(entry.userId, pending);
    const existing = writeTimers.get(entry.userId);
    if (existing)
        return;
    writeTimers.set(entry.userId, setTimeout(async () => {
        writeTimers.delete(entry.userId);
        const entries = pendingWrites.get(entry.userId) ?? [];
        pendingWrites.delete(entry.userId);
        const previousLock = writeLocks.get(entry.userId) ?? Promise.resolve();
        const newLock = previousLock.then(async () => {
            try {
                let cache = getCacheForUser(entry.userId);
                if (!cache) {
                    const logs = await getLogsFromFile(entry.userId, entry.username);
                    cache = { logs, date: getTodayDate() };
                    cachedLogsPerUser.set(entry.userId, cache);
                }
                cache.logs.push(...entries);
                await Native.writeStalkerLog(JSON.stringify(cache.logs), entry.userId, entry.username);
            }
            catch (error) {
                logger.error("Failed to write stalker log:", error);
            }
        });
        writeLocks.set(entry.userId, newLock);
        await newLock;
    }, WRITE_DEBOUNCE_MS));
}
export let targets = [];
const parseTargets = (parse) => {
    const regex = /\s*(,?)\s*([0-9]+)/g;
    const matches = [...parse.matchAll(regex)].map(match => match.at(match.length - 1));
    targets = matches;
    return matches;
};
export const settings = definePluginSettings({
    stalkContext: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Adds an option on the user context menu that enables stalking for users."
    },
    notifyCallJoin: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Send a notification when a user joins a voice channel.",
    },
    notifyCallLeave: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Send a notification when a user leaves a voice channel.",
    },
    notifyOffline: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Send a notification when a user goes offline."
    },
    notifyOnline: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Send a notification when a user goes online.",
    },
    notifyDnd: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Send a notification when a user goes on Do Not Disturb.",
    },
    notifyIdle: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Send a notification when a user goes idle.",
    },
    notifyGoOnline: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Send a notification when a user logs onto Discord or leaves invisible, regardless of the 4 above options."
    },
    enableLogging: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Enable logging of stalker events to a local file."
    },
    openStalkingFolder: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Open the Stalking data folder.",
        component: OpenStalkingFolderButton,
    },
    logMessages: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log when a user sends a message in any channel."
    },
    notifyOnMessage: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Send a notification when a stalked user sends a message."
    },
    logTyping: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log when a stalked user starts typing in a visible channel or DM."
    },
    notifyTyping: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Send a notification when a stalked user starts typing in a visible channel or DM."
    },
    logMessagePreview: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Include message previews in local message logs."
    },
    logActivities: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log when a user starts, stops, or changes an activity."
    },
    notifyActivities: {
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        description: "Send a notification when a user starts an activity."
    },
    logCustomStatus: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log custom status changes."
    },
    logClientStatus: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log whether a user is online from desktop, mobile, or web."
    },
    logVoiceStateChanges: {
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        description: "Log voice state changes like mute, deaf, video, and streaming."
    },
    targets: {
        type: 0 /* OptionType.STRING */,
        placeholder: "1234,5678",
        description: "List of user IDs to stalk, separate with a comma.",
        default: "",
        onChange: parseTargets,
    },
});
const patchUserContext = (children, { user }) => {
    if (!settings.store.stalkContext || !user)
        return;
    const stalked = targets.includes(user.id);
    const group = findGroupChildrenByChildId("apps", children) ?? children;
    let id = group.findLastIndex(child => child?.props?.id && child.props.id === "ignore");
    if (id < 0)
        id = group.length - 1;
    group.splice(id, 0, <Menu.MenuItem id="vc-st-stalk" label={stalked ? "Unstalk" : "Stalk"} action={() => {
            const currentTargets = new Set(parseTargets(settings.store.targets));
            if (stalked) {
                currentTargets.delete(user.id);
                cachedLogsPerUser.delete(user.id);
                writeLocks.delete(user.id);
            }
            else {
                currentTargets.add(user.id);
            }
            settings.store.targets = [...currentTargets].join(",");
            parseTargets(settings.store.targets);
        }}/>);
};
export default definePlugin({
    name: "Stalker",
    description: "Tracks selected users across status, voice, activity, client, custom status, and message events.",
    tags: ["Friends", "Utility"],
    authors: [
        { name: "Reycko", id: 1123725368004726794n },
        { name: "irritably", id: 928787166916640838n }
    ],
    contextMenus: {
        "user-context": patchUserContext,
    },
    start() {
        parseTargets(settings.store.targets);
        status.init();
        voice.init();
        activity.init();
    },
    stop() {
        activity.deinit();
        status.deinit();
        voice.deinit();
        for (const timer of writeTimers.values())
            clearTimeout(timer);
        writeTimers.clear();
        pendingWrites.clear();
        cachedLogsPerUser.clear();
        writeLocks.clear();
        typingNotificationCooldowns.clear();
    },
    flux: {
        MESSAGE_CREATE({ message, optimistic, type }) {
            if (optimistic || type === "MESSAGE_CREATE" && message.state === "SENDING")
                return;
            if (!targets.includes(message.author.id))
                return;
            const channel = ChannelStore.getChannel(message.channel_id);
            const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
            const user = UserStore.getUser(message.author.id) ?? message.author;
            const preview = settings.store.logMessagePreview
                ? message.content.length > 100
                    ? `${message.content.substring(0, 100)}...`
                    : message.content
                : null;
            if (settings.store.logMessages) {
                logStalkerEvent({
                    timestamp: new Date().toISOString(),
                    userId: message.author.id,
                    username: user.username,
                    action: "message_send",
                    details: preview ? `Sent message: ${preview}` : "Sent a message.",
                    channelName: channel?.name,
                    guildName: guild?.name,
                    metadata: {
                        channelId: message.channel_id,
                        guildId: channel?.guild_id ?? null,
                        messageId: message.id,
                        hasContent: message.content.length > 0
                    }
                });
            }
            if (settings.store.notifyOnMessage) {
                const channelName = channel
                    ? guild
                        ? `${guild.name} > #${channel.name}`
                        : `DM > ${channel.name}`
                    : "Unknown channel";
                const body = `${user.username} sent a message in ${channelName}:\n${message.content.substring(0, 80) || "(message hidden)"}`;
                showNotification({
                    title: "Stalker - New Message",
                    body,
                    icon: user.getAvatarURL(void 0, 128, true),
                    onClick: () => {
                        if (!channel)
                            return;
                        const route = channel.guild_id
                            ? `/channels/${channel.guild_id}/${channel.id}`
                            : `/channels/@me/${channel.id}`;
                        NavigationRouter.transitionTo(route);
                    }
                });
            }
        },
        TYPING_START({ userId, channelId }) {
            if (!settings.store.logTyping && !settings.store.notifyTyping)
                return;
            if (!targets.includes(userId))
                return;
            const user = UserStore.getUser(userId);
            if (!user)
                return;
            const channel = ChannelStore.getChannel(channelId);
            const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
            const channelName = channel
                ? guild
                    ? `${guild.name} > #${channel.name}`
                    : `DM > ${channel.name}`
                : "Unknown channel";
            if (settings.store.logTyping) {
                logStalkerEvent({
                    timestamp: new Date().toISOString(),
                    userId,
                    username: user.username,
                    action: "typing_start",
                    details: `Started typing in ${channelName}.`,
                    channelName: channel?.name,
                    guildName: guild?.name,
                    metadata: {
                        channelId,
                        guildId: channel?.guild_id ?? null
                    }
                });
            }
            if (!settings.store.notifyTyping)
                return;
            const now = Date.now();
            const cooldownKey = `${userId}:${channelId}`;
            const nextAllowed = typingNotificationCooldowns.get(cooldownKey) ?? 0;
            if (now < nextAllowed)
                return;
            typingNotificationCooldowns.set(cooldownKey, now + 10_000);
            showNotification({
                title: "Stalker - Typing",
                body: `${user.username} is typing in ${channelName}`,
                icon: user.getAvatarURL(void 0, 128, true),
                onClick: () => {
                    if (!channel)
                        return;
                    const route = channel.guild_id
                        ? `/channels/${channel.guild_id}/${channel.id}`
                        : `/channels/@me/${channel.id}`;
                    NavigationRouter.transitionTo(route);
                }
            });
        },
    },
    settings,
});
