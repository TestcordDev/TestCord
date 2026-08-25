/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DBSchema, IDBPDatabase, openDB } from "idb";

export interface PresenceStatus {
    hasBeenOnline: boolean;
    lastOffline: number | null;
}

interface LastOnlineDB extends DBSchema {
    presence: {
        key: string;
        value: PresenceStatus & { userId: string; };
    };
}

const DB_NAME = "LastOnlineIDB";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<LastOnlineDB>> | undefined;

export function getDb() {
    return dbPromise ??= openDB<LastOnlineDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            db.createObjectStore("presence", { keyPath: "userId" });
        }
    });
}

export async function getAllPresence(): Promise<Record<string, PresenceStatus>> {
    const db = await getDb();
    const records = await db.getAll("presence");
    return Object.fromEntries(records.map(r => [r.userId, { hasBeenOnline: r.hasBeenOnline, lastOffline: r.lastOffline }]));
}

export async function putPresenceBatch(entries: Array<[string, PresenceStatus]>) {
    if (!entries.length) return;
    const db = await getDb();
    const tx = db.transaction("presence", "readwrite");
    await Promise.all([
        ...entries.map(([userId, status]) => tx.store.put({ userId, ...status })),
        tx.done
    ]);
}
