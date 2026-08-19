/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const vcLogs = new Map();
let vcLogSubscriptions = [];
let callStartTime = null;
export function getCallStartTime() {
    return callStartTime;
}
export function setCallStartTime(time) {
    callStartTime = time;
}
const EMPTY_LOGS = [];
export function getVcLogs(channelId) {
    if (!channelId)
        return EMPTY_LOGS;
    return vcLogs.get(channelId) ?? EMPTY_LOGS;
}
export function addLogEntry(entry) {
    const existing = vcLogs.get(entry.channelId) ?? [];
    vcLogs.set(entry.channelId, [...existing, entry]);
    vcLogSubscriptions.forEach(fn => fn());
}
export function clearLogs(channelId) {
    if (!channelId)
        return;
    vcLogs.set(channelId, []);
    vcLogSubscriptions.forEach(fn => fn());
}
export function vcLogSubscribe(listener) {
    vcLogSubscriptions = [...vcLogSubscriptions, listener];
    return () => {
        vcLogSubscriptions = vcLogSubscriptions.filter(l => l !== listener);
    };
}
