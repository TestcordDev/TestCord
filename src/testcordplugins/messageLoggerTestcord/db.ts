/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DBSchema, IDBPDatabase, openDB } from "idb";

import { createSearchMatcher } from "./search";
import { LogPage, LogRecord, LogStats, LogStatus, LogViewStatus } from "./types";

export const DB_NAME = "TestcordMessageLoggerIDB";
const DB_VERSION = 1;

interface MessageLoggerDatabase extends DBSchema {
    messages: {
        key: string;
        value: LogRecord;
        indexes: {
            by_channel_id: string;
            by_status: LogStatus;
            by_timestamp: string;
            by_timestamp_and_message_id: [string, string];
        };
    };
}

let databasePromise: Promise<IDBPDatabase<MessageLoggerDatabase>> | undefined;
let statsCache: LogStats | undefined;

export function getDatabase() {
    return databasePromise ??= openDB<MessageLoggerDatabase>(DB_NAME, DB_VERSION, {
        upgrade(database) {
            const store = database.createObjectStore("messages", { keyPath: "message_id" });
            store.createIndex("by_channel_id", "channel_id");
            store.createIndex("by_status", "status");
            store.createIndex("by_timestamp", "message.timestamp");
            store.createIndex("by_timestamp_and_message_id", ["channel_id", "message.timestamp"]);
        }
    });
}

function invalidateStats() {
    statsCache = undefined;
}

export async function applyBatch(records: LogRecord[], deletedIds: string[]) {
    if (records.length === 0 && deletedIds.length === 0) return;

    const database = await getDatabase();
    const transaction = database.transaction("messages", "readwrite");
    const existingRecords = await Promise.all(records.map(record => transaction.store.get(record.message_id)));
    const updatedAt = new Date().toISOString();
    await Promise.all([
        ...records.map((record, index) => transaction.store.put({
            ...record,
            protected: record.protected ?? existingRecords[index]?.protected,
            hidden: record.hidden ?? existingRecords[index]?.hidden,
            createdAt: existingRecords[index]?.createdAt ?? record.createdAt ?? updatedAt,
            updatedAt
        })),
        ...deletedIds.map(id => transaction.store.delete(id)),
        transaction.done
    ]);
    invalidateStats();
}

export async function getLogPage(status: LogViewStatus, newest: boolean, limit: number, query: string, cursor?: string): Promise<LogPage> {
    const database = await getDatabase();
    const transaction = database.transaction("messages");
    const range = cursor
        ? newest ? IDBKeyRange.upperBound(cursor, true) : IDBKeyRange.lowerBound(cursor, true)
        : undefined;
    const direction = newest ? "prev" : "next";
    const matchesSearch = createSearchMatcher(query);
    const records: LogRecord[] = [];
    let next = await transaction.store.openCursor(range, direction);
    let lastScannedId: string | undefined;

    while (next && records.length < limit) {
        const record = next.value;
        lastScannedId = record.message_id;
        if ((status === "ALL" || record.status === status) && matchesSearch(record)) records.push(record);
        next = await next.continue();
    }

    const total = status === "ALL"
        ? await transaction.store.count()
        : await transaction.store.index("by_status").count(status);
    await transaction.done;

    return {
        records,
        cursor: lastScannedId,
        hasMore: next != null,
        total
    };
}

export async function getChannelLogsAfter(channelId: string, timestamp: string) {
    let normalizedTs: string;
    try {
        normalizedTs = new Date(String(timestamp)).toISOString();
    } catch {
        normalizedTs = String(timestamp);
    }
    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_timestamp_and_message_id");
    const range = IDBKeyRange.bound([channelId, normalizedTs], [channelId, "\uffff"]);
    const records: LogRecord[] = [];
    let cursor = await index.openCursor(range);

    while (cursor) {
        if (cursor.value.status !== LogStatus.EDITED && !cursor.value.hidden) records.push(cursor.value);
        cursor = await cursor.continue();
    }

    return records;
}

async function getOldestIds(limit: number, cutoff?: string, preservedChannelId?: string) {
    if (limit <= 0) return [];

    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_timestamp");
    const range = cutoff ? IDBKeyRange.upperBound(cutoff) : undefined;
    const ids: string[] = [];
    let cursor = await index.openCursor(range);

    while (cursor && ids.length < limit) {
        if (!cursor.value.protected && cursor.value.channel_id !== preservedChannelId) ids.push(cursor.value.message_id);
        cursor = await cursor.continue();
    }

    return ids;
}

