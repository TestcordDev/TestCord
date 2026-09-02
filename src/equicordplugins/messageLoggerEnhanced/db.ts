/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { CACHED_MESSAGES_MAX } from "@utils/cacheLimits";
import { Logger } from "@utils/Logger";
import { ChannelStore, Toasts } from "@webpack/common";
import { DBSchema, IDBPDatabase, openDB } from "idb";

import { LoggedMessageJSON } from "./types";
import { getMessageStatus } from "./utils";
import { sanitizeForIDB, stripTransientRenderState } from "./utils/cleanUp";
import { DB_NAME, DB_VERSION } from "./utils/constants";
import { getAttachmentBlobUrl } from "./utils/saveImage";

export enum DBMessageStatus {
    DELETED = "DELETED",
    EDITED = "EDITED",
    GHOST_PINGED = "GHOST_PINGED",
}

export interface DBMessageRecord {
    message_id: string;
    channel_id: string;
    status: DBMessageStatus;
    message: LoggedMessageJSON;
}

export interface MLIDB extends DBSchema {
    messages: {
        key: string;
        value: DBMessageRecord;
        indexes: {
            by_channel_id: string;
            by_status: DBMessageStatus;
            by_timestamp: string;
            by_timestamp_and_message_id: [string, string];
        };
    };

}

export let db: IDBPDatabase<MLIDB>;
export const cachedMessages = new Map<string, LoggedMessageJSON>();

async function cacheRecords(records: DBMessageRecord[]) {
    for (const r of records) {
        cacheRecord(r);

        if (r.message.attachments.length > 0) {
            await Promise.all(r.message.attachments.map(async att => {
                const blobUrl = await getAttachmentBlobUrl(att);
                if (blobUrl) {
                    att.url = blobUrl + "#";
                    att.proxy_url = blobUrl + "#";
                }
            }));
        }
    }
    return records;
}

async function cacheRecord(record?: DBMessageRecord | null) {
    if (!record) return record;

    stripTransientRenderState(record.message);
    cachedMessages.set(record.message_id, record.message);
    if (CACHED_MESSAGES_MAX < Infinity && cachedMessages.size > CACHED_MESSAGES_MAX) {
        const first = cachedMessages.keys().next().value;
        if (first !== undefined) cachedMessages.delete(first);
    }
    return record;
}

export async function initIDB() {
    if (db) return;
    db = await openDB<MLIDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            const messageStore = db.createObjectStore("messages", { keyPath: "message_id" });
            messageStore.createIndex("by_channel_id", "channel_id");
            messageStore.createIndex("by_status", "status");
            messageStore.createIndex("by_timestamp", "message.timestamp");
            messageStore.createIndex("by_timestamp_and_message_id", ["channel_id", "message.timestamp"]);
        }
    });
}
initIDB().then(() => migrateDateTimestamps());

export async function hasMessageIDB(message_id: string) {
    return cachedMessages.has(message_id) || (await db.count("messages", message_id)) > 0;
}

export async function countMessagesIDB() {
    return db.count("messages");
}

export async function countMessagesByStatusIDB(status: DBMessageStatus) {
    return db.countFromIndex("messages", "by_status", status);
}

export async function getAllMessagesIDB() {
    return cacheRecords(await db.getAll("messages"));
}

export async function getMessagesForChannelIDB(channel_id: string) {
    return cacheRecords(await db.getAllFromIndex("messages", "by_channel_id", channel_id));
}

export async function getMessageIDB(message_id: string) {
    return cacheRecord(await db.get("messages", message_id));
}

export async function getMessagesByStatusIDB(status: DBMessageStatus) {
    return cacheRecords(await db.getAllFromIndex("messages", "by_status", status));
}

export async function getOldestMessagesIDB(limit: number) {
    return cacheRecords(await db.getAllFromIndex("messages", "by_timestamp", undefined, limit));
}

export async function* iterateAllMessagesIDB(batchSize = 100) {
    let lastId: string | undefined;
    while (true) {
        const batch: DBMessageRecord[] = [];
        // new transaction for each batch to avoid timeouts during yield
        const tx = db.transaction("messages");
        const range = lastId ? IDBKeyRange.lowerBound(lastId, true) : undefined;
        let cursor = await tx.store.openCursor(range);

        while (cursor && batch.length < batchSize) {
            batch.push(cursor.value);
            cursor = await cursor.continue();
        }

        if (batch.length === 0) break;

        lastId = batch[batch.length - 1].message_id;

        yield await cacheRecords(batch);

        if (batch.length < batchSize) break;
    }
}

export async function getOlderThanTimestampIDB(timestamp: string) {
    const tx = db.transaction("messages", "readonly");
    const { store } = tx;
    const index = store.index("by_timestamp");

    const cursor = await index.openCursor(IDBKeyRange.upperBound(timestamp));

    if (!cursor) {
        return [];
    }

    const messages: DBMessageRecord[] = [];
    for await (const c of cursor) {
        messages.push(c.value);
    }

    return cacheRecords(messages);
}

export async function getOlderThanTimestampForGuildsIDB(timestamp: string, currentChannelId?: string, preserveCurrentChannel?: boolean) {
    const allOldMessages = await getOlderThanTimestampIDB(timestamp);
    return allOldMessages.filter(record => {
        const { message } = record;
        const channel = ChannelStore.getChannel(message.channel_id);
        const isGuildMessage = channel?.guild_id != null;
        const isCurrentChannel = preserveCurrentChannel && currentChannelId && message.channel_id === currentChannelId;
        return isGuildMessage && !isCurrentChannel;
    });
}

