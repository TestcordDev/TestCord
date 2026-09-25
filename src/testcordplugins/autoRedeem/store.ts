/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

export type RedeemStatus = "success" | "failed";
export type RedeemType = "nitro" | "decoration" | "other";

export interface RedeemLog {
    id: string;
    code: string;
    status: RedeemStatus;
    type: RedeemType;
    error?: string;
    channelId?: string;
    messageId?: string;
    timestamp: number;
}

const STORE_KEY = "AutoRedeem_logs";
const MAX_LOGS = 5000;
const listeners = new Set<() => void>();
let logs: RedeemLog[] = [];
let loaded = false;
let loadPromise: Promise<RedeemLog[]> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const persistWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void; }> = [];

const notify = () => { for (const l of listeners) l(); };

function persistLogs() {
    return new Promise<void>((resolve, reject) => {
        persistWaiters.push({ resolve, reject });
        if (persistTimer !== undefined) return;
        persistTimer = setTimeout(() => {
            persistTimer = undefined;
            const snapshot = logs;
            const waiters = persistWaiters.splice(0);
            void Promise.resolve().then(() => DataStore.set(STORE_KEY, snapshot)).then(
                () => { for (const waiter of waiters) waiter.resolve(); },
                error => { for (const waiter of waiters) waiter.reject(error); },
            );
        }, 100);
    });
}

export const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const getLogs = () => logs;

export async function loadLogs() {
    if (loaded) return logs;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const saved = await DataStore.get<RedeemLog[]>(STORE_KEY).catch(() => []);
        if (!loaded) {
            const savedLogs = Array.isArray(saved) ? saved : [];
            const existingIds = new Set(logs.map(log => log.id));
            logs = [...logs, ...savedLogs.filter(log => !existingIds.has(log.id))].slice(0, MAX_LOGS);
            loaded = true;
            notify();
            if (logs.length !== savedLogs.length) void persistLogs().catch(() => { });
        }
        return logs;
    })();
    try {
        return await loadPromise;
    } finally {
        loadPromise = null;
    }
}

export function addLog(entry: Omit<RedeemLog, "id" | "timestamp">) {
    logs = [{ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() }, ...logs].slice(0, MAX_LOGS);
    notify();
    void persistLogs().catch(() => { });
}

export async function clearLogs() {
    logs = [];
    loaded = true;
    notify();
    await persistLogs();
}
