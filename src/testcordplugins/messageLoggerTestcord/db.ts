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

function isUncloneable(value: unknown) {
    const type = typeof value;
    return type === "function" || type === "symbol";
}

/**
 * IndexedDB stores values with the structured clone algorithm, which rejects functions
 * and symbols. Discord attaches helper functions as own properties on messages, and
 * lodash.cloneDeep copies nested functions by reference rather than dropping them, so
 * they survive the copy in cloneMessage and reach `put`. One of them fails the whole
 * transaction with DataCloneError, silently losing every record batched with it.
 *
 * Walks the value and reports whether anything needs dropping. Cheap on the common
 * path, where a message carries no functions and the record is stored as-is.
 */
function hasUncloneable(value: unknown, seen: WeakSet<object>): boolean {
    if (isUncloneable(value)) return true;
    if (value === null || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) return value.some(item => hasUncloneable(item, seen));
    return Object.values(value).some(item => hasUncloneable(item, seen));
}

function pruneUncloneable(value: any, seen: WeakMap<object, any>): any {
    if (value === null || typeof value !== "object") return value;

    const existing = seen.get(value);
    if (existing !== undefined) return existing;

    // Anything with a real prototype (Date, Blob, File, ...) is left alone: the
    // structured clone algorithm knows how to copy those.
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value;

    if (Array.isArray(value)) {
        const out: any[] = [];
        seen.set(value, out);
        for (const item of value) {
            if (isUncloneable(item)) continue;
            out.push(pruneUncloneable(item, seen));
        }
        return out;
    }

    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [key, item] of Object.entries(value)) {
        if (isUncloneable(item)) continue;
        out[key] = pruneUncloneable(item, seen);
    }
    return out;
}

function toStorable(record: LogRecord): LogRecord {
    return hasUncloneable(record, new WeakSet()) ? pruneUncloneable(record, new WeakMap()) : record;
}

export async function applyBatch(records: LogRecord[], deletedIds: string[]) {
    if (records.length === 0 && deletedIds.length === 0) return;

    const database = await getDatabase();
    const transaction = database.transaction("messages", "readwrite");
    const existingRecords = await Promise.all(records.map(record => transaction.store.get(record.message_id)));
    const updatedAt = new Date().toISOString();
    await Promise.all([
        ...records.map((record, index) => transaction.store.put(toStorable({
            ...record,
            protected: record.protected ?? existingRecords[index]?.protected,
            hidden: record.hidden ?? existingRecords[index]?.hidden,
            createdAt: existingRecords[index]?.createdAt ?? record.createdAt ?? updatedAt,
            updatedAt
        }))),
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
        // NOTE: the persisted `hidden` flag is intentionally not honored here.
        // Its only writer was Delete Message (Temporary), which persisted it by
        // mistake and made temporary hides permanent. Session hides now live in
        // an in-memory set (see isTempHiddenMessage); ignoring the stale flag
        // resurrects those rows without a database migration.
        if (cursor.value.status !== LogStatus.EDITED) records.push(cursor.value);
        cursor = await cursor.continue();
    }

    return records;
}

export async function getAllHistoryForChannel(channelId: string) {
    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_channel_id");
    const records = await index.getAll(channelId);
    return records.filter(record => record.status === LogStatus.EDITED
        || (Array.isArray(record.message.editHistory) && record.message.editHistory.length > 0));
}

export async function getLogById(messageId: string) {
    const database = await getDatabase();
    return database.get("messages", messageId);
}

export async function getChannelLogsLimit(channelId: string, limit: number, beforeTimestamp?: string): Promise<LogRecord[]> {
    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_timestamp_and_message_id");
    let range: IDBKeyRange;
    if (beforeTimestamp) {
        let normalized: string;
        try { normalized = new Date(String(beforeTimestamp)).toISOString(); } catch { normalized = String(beforeTimestamp); }
        range = IDBKeyRange.bound([channelId, ""], [channelId, normalized], false, true);
    } else {
        range = IDBKeyRange.bound([channelId, ""], [channelId, "\uffff"]);
    }
    const records: LogRecord[] = [];
    let cursor = await index.openCursor(range, "prev");
    while (cursor && records.length < limit) {
        if (cursor.value.status !== LogStatus.EDITED) records.push(cursor.value);
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
    let protectedInSample = 0;
    // Estimate size from a sample: a full stringify+encode pass over hundreds
    // of thousands of records froze the client for seconds on every open.
    // Counts above stay exact (indexed); these two are display estimates.
    const SAMPLE_LIMIT = 200;
    let sampledBytes = 0;
    let sampledCount = 0;
    let cursor = await database.transaction("messages").store.openCursor();

    while (cursor && sampledCount < SAMPLE_LIMIT) {
        if (cursor.value.protected) protectedInSample++;
        sampledBytes += encoder.encode(JSON.stringify(cursor.value)).byteLength;
        sampledCount++;
        cursor = await cursor.continue();
    }

    const protectedCount = sampledCount ? Math.round(protectedInSample / sampledCount * total) : 0;
    const estimatedBytes = sampledCount ? Math.round(sampledBytes / sampledCount * total) : 0;

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
