/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
const ACCOUNTS_KEY = "TempMail_accounts";
const ACTIVE_KEY = "TempMail_activeId";
const MESSAGES_KEY = "TempMail_messages"; // { [accountId]: TmMessage[] }
// ── Accounts ──────────────────────────────────────────────────────────────────
export async function getSavedAccounts() {
    return (await DataStore.get(ACCOUNTS_KEY)) ?? [];
}
export async function saveAccount(acc) {
    const list = await getSavedAccounts();
    const idx = list.findIndex(a => a.id === acc.id);
    if (idx >= 0)
        list[idx] = acc;
    else
        list.push(acc);
    await DataStore.set(ACCOUNTS_KEY, list);
}
export async function removeAccount(id) {
    const list = await getSavedAccounts();
    await DataStore.set(ACCOUNTS_KEY, list.filter(a => a.id !== id));
    const all = await getAllSavedMessages();
    delete all[id];
    await DataStore.set(MESSAGES_KEY, all);
    const active = await getActiveId();
    if (active === id)
        await DataStore.del(ACTIVE_KEY);
}
// ── Active account ────────────────────────────────────────────────────────────
export async function getActiveId() {
    return DataStore.get(ACTIVE_KEY);
}
export async function setActiveId(id) {
    await DataStore.set(ACTIVE_KEY, id);
}
// ── Saved messages (persisted per account) ────────────────────────────────────
async function getAllSavedMessages() {
    return (await DataStore.get(MESSAGES_KEY)) ?? {};
}
export async function getSavedMessages(accountId) {
    const all = await getAllSavedMessages();
    return all[accountId] ?? [];
}
export async function mergeAndSaveMessages(accountId, fresh) {
    const all = await getAllSavedMessages();
    const existing = new Map((all[accountId] ?? []).map(m => [m.id, m]));
    fresh.forEach(m => existing.set(m.id, m));
    const merged = Array.from(existing.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    all[accountId] = merged;
    await DataStore.set(MESSAGES_KEY, all);
    return merged;
}
export async function deleteMessageFromStore(accountId, messageId) {
    const all = await getAllSavedMessages();
    if (all[accountId]) {
        all[accountId] = all[accountId].filter(m => m.id !== messageId);
        await DataStore.set(MESSAGES_KEY, all);
    }
}
// ── Storage path (informational) ──────────────────────────────────────────────
export function getDataStorePath() {
    try {
        const p = process?.env?.APPDATA ?? "";
        if (p)
            return p + "\\discord\\IndexedDB  (VencordData)";
    }
    catch { }
    return "%APPDATA%\\discord\\IndexedDB  (VencordData)";
}