export async function getDateStortedMessagesByStatusIDB(newest: boolean, limit: number, status: DBMessageStatus) {
    const tx = db.transaction("messages", "readonly");
    const { store } = tx;
    const index = store.index("by_status");

    const direction = newest ? "prev" : "next";
    const cursor = await index.openCursor(IDBKeyRange.only(status), direction);

    if (!cursor) {
        return [];
    }

    const messages: DBMessageRecord[] = [];
    for await (const c of cursor) {
        messages.push(c.value);
        if (messages.length >= limit) break;
    }

    return cacheRecords(messages);
}

export async function getMessagesByChannelAndAfterTimestampIDB(channel_id: string, start: string) {
    const tx = db.transaction("messages", "readonly");
    const { store } = tx;
    const index = store.index("by_timestamp_and_message_id");

    const cursor = await index.openCursor(IDBKeyRange.bound([channel_id, start], [channel_id, "\uffff"]));

    if (!cursor) {
        return [];
    }

    const messages: DBMessageRecord[] = [];
    for await (const c of cursor) {
        messages.push(c.value);
    }

    return cacheRecords(messages);
}

export async function addMessageIDB(message: LoggedMessageJSON, status: DBMessageStatus) {
    try {
        stripTransientRenderState(message);
        const sanitized = sanitizeForIDB(message);
        if (typeof sanitized.timestamp !== "string")
            sanitized.timestamp = (sanitized.timestamp as Date | string) ? new Date(sanitized.timestamp).toISOString() : new Date().toISOString();

        if (!db) await initIDB();
        await db.put("messages", {
            channel_id: sanitized.channel_id,
            message_id: sanitized.id,
            status,
            message: sanitized,
        });

        cachedMessages.set(sanitized.id, sanitized);
    } catch (e) {
        console.error("[MessageLoggerEnhanced] Failed to save message to IDB:", e);
    }
}

export async function addMessagesBulkIDB(messages: LoggedMessageJSON[], status?: DBMessageStatus) {
    try {
        const sanitizedMessages = messages.map(message => {
            stripTransientRenderState(message);
            const sanitized = sanitizeForIDB(message);
            if (typeof sanitized.timestamp !== "string")
                sanitized.timestamp = (sanitized.timestamp as Date | string) ? new Date(sanitized.timestamp).toISOString() : new Date().toISOString();
            return sanitized;
        });

        if (!db) await initIDB();
        const tx = db.transaction("messages", "readwrite");
        const { store } = tx;

        await Promise.all([
            ...sanitizedMessages.map(message => store.put({
                channel_id: message.channel_id,
                message_id: message.id,
                status: status ?? getMessageStatus(message),
                message,
            })),
            tx.done
        ]);

        sanitizedMessages.forEach(message => cachedMessages.set(message.id, message));
    } catch (e) {
        console.error("[MessageLoggerEnhanced] Failed to bulk save messages to IDB:", e);
    }
}

const TIMESTAMP_MIGRATION_KEY = "MessageLoggerEnhanced_timestampMigration";

export async function migrateDateTimestamps() {
    if (!db) await initIDB();
    if (await DataStore.get(TIMESTAMP_MIGRATION_KEY)) return;

    try {
        const keys = await db.getAllKeys("messages");
        let migrated = 0;
        for (let i = 0; i < keys.length; i += 2000) {
            const records = await db.getAll("messages", IDBKeyRange.bound(keys[i], keys[Math.min(i + 1999, keys.length - 1)]));
            for (const record of records) {
                const { timestamp } = record.message;
                if (typeof timestamp !== "string") {
                    record.message.timestamp = (timestamp as Date).toISOString();
                }
                record.message = sanitizeForIDB(record.message);
                await db.put("messages", record);
                migrated++;
            }
        }

        await DataStore.set(TIMESTAMP_MIGRATION_KEY, Date.now());
        if (migrated > 0)
            new Logger("MessageLoggerEnhanced").log(`Migrated ${migrated} records with Date timestamps to ISO strings`);
    } catch (e) {
        console.error("[MessageLoggerEnhanced] Error during timestamp migration:", e);
    }
}

export async function deleteMessageIDB(message_id: string) {
    await db.delete("messages", message_id);

    cachedMessages.delete(message_id);
}

export async function deleteMessagesBulkIDB(message_ids: string[]) {
    const tx = db.transaction("messages", "readwrite");
    const { store } = tx;

    await Promise.all([...message_ids.map(id => store.delete(id)), tx.done]);
    message_ids.forEach(id => cachedMessages.delete(id));
}

export async function clearMessagesIDB(showToast = true) {
    cachedMessages.clear();

    const deleted = await new Promise<boolean>(resolve => {
        db.close();
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
    });

    await initIDB();
    if (!deleted) await clearMessagesChunkedIDB();

    cachedMessages.clear();

    if (!showToast) return;

    Toasts.show({
        type: Toasts.Type.MESSAGE,
        message: "Cleared message log database and cache.",
        id: Toasts.genId()
    });
}

// faster than db.clear on large dbs
async function clearMessagesChunkedIDB() {
    const CLEAR_BATCH_SIZE = 5000;
    while (true) {
        const tx = db.transaction("messages", "readwrite", { durability: "relaxed" });
        const { store } = tx;
        const keys = (await store.getAllKeys(undefined, CLEAR_BATCH_SIZE)) as string[];
        if (keys.length === 0) {
            await tx.done;
            break;
        }

        const range = IDBKeyRange.bound(keys[0], keys[keys.length - 1]);
        await Promise.all([store.delete(range), tx.done]);
    }
}