export async function deleteLogs(ids: string[]) {
    const database = await getDatabase();

    for (let offset = 0; offset < ids.length; offset += 500) {
        const transaction = database.transaction("messages", "readwrite");
        await Promise.all([
            ...ids.slice(offset, offset + 500).map(id => transaction.store.delete(id)),
            transaction.done
        ]);
    }
    if (ids.length > 0) invalidateStats();
}

export async function clearLogs() {
    const database = await getDatabase();
    await database.clear("messages");
    invalidateStats();
}

export async function clearUnprotectedLogs() {
    const database = await getDatabase();
    const ids: string[] = [];
    let cursor = await database.transaction("messages").store.openCursor();

    while (cursor) {
        if (!cursor.value.protected) ids.push(cursor.value.message_id);
        cursor = await cursor.continue();
    }

    await deleteLogs(ids);
}

export async function setLogProtected(messageId: string, value: boolean) {
    const database = await getDatabase();
    const transaction = database.transaction("messages", "readwrite");
    const record = await transaction.store.get(messageId);
    if (!record) return;

    record.protected = value;
    record.updatedAt = new Date().toISOString();
    await transaction.store.put(record);
    await transaction.done;
    invalidateStats();
    return record;
}

export async function setLogsProtected(messageIds: string[], value: boolean) {
    const database = await getDatabase();

    for (let offset = 0; offset < messageIds.length; offset += 250) {
        const transaction = database.transaction("messages", "readwrite");
        const ids = messageIds.slice(offset, offset + 250);
        const records = await Promise.all(ids.map(id => transaction.store.get(id)));
        const updatedAt = new Date().toISOString();
        await Promise.all([
            ...records.filter(record => record != null).map(record => transaction.store.put({ ...record, protected: value, updatedAt })),
            transaction.done
        ]);
    }

    invalidateStats();
}

/** Flag a record as hidden so it never renders inline again after restarts. */
export async function setLogHidden(messageId: string, value: boolean) {
    const database = await getDatabase();
    const transaction = database.transaction("messages", "readwrite");
    const record = await transaction.store.get(messageId);
    if (!record) return;

    record.hidden = value;
    await transaction.store.put(record);
    await transaction.done;
}

export async function getAllLogs() {
    const database = await getDatabase();
    return database.getAll("messages");
}

export async function importLogRecords(records: LogRecord[]) {
    for (let offset = 0; offset < records.length; offset += 250) {
        await applyBatch(records.slice(offset, offset + 250), []);
    }
}

export async function getLogStats(): Promise<LogStats> {
    if (statsCache) return statsCache;

    const database = await getDatabase();
    const [total, deleted, edited, ghostPinged] = await Promise.all([
        database.count("messages"),
        database.countFromIndex("messages", "by_status", LogStatus.DELETED),
        database.countFromIndex("messages", "by_status", LogStatus.EDITED),
        database.countFromIndex("messages", "by_status", LogStatus.GHOST_PINGED)
    ]);
    const encoder = new TextEncoder();
    let protectedCount = 0;
    let estimatedBytes = 0;
    let cursor = await database.transaction("messages").store.openCursor();

    while (cursor) {
        if (cursor.value.protected) protectedCount++;
        estimatedBytes += encoder.encode(JSON.stringify(cursor.value)).byteLength;
        cursor = await cursor.continue();
    }

    return statsCache = {
        total,
        deleted,
        edited,
        ghostPinged,
        protected: protectedCount,
        estimatedBytes
    };
}

export async function runMaintenance(messageLimit: number, retentionDays: number, preservedChannelId?: string) {
    const database = await getDatabase();

    if (retentionDays > 0) {
        const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
        let oldIds: string[];
        do {
            oldIds = await getOldestIds(500, cutoff, preservedChannelId);
            await deleteLogs(oldIds);
        } while (oldIds.length === 500);
    }

    if (messageLimit > 0) {
        let excess = await database.count("messages") - messageLimit;
        while (excess > 0) {
            const ids = await getOldestIds(Math.min(excess, 500));
            if (ids.length === 0) break;
            await deleteLogs(ids);
            excess -= ids.length;
        }
    }
}
