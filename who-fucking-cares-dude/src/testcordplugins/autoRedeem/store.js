/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
const STORE_KEY = "AutoRedeem_logs";
const listeners = new Set();
let logs = [];
let loaded = false;
const notify = () => { for (const l of listeners)
    l(); };
export const subscribe = (listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
export const getLogs = () => logs;
export async function loadLogs() {
    if (loaded)
        return logs;
    const saved = await DataStore.get(STORE_KEY).catch(() => []);
    logs = Array.isArray(saved) ? saved : [];
    loaded = true;
    notify();
    return logs;
}
export function addLog(entry) {
    logs = [{ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() }, ...logs];
    notify();
    DataStore.set(STORE_KEY, logs);
}
export async function clearLogs() {
    logs = [];
    loaded = true;
    notify();
    await DataStore.set(STORE_KEY, logs);
}
