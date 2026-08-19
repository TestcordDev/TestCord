/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { CACHED_MESSAGES_MAX } from "@utils/cacheLimits";
import { findByCodeLazy, findLazy } from "@webpack";
import { ChannelStore, moment, UserStore } from "@webpack/common";
import { DBMessageStatus } from "../db";
import { DEFAULT_ATTACHMENT_FILE_EXTENSIONS, DEFAULT_IMAGE_CACHE_DIR } from "./constants";
import { DISCORD_EPOCH } from "./index";
const MessageClass = findLazy(m => m?.prototype?.isEdited);
const AuthorClass = findLazy(m => m?.prototype?.getAvatarURL);
const sanitizeEmbed = findByCodeLazy('"embed_"),');
export function getGuildIdByChannel(channel_id) {
    return ChannelStore.getChannel(channel_id)?.guild_id;
}
export const isGhostPinged = (message) => {
    return message?.ghostPinged || message?.deleted && hasPingged(message);
};
export const hasPingged = (message) => {
    return message && !!(message.mention_everyone ||
        message.mentions?.find(m => (typeof m === "string" ? m : m.id) === UserStore.getCurrentUser().id));
};
export const getMessageStatus = (message) => {
    if (isGhostPinged(message))
        return DBMessageStatus.GHOST_PINGED;
    if (message.deleted)
        return DBMessageStatus.DELETED;
    if (message.editHistory?.length)
        return DBMessageStatus.EDITED;
    throw new Error("Unknown message status");
};
export const discordIdToDate = (id) => new Date((parseInt(id) / 4194304) + DISCORD_EPOCH);
export const sortMessagesByDate = (timestampA, timestampB) => {
    // very expensive
    // const timestampA = discordIdToDate(a).getTime();
    // const timestampB = discordIdToDate(b).getTime();
    // return timestampB - timestampA;
    // newest first
    if (timestampA < timestampB) {
        return 1;
    }
    else if (timestampA > timestampB) {
        return -1;
    }
    else {
        return 0;
    }
};
// stolen from mlv2
export function findLastIndex(array, predicate) {
    let l = array.length;
    while (l--) {
        if (predicate(array[l], l, array))
            return l;
    }
    return -1;
}
const getTimestamp = (timestamp, id) => {
    if (timestamp)
        return new Date(timestamp);
    // Records from before the timestamp column existed, or restored from partial
    // payloads, can lack a timestamp. new Date(undefined) yields an Invalid Date
    // that crashes Discord's chat layer (Intl throws "Invalid time value") when
    // the message is re-added to the store, so fall back to the snowflake time.
    if (id)
        return new Date(Number(BigInt(id) >> 22n) + DISCORD_EPOCH);
    return new Date();
};
export const mapTimestamp = (m) => {
    if (m.timestamp)
        m.timestamp = getTimestamp(m.timestamp, m.id);
    if (m.editedTimestamp)
        m.editedTimestamp = getTimestamp(m.editedTimestamp, m.id);
    if (m.embeds)
        m.embeds = m.embeds.map(e => sanitizeEmbed(m.channel_id, m.id, e));
    return m;
};
const messageClassCache = new Map();
export function clearMessageClassCache() {
    messageClassCache.clear();
}
export function invalidateMessageClassCache(id) {
    messageClassCache.delete(id);
}
export function messageJsonToMessageClass(log) {
    if (!log?.message)
        return null;
    const { id } = log.message;
    const cached = messageClassCache.get(id);
    if (cached)
        return cached;
    const message = new MessageClass(log.message);
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
    message.embeds = message.embeds.map(e => sanitizeEmbed(message.channel_id, message.id, e));
    if (message.poll)
        message.poll.expiry = moment(message.poll.expiry);
    if (message.messageSnapshots)
        message.messageSnapshots.map(m => mapTimestamp(m.message));
    // db.ts evicts from cachedMessages without touching this map, so it used to outgrow the
    // 5000-entry cap it mirrors and keep every rendered message alive for the session.
    if (messageClassCache.size >= CACHED_MESSAGES_MAX) {
        messageClassCache.delete(messageClassCache.keys().next().value);
    }
    messageClassCache.set(id, message);
    return message;
}
export function parseJSON(json) {
    try {
        return JSON.parse(json);
    }
    finally {
        return null;
    }
}
export async function doesBlobUrlExist(url) {
    const res = await fetch(url);
    return res.ok;
}
export function getNative() {
    if (IS_WEB) {
        const Native = {
            writeLogs: async () => { },
            getDefaultNativeImageDir: async () => DEFAULT_IMAGE_CACHE_DIR,
            getDefaultNativeDataDir: async () => "",
            getDefaultAttachmentFileExtensions: async () => DEFAULT_ATTACHMENT_FILE_EXTENSIONS,
            updateAllowedExtensions: async () => { },
            deleteFileNative: async () => { },
            chooseDir: async (x) => "",
            getSettings: async () => ({ imageCacheDir: DEFAULT_IMAGE_CACHE_DIR, logsDir: "", attachmentFileExtensions: DEFAULT_ATTACHMENT_FILE_EXTENSIONS }),
            init: async () => { },
            initDirs: async () => { },
            getImageNative: async (x) => new Uint8Array(0),
            getNativeSavedImages: async () => new Map(),
            messageLoggerEnhancedUniqueIdThingyIdkMan: async () => { },
            showItemInFolder: async () => { },
            writeImageNative: async () => { },
            chooseFile: async () => "",
            downloadAttachment: async () => ({ error: "web", path: null }),
            startNativeLogExport: async () => "",
            finishNativeLogExport: async () => { },
            writeNativeLogChunk: async () => { },
            startNativeLogImport: async () => "",
            readNativeLogChunk: async () => null,
            closeNativeLogImport: async () => { }
        };
        return Native;
    }
    return Object.values(VencordNative.pluginHelpers)
        .find(m => m.messageLoggerEnhancedUniqueIdThingyIdkMan);
}
