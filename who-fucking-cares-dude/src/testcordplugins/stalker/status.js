/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { showNotification } from "@api/Notifications";
import { ChannelStore, NavigationRouter, PresenceStore, UserStore } from "@webpack/common";
import { logStalkerEvent, settings, targets } from ".";
let lastStatuses;
const NOTIFICATION_COLOR = "#5865f2";
const shouldNotifyForTransition = (lastStatus, newStatus) => {
    if (lastStatus === "offline" && settings.store.notifyGoOnline)
        return true;
    if (newStatus === "dnd" && settings.store.notifyDnd)
        return true;
    if (newStatus === "idle" && settings.store.notifyIdle)
        return true;
    if (newStatus === "online" && settings.store.notifyOnline)
        return true;
    if (newStatus === "offline" && settings.store.notifyOffline)
        return true;
    return false;
};
const formatStatus = (status) => status === "dnd" ? "in dnd" : status;
export const init = () => {
    PresenceStore.addChangeListener(statusChange);
};
export const deinit = () => {
    PresenceStore.removeChangeListener(statusChange);
    lastStatuses = undefined;
};
export const statusChange = () => {
    const rawNewStatuses = PresenceStore.getState()?.statuses;
    if (typeof rawNewStatuses !== "object")
        return;
    const newStatuses = { ...rawNewStatuses };
    for (const id of targets) {
        if (!newStatuses[id])
            newStatuses[id] = "offline";
    }
    if (!lastStatuses) {
        lastStatuses = { ...newStatuses };
        return;
    }
    for (const id of targets) {
        const newStatus = newStatuses[id] ?? "offline";
        const lastStatus = lastStatuses[id] ?? "offline";
        if (lastStatus === newStatus)
            continue;
        const user = UserStore.getUser(id);
        if (!user)
            continue;
        if (shouldNotifyForTransition(lastStatus, newStatus)) {
            showNotification({
                title: "Stalker",
                body: `${user.username} is now ${formatStatus(newStatus)}`,
                color: NOTIFICATION_COLOR,
                icon: user.getAvatarURL(),
                onClick: () => {
                    const channelId = ChannelStore.getDMFromUserId(user.id);
                    if (channelId)
                        NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
                },
            });
        }
        logStalkerEvent({
            timestamp: new Date().toISOString(),
            userId: user.id,
            username: user.username,
            action: "status_change",
            details: `Status changed from ${lastStatus} to ${newStatus}.`
        });
    }
    lastStatuses = { ...newStatuses };
};
