/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { React } from "@webpack/common";
let questRerenderVersion = 0;
const listeners = new Set();
function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
function getSnapshot() {
    return questRerenderVersion;
}
export function rerenderQuests() {
    questRerenderVersion++;
    listeners.forEach(listener => listener());
}
export function useQuestRerender() {
    return React.useSyncExternalStore(subscribe, getSnapshot);
}
