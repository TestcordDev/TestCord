/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import type { Message, MessageJSON } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, lodash, MessageStore, SelectedChannelStore, UserGuildSettingsStore, UserStore } from "@webpack/common";

import { applyBatch, clearLogs, clearUnprotectedLogs, getAllLogs, getDatabase, runMaintenance, setLogHidden } from "./db";
import { invalidateMessageClassCache } from "./render";
import { ensureAttachmentSaved } from "./saveImage";
import { settings } from "./settings";
import { LoggedMessage, LogRecord, LogStatus, MessageCreatePayload, MessageDeleteBulkPayload, MessageDeletePayload, MessageUpdatePayload } from "./types";

const log = new Logger("MessageLoggerTestcord");
const recentMessages = new Map<string, LoggedMessage>();
const pendingWrites = new Map<string, LogRecord>();
const pendingDeletes = new Set<string>();
const STATUS_PRIORITY: Record<LogStatus, number> = {
    [LogStatus.EDITED]: 0,
    [LogStatus.DELETED]: 1,
    [LogStatus.GHOST_PINGED]: 2
};
const EPHEMERAL = 64;

let flushTimer: ReturnType<typeof setTimeout> | undefined;
let maintenanceInterval: ReturnType<typeof setInterval> | undefined;
let flushChain = Promise.resolve();
let active = false;
let lastMaintenance = 0;
let maintenanceRunning = false;

interface MessageWithToJS {
    toJS(): MessageJSON;
}

function hasToJS(message: Message | MessageJSON): message is Message & MessageWithToJS {
    return "toJS" in message && typeof message.toJS === "function";
}

function snapshotMessage(message: Message | MessageJSON): LoggedMessage {
    const raw = hasToJS(message) ? message.toJS() : message;
    const copy = lodash.cloneDeep(raw) as LoggedMessage;
    const { timestamp } = copy;

    copy.timestamp = new Date(String(timestamp)).toISOString();
    copy.attachments ??= [];
    copy.embeds ??= [];
    copy.mentions ??= [];
    copy.editHistory ??= [];
    if (copy.author) {
        delete copy.author.email;
        delete copy.author.phone;
    }
    delete copy.customRenderedContent;
    delete copy.__messageloggerDiff;
    delete copy.__messageloggerDiffKey;
    delete copy.__messageloggerAggregated;
    delete copy.__messageloggerLastAppliedKey;
    return copy;
}

function remember(message: LoggedMessage) {
    while (!recentMessages.has(message.id) && recentMessages.size >= settings.store.memoryCacheLimit) {
        const oldestId = recentMessages.keys().next().value;
        if (!oldestId) break;
        recentMessages.delete(oldestId);
    }

    recentMessages.delete(message.id);
    recentMessages.set(message.id, message);
}

export function getCachedLoggedMessage(id: string) {
    return recentMessages.get(id);
}

// ── Render caches shared with the MessageStore override in index.tsx ──

export const mergedMessageCache = new Map<string, LoggedMessage>();
export const mergedEditTimestamps = new Map<string, number>();

export function invalidateLoggedCaches(id: string) {
    invalidateMessageClassCache(id);
    mergedMessageCache.delete(id);
    mergedEditTimestamps.delete(id);
}

// ── Anti-antilog: block the nonce dedupe exploit so deletions stay visible ──

function stripAntilogNonce(payload: MessageCreatePayload) {
    const raw = payload.message as any;
    const nonce = raw?.nonce;
    if (!nonce || raw.id === nonce) return;

    const existing = MessageStore.getMessage(payload.channelId ?? raw.channel_id, nonce);
    if (existing) {
        // A message with this nonce already exists: this payload is a dedupe trick.
        // Strip the nonce so the follow-up delete cannot be swallowed.
        delete raw.nonce;
        log.info(`Blocked antilog nonce dedupe in ${payload.channelId} (${raw.id} reused nonce ${nonce}).`);
    }
}

function hasCurrentUserMention(message: LoggedMessage) {
    const currentUserId = UserStore.getCurrentUser().id;
    return message.mention_everyone || message.mentions.some(mention => mention.id === currentUserId);
}

