/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import { VoiceChannelLogEntry } from "./types";

const STORAGE_KEY = "VoiceChannelLog_logs";
const MAX_ENTRIES_PER_CHANNEL = 1000;

const vcLogs = new Map<string, VoiceChannelLogEntry[]>();
let vcLogSubscriptions: (() => void)[] = [];

let callStartTime: Date | null = null;

export function getCallStartTime(): Date | null {
    return callStartTime;
}

export function setCallStartTime(time: Date | null) {
    callStartTime = time;
}

const EMPTY_LOGS: VoiceChannelLogEntry[] = [];

export function getVcLogs(channelId?: string): VoiceChannelLogEntry[] {
    if (!channelId) return EMPTY_LOGS;
    return vcLogs.get(channelId) ?? EMPTY_LOGS;
}

function notify() {
    vcLogSubscriptions.forEach(fn => fn());
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        void persistLogs();
    }, 500);
}

async function persistLogs() {
    try {
        const data: Record<string, VoiceChannelLogEntry[]> = {};
        for (const [channelId, entries] of vcLogs) {
            data[channelId] = entries;
        }
        await DataStore.set(STORAGE_KEY, data);
    } catch (e) {
        console.error("[VoiceChannelLog] Failed to persist logs:", e);
    }
}

function reviveEntry(entry: VoiceChannelLogEntry): VoiceChannelLogEntry {
    return {
        ...entry,
        timestamp: entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp)
    };
}

async function loadPersistedLogs() {
    try {
        const data = await DataStore.get<Record<string, VoiceChannelLogEntry[]>>(STORAGE_KEY);
        if (!data) return;
        for (const [channelId, entries] of Object.entries(data)) {
            if (!Array.isArray(entries)) continue;
            vcLogs.set(channelId, entries.map(reviveEntry));
        }
        notify();
    } catch (e) {
        console.error("[VoiceChannelLog] Failed to load persisted logs:", e);
    }
}

loadPersistedLogs();

export function addLogEntry(entry: VoiceChannelLogEntry) {
    const existing = vcLogs.get(entry.channelId) ?? [];
    const updated = [...existing, entry];
    if (updated.length > MAX_ENTRIES_PER_CHANNEL) {
        updated.splice(0, updated.length - MAX_ENTRIES_PER_CHANNEL);
    }
    vcLogs.set(entry.channelId, updated);
    notify();
    scheduleSave();
}

export function clearLogs(channelId?: string) {
    if (!channelId) return;
    vcLogs.set(channelId, []);
    notify();
    scheduleSave();
}

export function vcLogSubscribe(listener: () => void) {
    vcLogSubscriptions = [...vcLogSubscriptions, listener];
    return () => {
        vcLogSubscriptions = vcLogSubscriptions.filter(l => l !== listener);
    };
}
