/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { showNotification } from "@api/Notifications";
import { PresenceStore, UserStore } from "@webpack/common";
import { logStalkerEvent, settings, targets } from ".";
const NOTIFICATION_COLOR = "#5865f2";
const platforms = ["desktop", "mobile", "web", "embedded", "vr"];
let lastActivities = new Map();
let lastCustomStatuses = new Map();
let lastClientStatuses = new Map();
const getActivityKey = (activity) => [
    activity.type,
    activity.application_id ?? "",
    activity.name,
    activity.platform ?? ""
].join(":");
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
const getCustomStatusText = (activity) => {
    if (!activity)
        return "";
    const emoji = activity.emoji?.name;
    const text = activity.state ?? activity.name;
    return [emoji, text].filter(Boolean).join(" ");
};
const toSnapshot = (activity) => {
    const snapshot = {
        key: getActivityKey(activity),
        type: activity.type,
        name: activity.name,
        details: activity.details,
        state: activity.state,
        applicationId: activity.application_id,
        platform: activity.platform
    };
    return {
        ...snapshot,
        signature: JSON.stringify(snapshot)
    };
};
const getActivityMap = (userId) => {
    const activities = PresenceStore.getActivities(userId) ?? [];
    const activityMap = new Map();
    for (const activity of activities) {
        if (activity.type === 4 /* ActivityType.CUSTOM_STATUS */)
            continue;
        const snapshot = toSnapshot(activity);
        activityMap.set(snapshot.key, snapshot);
    }
    return activityMap;
};
const getCustomStatus = (userId) => {
    const activities = PresenceStore.getActivities(userId) ?? [];
    const customStatus = activities.find(activity => activity.type === 4 /* ActivityType.CUSTOM_STATUS */);
    return getCustomStatusText(customStatus);
};
const formatActivity = (activity) => {
    const details = activity.details ? `: ${activity.details}` : "";
    const state = activity.state ? ` (${activity.state})` : "";
    return `${formatActivityType(activity.type)} ${activity.name}${details}${state}`;
};
const formatClientStatus = (clientStatus) => platforms
    .map(platform => {
    const status = clientStatus?.[platform];
    return status ? `${platform}:${status}` : "";
})
    .filter(Boolean)
    .join(", ");
const getUsername = (userId) => UserStore.getUser(userId)?.username ?? userId;
const logActivity = (userId, action, event, details) => {
    logStalkerEvent({
        timestamp: new Date().toISOString(),
        userId,
        username: getUsername(userId),
        action: event,
        details,
        metadata: {
            activityType: action.type,
            applicationId: action.applicationId ?? null,
            platform: action.platform ?? null
        }
    });
};
const maybeNotifyActivityStart = (userId, activity) => {
    if (!settings.store.notifyActivities)
        return;
    const user = UserStore.getUser(userId);
    if (!user)
        return;
    showNotification({
        title: "Stalker",
        body: `${user.username} started ${formatActivity(activity)}`,
        icon: user.getAvatarURL(),
        color: NOTIFICATION_COLOR,
    });
};
const seedUser = (userId) => {
    lastActivities.set(userId, getActivityMap(userId));
    lastCustomStatuses.set(userId, getCustomStatus(userId));
    lastClientStatuses.set(userId, formatClientStatus(PresenceStore.getClientStatus(userId)));
};
const pruneRemovedTargets = () => {
    const targetSet = new Set(targets);
    for (const userId of lastActivities.keys()) {
        if (!targetSet.has(userId))
            lastActivities.delete(userId);
    }
    for (const userId of lastCustomStatuses.keys()) {
        if (!targetSet.has(userId))
            lastCustomStatuses.delete(userId);
    }
    for (const userId of lastClientStatuses.keys()) {
        if (!targetSet.has(userId))
            lastClientStatuses.delete(userId);
    }
};
const handleActivities = (userId, currentActivities) => {
    if (!settings.store.logActivities && !settings.store.notifyActivities)
        return;
    const previousActivities = lastActivities.get(userId) ?? new Map();
    for (const [key, activity] of currentActivities) {
        const previousActivity = previousActivities.get(key);
        if (!previousActivity) {
            if (settings.store.logActivities)
                logActivity(userId, activity, "activity_start", `Started ${formatActivity(activity)}.`);
            maybeNotifyActivityStart(userId, activity);
            continue;
        }
        if (settings.store.logActivities && previousActivity.signature !== activity.signature) {
            logActivity(userId, activity, "activity_update", `Changed activity from ${formatActivity(previousActivity)} to ${formatActivity(activity)}.`);
        }
    }
    if (!settings.store.logActivities)
        return;
    for (const [key, activity] of previousActivities) {
        if (!currentActivities.has(key))
            logActivity(userId, activity, "activity_stop", `Stopped ${formatActivity(activity)}.`);
    }
};
const handleCustomStatus = (userId, currentCustomStatus) => {
    if (!settings.store.logCustomStatus)
        return;
    const previousCustomStatus = lastCustomStatuses.get(userId) ?? "";
    if (previousCustomStatus === currentCustomStatus)
        return;
    logStalkerEvent({
        timestamp: new Date().toISOString(),
        userId,
        username: getUsername(userId),
        action: "custom_status_change",
        details: currentCustomStatus
            ? `Custom status changed from ${previousCustomStatus || "empty"} to ${currentCustomStatus}.`
            : `Cleared custom status: ${previousCustomStatus}.`,
        metadata: {
            hadPreviousStatus: previousCustomStatus.length > 0,
            hasCurrentStatus: currentCustomStatus.length > 0
        }
    });
};
const handleClientStatus = (userId, currentClientStatus) => {
    if (!settings.store.logClientStatus)
        return;
    const previousClientStatus = lastClientStatuses.get(userId) ?? "";
    if (previousClientStatus === currentClientStatus)
        return;
    logStalkerEvent({
        timestamp: new Date().toISOString(),
        userId,
        username: getUsername(userId),
        action: "client_status_change",
        details: `Client status changed from ${previousClientStatus || "offline"} to ${currentClientStatus || "offline"}.`
    });
};
const presenceChange = () => {
    pruneRemovedTargets();
    for (const userId of targets) {
        const currentActivities = getActivityMap(userId);
        const currentCustomStatus = getCustomStatus(userId);
        const currentClientStatus = formatClientStatus(PresenceStore.getClientStatus(userId));
        if (!lastActivities.has(userId) || !lastCustomStatuses.has(userId) || !lastClientStatuses.has(userId)) {
            seedUser(userId);
            continue;
        }
        handleActivities(userId, currentActivities);
        handleCustomStatus(userId, currentCustomStatus);
        handleClientStatus(userId, currentClientStatus);
        lastActivities.set(userId, currentActivities);
        lastCustomStatuses.set(userId, currentCustomStatus);
        lastClientStatuses.set(userId, currentClientStatus);
    }
};
export const init = () => {
    lastActivities = new Map();
    lastCustomStatuses = new Map();
    lastClientStatuses = new Map();
    for (const userId of targets) {
        seedUser(userId);
    }
    PresenceStore.addChangeListener(presenceChange);
};
export const deinit = () => {
    PresenceStore.removeChangeListener(presenceChange);
    lastActivities.clear();
    lastCustomStatuses.clear();
    lastClientStatuses.clear();
};