function splitIds(raw: string): string[] {
    return (raw ?? "").split(",").map(s => s.trim()).filter(Boolean);
}

export function shouldIgnore({ channelId, authorId, guildId, flags, bot, ghostPinged, webhookId }: {
    channelId?: string;
    authorId?: string;
    guildId?: string;
    flags?: number;
    bot?: boolean;
    ghostPinged?: boolean;
    webhookId?: string | null;
}): boolean {
    if (((flags ?? 0) & EPHEMERAL) === EPHEMERAL) return true;

    if (channelId && guildId == null)
        guildId = ChannelStore.getChannel(channelId)?.guild_id;

    const whitelist = splitIds(settings.store.whitelistedIds);
    const blacklist = [
        ...splitIds(settings.store.blacklistedIds),
        ...splitIds((globalThis as any).Vencord?.Settings?.plugins?.MessageLogger?.ignoreUsers ?? ""),
        ...splitIds((globalThis as any).Vencord?.Settings?.plugins?.MessageLogger?.ignoreChannels ?? ""),
        ...splitIds((globalThis as any).Vencord?.Settings?.plugins?.MessageLogger?.ignoreGuilds ?? "")
    ];

    const isDm = channelId != null && ChannelStore.getChannel(channelId)?.isDM?.();
    if (settings.store.alwaysLogDirectMessages && isDm && !blacklist.includes(authorId!) && !blacklist.includes(channelId!)) return false;

    const ids = [authorId, channelId, guildId];
    const isAuthorWhitelisted = whitelist.includes(authorId!);

    if (isAuthorWhitelisted) return false;
    if ((settings.store.ignoreBots && bot || settings.store.ignoreWebhooks && webhookId != null
        || settings.store.ignoreSelf && authorId === UserStore.getCurrentUser()?.id) && !isAuthorWhitelisted) return true;
    if (ghostPinged) return false;
    if (blacklist.some(id => id != null && ids.includes(id))) return true;
    if (settings.store.alwaysLogCurrentChannel && SelectedChannelStore.getChannelId() === channelId) return false;
    if (!settings.store.cacheMessagesFromServers && guildId != null && !isDm
        && !splitIds(settings.store.whitelistedIds).some(id => id != null && ids.includes(id))) return true;
    if (guildId != null && settings.store.ignoreMutedGuilds && UserGuildSettingsStore.isMuted(guildId)) return true;
    if (channelId != null && guildId != null && settings.store.ignoreMutedCategories && UserGuildSettingsStore.isCategoryMuted(guildId, channelId)) return true;
    if (channelId != null && guildId != null && settings.store.ignoreMutedChannels && UserGuildSettingsStore.isChannelMuted(guildId, channelId)) return true;

    return false;
}

function scheduleFlush() {
    if (flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
        flushTimer = undefined;
        void flushQueuedLogs();
    }, settings.store.batchDelayMs);
}

function queueRecord(message: LoggedMessage, status: LogStatus) {
    const pending = pendingWrites.get(message.id);
    const finalStatus = pending && STATUS_PRIORITY[pending.status] > STATUS_PRIORITY[status]
        ? pending.status
        : status;
    const pendingHistory = pending?.message.editHistory ?? [];
    const messageHistory = message.editHistory ?? [];
    if (pendingHistory.length > messageHistory.length) message.editHistory = pendingHistory;

    pendingDeletes.delete(message.id);
    pendingWrites.set(message.id, {
        message_id: message.id,
        channel_id: message.channel_id,
        status: finalStatus,
        message,
        protected: pending?.protected
    });
    scheduleFlush();
}

function queueDelete(id: string) {
    pendingWrites.delete(id);
    pendingDeletes.add(id);
    recentMessages.delete(id);
    scheduleFlush();
}

export function flushQueuedLogs() {
    if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
    }

    const records = [...pendingWrites.values()];
    const deletedIds = [...pendingDeletes];
    pendingWrites.clear();
    pendingDeletes.clear();

    flushChain = flushChain
        .then(() => applyBatch(records, deletedIds))
        .catch(error => log.error("Failed to flush queued logs.", error));
    return flushChain;
}

