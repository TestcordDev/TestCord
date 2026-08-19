/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { reconcileUnreadFallbackCache } from "@equicordplugins/channelTabs/util/unreadState";
const DATASTORE_KEY = "ChannelTabs_unreadFallbacks_v1";
const unreadFallbacks = {};
const unreadFallbackLoads = new Map();
const unreadFallbackSaves = new Map();
export function getUnreadFallbackCounts(userId) {
    return unreadFallbacks[userId] ?? {};
}
export async function ensureUnreadFallbackCountsLoaded(userId) {
    if (unreadFallbacks[userId])
        return unreadFallbacks[userId];
    if (unreadFallbackLoads.has(userId))
        return unreadFallbackLoads.get(userId);
    const loadPromise = DataStore.get(DATASTORE_KEY)
        .then(fallbacks => {
        unreadFallbacks[userId] = {
            ...(fallbacks?.[userId] ?? {}),
            ...(unreadFallbacks[userId] ?? {})
        };
        unreadFallbackLoads.delete(userId);
        return unreadFallbacks[userId];
    });
    unreadFallbackLoads.set(userId, loadPromise);
    return loadPromise;
}
export function updateUnreadFallbackCounts(userId, channelStates) {
    const currentFallbacks = unreadFallbacks[userId] ?? {};
    const nextFallbacks = reconcileUnreadFallbackCache(currentFallbacks, channelStates);
    if (JSON.stringify(nextFallbacks) === JSON.stringify(currentFallbacks))
        return;
    unreadFallbacks[userId] = nextFallbacks;
    const pendingSave = unreadFallbackSaves.get(userId) ?? Promise.resolve();
    const nextSave = pendingSave
        .catch(() => void 0)
        .then(() => DataStore.update(DATASTORE_KEY, old => ({
        ...(old ?? {}),
        [userId]: unreadFallbacks[userId]
    })));
    unreadFallbackSaves.set(userId, nextSave);
}
