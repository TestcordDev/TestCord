/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import { SavedAccount as ProviderAccount, TmMessage } from "./providers";

const ACCOUNTS_KEY = "TempMail_accounts_v2";
const ACTIVE_KEY = "TempMail_activeId";
const MESSAGES_KEY = "TempMail_messages"; // { [accountId]: TmMessage[] }
const LEGACY_ACCOUNTS_KEY = "TempMail_accounts";

export type SavedAccount = ProviderAccount;

// ── Migration from v1 (mail.tm only) ────────────────────────────────────────
async function migrateIfNeeded(): Promise<void> {
    const v2 = await DataStore.get<SavedAccount[]>(ACCOUNTS_KEY);
    if (v2 != null) return;
    const legacy: any[] = (await DataStore.get<any[]>(LEGACY_ACCOUNTS_KEY)) ?? [];
    if (!legacy.length) return;
    const migrated: SavedAccount[] = legacy.map(a => ({
        id: a.id,
        providerId: a.providerId ?? "mail.tm",
        address: a.address,
        token: a.token,
        password: a.password,
        createdAt: a.createdAt ?? Date.now(),
        login: a.address?.split("@")[0],
        domain: a.address?.split("@")[1],
    }));
    await DataStore.set(ACCOUNTS_KEY, migrated);
}

// ── Accounts ──────────────────────────────────────────────────────────────────
export async function getSavedAccounts(): Promise<SavedAccount[]> {
    await migrateIfNeeded();
    return (await DataStore.get<SavedAccount[]>(ACCOUNTS_KEY)) ?? [];
}

export async function saveAccount(acc: SavedAccount): Promise<void> {
    const list = await getSavedAccounts();
    const idx = list.findIndex(a => a.id === acc.id);
    if (idx >= 0) list[idx] = acc; else list.push(acc);
    await DataStore.set(ACCOUNTS_KEY, list);
}

export async function removeAccount(id: string): Promise<void> {
    const list = await getSavedAccounts();
    await DataStore.set(ACCOUNTS_KEY, list.filter(a => a.id !== id));
    const all = await getAllSavedMessages();
    delete all[id];
    await DataStore.set(MESSAGES_KEY, all);
    const active = await getActiveId();
    if (active === id) await DataStore.del(ACTIVE_KEY);
}

// ── Active account ────────────────────────────────────────────────────────────
export async function getActiveId(): Promise<string | undefined> {
    return DataStore.get<string>(ACTIVE_KEY);
}

export async function setActiveId(id: string): Promise<void> {
    await DataStore.set(ACTIVE_KEY, id);
}

// ── Saved messages (persisted per account) ────────────────────────────────────
async function getAllSavedMessages(): Promise<Record<string, TmMessage[]>> {
    return (await DataStore.get<Record<string, TmMessage[]>>(MESSAGES_KEY)) ?? {};
}

export async function getSavedMessages(accountId: string): Promise<TmMessage[]> {
    const all = await getAllSavedMessages();
    return all[accountId] ?? [];
}

export async function mergeAndSaveMessages(accountId: string, fresh: TmMessage[]): Promise<TmMessage[]> {
    const all = await getAllSavedMessages();
    const existing = new Map((all[accountId] ?? []).map(m => [m.id, m]));
    fresh.forEach(m => existing.set(m.id, m));
    const merged = Array.from(existing.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    all[accountId] = merged;
    await DataStore.set(MESSAGES_KEY, all);
    return merged;
}

export async function deleteMessageFromStore(accountId: string, messageId: string): Promise<void> {
    const all = await getAllSavedMessages();
    if (all[accountId]) {
        all[accountId] = all[accountId].filter(m => m.id !== messageId);
        await DataStore.set(MESSAGES_KEY, all);
    }
}

// ── Storage path (informational) ──────────────────────────────────────────────
export function getDataStorePath(): string {
    try {
        const p = process?.env?.APPDATA ?? "";
        if (p) return p + "\\discord\\IndexedDB  (VencordData)";
    } catch { }
    return "%APPDATA%\\discord\\IndexedDB  (VencordData)";
}
