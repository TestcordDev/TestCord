/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CACHED_MESSAGES_MAX } from "@utils/cacheLimits";
import { findByCodeLazy, findLazy } from "@webpack";
import { moment, UserStore } from "@webpack/common";

import { LoggedMessage } from "./types";

const MessageClass: any = findLazy(m => m?.prototype?.isEdited);
const AuthorClass: any = findLazy(m => m?.prototype?.getAvatarURL);
const sanitizeEmbed = findByCodeLazy('"embed_"),');

export const DISCORD_EPOCH = 14200704e5;

function getTimestamp(timestamp: any, id?: string): Date {
    if (timestamp) return new Date(timestamp);
    // Records restored from partial payloads can lack a timestamp; new Date(undefined)
    // crashes Discord's chat layer, so fall back to the snowflake time.
    if (id) return new Date(Number(BigInt(id) >> 22n) + DISCORD_EPOCH);
    return new Date();
}

export const mapTimestamp = (m: any) => {
    if (m.timestamp) m.timestamp = getTimestamp(m.timestamp, m.id);
    if (m.editedTimestamp) m.editedTimestamp = getTimestamp(m.editedTimestamp, m.id);
    if (m.embeds) m.embeds = m.embeds.map((e: any) => sanitizeEmbed(m.channel_id, m.id, e));
    return m;
};

const messageClassCache = new Map<string, any>();

export function clearMessageClassCache() {
    messageClassCache.clear();
}

export function invalidateMessageClassCache(id: string) {
    messageClassCache.delete(id);
}

export function messageJsonToMessageClass(log: { message: LoggedMessage; }) {
    if (!log?.message) return null;

    const { id } = log.message;
    const cached = messageClassCache.get(id);
    if (cached) return cached;

    const message: any = new MessageClass(log.message);
    message.timestamp = getTimestamp(message.timestamp, message.id);

    const editHistory = message.editHistory?.map(mapTimestamp);
    if (editHistory && editHistory.length > 0) {
        message.editHistory = editHistory;
    }
    if (message.editedTimestamp)
        message.editedTimestamp = getTimestamp(message.editedTimestamp, message.id);

    if (message.firstEditTimestamp)
        message.firstEditTimestamp = getTimestamp(message.firstEditTimestamp, message.id);

    message.author = UserStore.getUser(message.author.id) ?? new AuthorClass(message.author);
    message.author.nick = message.author.globalName ?? message.author.username;

    message.embeds = message.embeds.map((e: any) => sanitizeEmbed(message.channel_id, message.id, e));

    if (message.poll)
        message.poll.expiry = moment(message.poll.expiry);

    if (message.messageSnapshots)
        message.messageSnapshots.map((m: any) => mapTimestamp(m.message));

    if (messageClassCache.size >= CACHED_MESSAGES_MAX) {
        const first = messageClassCache.keys().next().value;
        if (first !== undefined) messageClassCache.delete(first);
    }
    messageClassCache.set(id, message);
    return message;
}

// https://github.com/1Lighty/BetterDiscordPlugins/blob/master/Plugins/MessageLoggerV2/MessageLoggerV2.plugin.js
export function reAddDeletedMessages(messages: LoggedMessage[], deletedMessages: LoggedMessage[], channelStart: boolean, channelEnd: boolean) {
    if (!messages.length || !deletedMessages?.length) return;

    const IDs: { id: string; time: number; }[] = [];
    const savedIDs: { id: string; time: number; message: LoggedMessage; }[] = [];

    for (let i = 0; i < messages.length; i++) {
        const { id } = messages[i] || {};
        if (!id) continue;
        const parsedId = parseInt(id);
        if (isNaN(parsedId)) continue;
        IDs.push({ id, time: (parsedId / 4194304) + DISCORD_EPOCH });
    }
    for (let i = 0; i < deletedMessages.length; i++) {
        const record = deletedMessages[i];
        if (!record || !record.id) continue;
        const parsedId = parseInt(record.id);
        if (isNaN(parsedId)) continue;
        savedIDs.push({ id: record.id, time: (parsedId / 4194304) + DISCORD_EPOCH, message: record });
    }

    if (!IDs.length || !savedIDs.length) return;
    savedIDs.sort((a, b) => a.time - b.time);
    const lowestTime = IDs[IDs.length - 1].time;
    const highestTime = IDs[0].time;
    const lowestIDX = channelEnd ? 0 : savedIDs.findIndex(e => e.time > lowestTime);
    if (lowestIDX === -1) return;
    const highestIDX = channelStart ? savedIDs.length - 1 : findLastIndex(savedIDs, e => e.time < highestTime);
    if (highestIDX === -1) return;

    const existingIds = new Set<string>();
    for (let i = 0; i < messages.length; i++) {
        const mid = messages[i]?.id;
        if (mid) existingIds.add(mid);
    }

    const toInsert: LoggedMessage[] = [];
    for (let i = lowestIDX; i <= highestIDX; i++) {
        const entry = savedIDs[i];
        if (entry?.message && !existingIds.has(entry.id)) {
            toInsert.push(entry.message);
        }
    }
    if (!toInsert.length) return;

    const combined = messages.concat(toInsert);
    combined.sort((a, b) => {
        const ta = a?.id ? (parseInt(a.id) / 4194304 + DISCORD_EPOCH) : 0;
        const tb = b?.id ? (parseInt(b.id) / 4194304 + DISCORD_EPOCH) : 0;
        return tb - ta;
    });

    messages.length = 0;
    for (let i = 0; i < combined.length; i++) {
        messages.push(combined[i]);
    }
}

function findLastIndex<T>(array: T[], predicate: (e: T) => boolean) {
    let l = array.length;
    while (l--) {
        if (predicate(array[l]))
            return l;
    }
    return -1;
}