async function performMaintenance() {
    if (maintenanceRunning) return;
    maintenanceRunning = true;
    try {
        await flushQueuedLogs();
        const preservedChannelId = settings.store.preserveCurrentChannel
            ? SelectedChannelStore.getChannelId()
            : undefined;
        await runMaintenance(settings.store.messageLimit, settings.store.retentionDays, preservedChannelId);
        lastMaintenance = Date.now();
    } finally {
        maintenanceRunning = false;
    }
}

function isCacheGated(payload: MessageCreatePayload) {
    if (settings.store.cacheMessagesFromServers) return false;

    const set = splitIds(settings.store.whitelistedIds);
    if (set.length === 0) return true;
    return !(set.includes(payload.channelId) || set.includes(payload.message.author?.id) || set.includes(payload.guildId!));
}

export function handleMessageCreate(payload: MessageCreatePayload) {
    if (!active) return;

    const message = payload.message as any;
    if (!message?.id || !message?.channel_id) return;
    if (settings.store.blockAntilogNonce) stripAntilogNonce(payload);
    if (isCacheGated(payload)) return;

    const snapshot = snapshotMessage(payload.message);
    snapshot.guildId = payload.guildId;
    snapshot.ourCache = true;
    if (shouldIgnore({
        channelId: snapshot.channel_id,
        authorId: snapshot.author?.id,
        guildId: payload.guildId,
        flags: snapshot.flags,
        bot: snapshot.bot || snapshot.author?.bot,
        webhookId: snapshot.webhookId
    })) return;

    remember(snapshot);
}

export function handleMessageUpdate(payload: MessageUpdatePayload) {
    if (!active || !settings.store.saveEdits || payload.message.content == null) return;

    const storedMessage = MessageStore.getMessage(payload.message.channel_id, payload.message.id);
    const previous = recentMessages.get(payload.message.id) ?? (storedMessage ? snapshotMessage(storedMessage) : undefined);
    if (!previous) return;
    if (previous.content === payload.message.content) {
        if (previous.editHistory?.length && !shouldIgnore({
            channelId: previous.channel_id,
            authorId: previous.author?.id,
            guildId: payload.guildId ?? previous.guildId,
            flags: previous.flags,
            bot: previous.bot || previous.author?.bot,
            webhookId: previous.webhookId
        })) {
            remember(previous);
            queueRecord(previous, LogStatus.EDITED);
        }
        return;
    }

    const message = lodash.cloneDeep(previous);
    Object.assign(message, payload.message);
    message.guildId = payload.guildId ?? previous.guildId;
    message.editHistory = [
        ...(previous.editHistory ?? []),
        {
            content: previous.content,
            timestamp: new Date().toISOString()
        }
    ];
    if (settings.store.maxEditHistory > 0) {
        message.editHistory = message.editHistory.slice(-settings.store.maxEditHistory);
    }

    remember(message);
    if (!shouldIgnore({
        channelId: message.channel_id,
        authorId: message.author?.id,
        guildId: message.guildId,
        flags: message.flags,
        bot: message.bot || message.author?.bot,
        webhookId: message.webhookId
    })) queueRecord(message, LogStatus.EDITED);
}

function saveDeletedMessage(payload: MessageDeletePayload) {
    const storedMessage = MessageStore.getMessage(payload.channelId, payload.id);
    const cachedMessage = recentMessages.get(payload.id);
    if (!cachedMessage && !storedMessage) return;

    const message = snapshotMessage((cachedMessage ?? storedMessage!) as unknown as MessageJSON);
    message.guildId = payload.guildId ?? message.guildId;
    message.deleted = true;
    message.deletedTimestamp = new Date().toISOString();
    message.attachments = message.attachments.map(attachment => ({ ...attachment, deleted: true }));
    if (settings.store.saveImages && !IS_WEB) {
        // Fire and forget: paths land on the record whenever the download settles
        void Promise.all(message.attachments.map(att => ensureAttachmentSaved(att))).catch(() => { });
    }
    const ghostPinged = hasCurrentUserMention(message);
    message.ghostPinged = ghostPinged;

    // Ignored messages are dropped from the render cache entirely; logged ones stay
    // cached so they keep rendering inline and the context menu can act on them.
    if (shouldIgnore({
        channelId: message.channel_id,
        authorId: message.author?.id,
        guildId: message.guildId,
        flags: message.flags,
        bot: message.bot || message.author?.bot,
        ghostPinged,
        webhookId: message.webhookId
    })) {
        recentMessages.delete(payload.id);
        return;
    }

    if (ghostPinged && settings.store.saveGhostPings) {
        queueRecord(message, LogStatus.GHOST_PINGED);
        if (settings.store.notifyGhostPings) {
            const authorName = message.author.global_name ?? message.author.globalName ?? message.author.username;
            showNotification({
                title: "MessageLoggerTestcord",
                body: `Captured a ghost ping from ${authorName}.`
            });
        }
    }
    else if (settings.store.saveDeletes) queueRecord(message, LogStatus.DELETED);
}

