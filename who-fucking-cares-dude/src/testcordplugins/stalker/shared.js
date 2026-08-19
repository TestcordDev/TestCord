/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
/**
 * Shared whitelist management for Stalker and StalkerV2
 * Both plugins use the same targets list from the original Stalker plugin
 */
let targets = [];
let settingsStore = null;
export function initSharedTargets(settings) {
    settingsStore = settings;
    parseTargets();
}
export function parseTargets() {
    if (!settingsStore) {
        targets = [];
        return;
    }
    targets = settingsStore.targets ? settingsStore.targets.split(",").map((s) => s.trim()).filter(Boolean) : [];
}
export function getTargets() {
    return targets;
}
export function addTarget(userId) {
    if (!targets.includes(userId)) {
        targets.push(userId);
        if (settingsStore) {
            settingsStore.targets = targets.join(", ");
        }
    }
}
export function removeTarget(userId) {
    targets = targets.filter(id => id !== userId);
    if (settingsStore) {
        settingsStore.targets = targets.join(", ");
    }
}
export function isTarget(userId) {
    return targets.includes(userId);
}
export function setTargets(userIds) {
    targets = userIds;
    if (settingsStore) {
        settingsStore.targets = targets.join(", ");
    }
}
