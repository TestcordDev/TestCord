/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { isObject } from "@utils/misc";
import { chooseFile, saveFile } from "@utils/web";
import { openDB } from "idb";

import { clearUnprotectedLogs, getAllLogs, getDatabase, importLogRecords } from "./db";
import { settings } from "./settings";
import { LogExport, LoggedMessage, LogRecord, LogStatus } from "./types";

const log = new Logger("MessageLoggerTestcord");
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

function isStatus(value: unknown): value is LogStatus {
    return value === LogStatus.DELETED || value === LogStatus.EDITED || value === LogStatus.GHOST_PINGED;
}

function inferStatus(message: LoggedMessage): LogStatus | undefined {
    if (message.ghostPinged) return LogStatus.GHOST_PINGED;
    if (message.deleted) return LogStatus.DELETED;
    if (message.editHistory?.length) return LogStatus.EDITED;
}

function normalizeRecord(value: unknown): LogRecord | undefined {
    if (!isObject(value) || !("message" in value) || !isObject(value.message)) return;

    const { message } = value;
    if (!("id" in message) || typeof message.id !== "string"
        || !("channel_id" in message) || typeof message.channel_id !== "string"
        || !("timestamp" in message) || typeof message.timestamp !== "string" || Number.isNaN(Date.parse(message.timestamp))
        || !("author" in message) || !isObject(message.author)
        || !("id" in message.author) || typeof message.author.id !== "string") return;

    const { author } = message;
    const normalizedMessage = {
        ...message,
        author: {
            ...author,
            username: "username" in author && typeof author.username === "string" ? author.username : "Unknown User"
        },
        content: "content" in message && typeof message.content === "string" ? message.content : "",
        attachments: "attachments" in message && Array.isArray(message.attachments) ? message.attachments : [],
        embeds: "embeds" in message && Array.isArray(message.embeds) ? message.embeds : [],
        mentions: "mentions" in message && Array.isArray(message.mentions) ? message.mentions : [],
        editHistory: "editHistory" in message && Array.isArray(message.editHistory) ? message.editHistory : []
    } as LoggedMessage;
    const status = "status" in value && isStatus(value.status) ? value.status : inferStatus(normalizedMessage);
    if (!status) return;

    return {
        message_id: normalizedMessage.id,
        channel_id: normalizedMessage.channel_id,
        status,
        message: normalizedMessage,
        protected: "protected" in value && value.protected === true ? true : undefined,
        createdAt: "createdAt" in value && typeof value.createdAt === "string" ? value.createdAt : undefined,
        updatedAt: "updatedAt" in value && typeof value.updatedAt === "string" ? value.updatedAt : undefined
    };
}

function collectRecords(value: unknown, output: LogRecord[], depth = 0) {
    if (depth > 3) return;
    if (Array.isArray(value)) {
        value.forEach(item => collectRecords(item, output, depth + 1));
        return;
    }

    const record = normalizeRecord(value);
    if (record) {
        output.push(record);
        return;
    }

    if (isObject(value) && "messages" in value) collectRecords(value.messages, output, depth + 1);
}

export async function exportLogs() {
    const messages = await getAllLogs();
    exportLogRecords(messages, "message-logger-testcord");
    return messages.length;
}

export function exportLogRecords(messages: LogRecord[], prefix: string) {
    const data: LogExport = {
        format: "MessageLoggerTestcord",
        version: 1,
        exportedAt: new Date().toISOString(),
        messages
    };
    const filename = `${prefix}-${data.exportedAt.slice(0, 10)}.json`;
    saveFile(new File([JSON.stringify(data)], filename, { type: "application/json" }));
}

export async function importLogs() {
    const file = await chooseFile("application/json,.json");
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) throw new Error("The selected backup is larger than 100 MB.");

    const parsed: unknown = JSON.parse(await file.text());
    const records: LogRecord[] = [];
    collectRecords(parsed, records);
    if (records.length === 0) throw new Error("The selected file contains no compatible message logs.");

    const uniqueRecords = [...new Map(records.map(record => [record.message_id, record])).values()];
    if (settings.store.replaceOnImport) await clearUnprotectedLogs();
    await importLogRecords(uniqueRecords);
    return uniqueRecords.length;
}

// Pull every record out of MessageLoggerEnhanced's IDB database and convert them.
export async function importMleLogs() {
    const mleDb = await openDB("MessageLoggerIDB", 1, {
        upgrade(database) {
            const store = database.createObjectStore("messages", { keyPath: "message_id" });
            store.createIndex("by_channel_id", "channel_id");
            store.createIndex("by_status", "status");
            store.createIndex("by_timestamp", "message.timestamp");
        }
    });

    let rawRecords: LogRecord[];
    try {
        rawRecords = await mleDb.getAll("messages");
    } finally {
        mleDb.close();
    }

    const records = rawRecords
        .map(raw => normalizeRecord(raw))
        .filter((record): record is LogRecord => record != null);

    if (records.length === 0) throw new Error("MessageLoggerEnhanced has no saved messages to import.");

    await getDatabase();
    await importLogRecords(records);
    return records.length;
}

const MLE_SETTINGS_MAP: Record<string, string[]> = {
    saveDeletes: ["saveMessages"],
    saveEdits: ["saveMessages"],
    notifyGhostPings: [],
    cacheMessagesFromServers: ["cacheMessagesFromServers"],
    alwaysLogDirectMessages: ["alwaysLogDirectMessages"],
    alwaysLogCurrentChannel: ["alwaysLogCurrentChannel"],
    ignoreBots: ["ignoreBots"],
    ignoreWebhooks: ["ignoreWebhooks"],
    ignoreSelf: ["ignoreSelf"],
    ignoreMutedGuilds: ["ignoreMutedGuilds"],
    ignoreMutedCategories: ["ignoreMutedCategories"],
    ignoreMutedChannels: ["ignoreMutedChannels"],
    whitelistedIds: ["whitelistedIds"],
    blacklistedIds: ["blacklistedIds"],
    sortNewest: ["sortNewest"],
    pageSize: ["messagesToDisplayAtOnceInLogs"],
    preserveCurrentChannel: ["preserveCurrentChannel"],
    showLogsButton: ["ShowLogsButton"],
    messageLimit: ["messageLimit"]
};

export function importMleSettings(): number {
    const mleSettings = (globalThis as any).Vencord?.Settings?.plugins?.MessageLoggerEnhanced;
    if (!mleSettings || typeof mleSettings !== "object") {
        throw new Error("MessageLoggerEnhanced has no settings to import.");
    }

    let imported = 0;
    for (const [ownKey, sourceKeys] of Object.entries(MLE_SETTINGS_MAP)) {
        for (const sourceKey of sourceKeys) {
            if (sourceKey in mleSettings && mleSettings[sourceKey] != null) {
                (settings.store as any)[ownKey] = mleSettings[sourceKey];
                imported++;
                break;
            }
        }
    }

    if ("saveGhostPings" in mleSettings && mleSettings.saveGhostPings != null) {
        settings.store.saveGhostPings = true;
    }
    log.info(`Imported ${imported} settings from MessageLoggerEnhanced`);
    return imported;
}