export function handleMessageDelete(payload: MessageDeletePayload) {
    if (!active) return;
    // mlDeleted = a locally-initiated hide (our context menu). The record itself is
    // managed explicitly by Delete (Temporary)/(Forever), nothing to do here.
    if (payload.mlDeleted) return;
    saveDeletedMessage(payload);
}

export function handleMessageDeleteBulk(payload: MessageDeleteBulkPayload) {
    if (!active) return;

    for (const id of payload.ids) {
        if (!payload.mlDeleted) saveDeletedMessage({ ...payload, id });
    }
}

export async function deleteLog(id: string) {
    queueDelete(id);
    await flushQueuedLogs();
}

/**
 * Hide a logged message locally (dispatches an mlDeleted delete so chat drops it).
 * Temporary keeps the record in the database but flags it hidden so it never
 * renders again; Forever deletes the record outright.
 */
export async function localRemoveLoggedMessage(id: string, permanent: boolean): Promise<string | null> {
    const cached = recentMessages.get(id);
    const channelId = cached?.channel_id ?? "";

    recentMessages.delete(id);

    if (permanent) await deleteLog(id);
    else {
        pendingDeletes.delete(id);
        await setLogHidden(id, true);
        void flushQueuedLogs();
    }

    if (channelId) {
        FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            channelId,
            id,
            mlDeleted: true
        });
    }
    return channelId || null;
}

export async function deleteManyLogs(ids: string[]) {
    ids.forEach(queueDelete);
    await flushQueuedLogs();
}

export async function clearAllLogs(includeProtected = false) {
    if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
    }
    pendingWrites.clear();
    pendingDeletes.clear();
    await flushChain;
    if (includeProtected) await clearLogs();
    else await clearUnprotectedLogs();
}

export async function runMaintenanceNow() {
    await performMaintenance();
}

/**
 * Load the most recent logged messages from the database into memory so deleted
 * and edited messages keep rendering inline after a restart, not only for
 * messages captured this session.
 */
async function primeLoggedCache() {
    try {
        const records = await getAllLogs();
        const cap = Math.max(settings.store.memoryCacheLimit, 100);
        const recent = records
            .sort((a, b) => String(b.message.timestamp).localeCompare(String(a.message.timestamp)))
            .slice(0, cap);

        // Insert oldest-first so the hottest (newest) entries end up last in eviction order
        for (const record of recent.reverse()) {
            if (!record.message?.id || record.hidden) continue;
            if (recentMessages.has(record.message.id)) continue;
            recentMessages.set(record.message.id, record.message);
        }

        if (recent.length > 0) log.info(`Primed logged message cache with ${recent.length} records.`);
    } catch (error) {
        log.error("Failed to prime the logged message cache.", error);
    }
}

export function startEngine() {
    active = true;
    void getDatabase()
        .then(performMaintenance)
        .then(primeLoggedCache)
        .catch(error => log.error("Failed to initialize the log database.", error));
    maintenanceInterval = setInterval(() => {
        if (Date.now() - lastMaintenance >= settings.store.maintenanceIntervalMinutes * 60_000) {
            void performMaintenance().catch(error => log.error("Failed to run log maintenance.", error));
        }
    }, 60_000);
}

export function stopEngine() {
    active = false;
    if (maintenanceInterval !== undefined) {
        clearInterval(maintenanceInterval);
        maintenanceInterval = undefined;
    }
    recentMessages.clear();
    void flushQueuedLogs();
}
