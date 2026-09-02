/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import type { Message, MessageJSON } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, lodash, MessageStore, SelectedChannelStore, UserGuildSettingsStore, UserStore } from "@webpack/common";

import { applyBatch, clearLogs, clearUnprotectedLogs, getAllLogs, getDatabase, getLogById, runMaintenance, setLogHidden } from "./db";
import { invalidateMessageClassCache } from "./render";
import { ensureAttachmentSaved, ensureDefaultDir } from "./saveImage";
import { settings } from "./settings";
import { LoggedMessage, LogRecord, LogStatus, MessageCreatePayload, MessageDeleteBulkPayload, MessageDeletePayload, MessageUpdatePayload } from "./types";

const log = new Logger("MessageLoggerTestcord");
const recentMessages = new Map<string, LoggedMessage>();
const channelMessageCache = new Map<string, LoggedMessage>();
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
    const rawAny = raw as any;
    const copyAny = copy as any;
    const { timestamp } = copy;

    copy.timestamp = new Date(String(timestamp)).toISOString();
    copy.attachments ??= [];
    copy.embeds ??= [];
    copy.mentions ??= [];
    copy.editHistory ??= [];
    // Normalize snake_case vs camelCase fields Discord may emit in different payloads
    copyAny.webhookId = copyAny.webhookId ?? rawAny.webhook_id ?? copyAny.webhook_id ?? null;
    copyAny.webhook_id = copyAny.webhookId;
    copyAny.guildId = copyAny.guildId ?? rawAny.guild_id ?? rawAny.guildId ?? copyAny.guild_id;
    copyAny.guild_id = copyAny.guildId;
    copyAny.channel_id = copyAny.channel_id ?? rawAny.channel_id ?? rawAny.channelId ?? copyAny.channelId;
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
    // Keep channel cache in sync for per-channel DB fallback (supports reduced global cache)
    if ((message as any).channel_id) {
        channelMessageCache.set(message.id, message);
        while (channelMessageCache.size > 5000) {
            const first = channelMessageCache.keys().next().value;
            if (!first) break;
            channelMessageCache.delete(first);
        }
    }
}

export function getCachedLoggedMessage(id: string) {
    return recentMessages.get(id) ?? channelMessageCache.get(id);
}

export function cacheChannelMessages(records: LogRecord[]) {
    for (const rec of records) {
        if (rec.hidden) continue;
        if (rec.message?.id) channelMessageCache.set(rec.message.id, rec.message);
    }
    while (channelMessageCache.size > 5000) {
        const first = channelMessageCache.keys().next().value;
        if (!first) break;
        channelMessageCache.delete(first);
    }
}

export function clearChannelCache(channelId?: string) {
    if (channelId) {
        for (const [id, msg] of [...channelMessageCache.entries()]) {
            if ((msg as any).channel_id === channelId) channelMessageCache.delete(id);
        }
    } else {
        channelMessageCache.clear();
    }
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
        protected: pending?.protected,
        hidden: pending?.hidden
    });
    scheduleFlush();
}

function queueDelete(id: string) {
    pendingWrites.delete(id);
    pendingDeletes.add(id);
    recentMessages.delete(id);
    channelMessageCache.delete(id);
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

    // DMs and pending/application channels should still be cached even when server cache is disabled.
    const ch = payload.channelId != null ? ChannelStore.getChannel(payload.channelId) : null;
    if (settings.store.alwaysLogDirectMessages) {
        const isDm = ch?.isDM?.();
        if (isDm) return false;
        if (payload.guildId == null && ch == null) {
            // Unknown channel but likely DM; let shouldIgnore decide, don't gate it here.
        }
    }
    if (ch) {
        const name = (ch as any).name?.toLowerCase?.() ?? "";
        if (name.includes("pending") || name.includes("application") || name.includes("apply")) return false;
    }

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
        channelId: (snapshot as any).channel_id ?? (snapshot as any).channelId,
        authorId: snapshot.author?.id,
        guildId: payload.guildId,
        flags: snapshot.flags,
        bot: (snapshot as any).bot || snapshot.author?.bot,
        webhookId: (snapshot as any).webhookId ?? (snapshot as any).webhook_id
    })) return;

    remember(snapshot);
}

export async function handleMessageUpdate(payload: MessageUpdatePayload) {
    if (!active || !settings.store.saveEdits) return;

    // Allow embed/attachment-only edits — content can be null for those
    const hasContent = payload.message.content != null;
    const hasEmbeds = (payload.message as any).embeds != null;
    const hasAttachments = (payload.message as any).attachments != null;
    if (!hasContent && !hasEmbeds && !hasAttachments) return;

    let previous: LoggedMessage | undefined = recentMessages.get(payload.message.id) ?? channelMessageCache.get(payload.message.id);
    if (!previous) {
        const storedMessage = MessageStore.getMessage(payload.message.channel_id, payload.message.id);
        if (storedMessage) {
            previous = snapshotMessage(storedMessage);
        } else {
            // DB fallback for edits to old messages not in memory (cache reduced to 500, or after restart, or bot/webhook history)
            try {
                const rec = await getLogById(payload.message.id);
                if (rec?.message) previous = rec.message as LoggedMessage;
                if (!previous) {
                    const pending = pendingWrites.get(payload.message.id);
                    if (pending?.message) previous = pending.message;
                }
            } catch { }
        }
    }
    if (!previous) return;

    const newContent = hasContent ? payload.message.content : previous.content;
    const embedsChanged = hasEmbeds && JSON.stringify((payload.message as any).embeds) !== JSON.stringify(previous.embeds);
    const attachmentsChanged = hasAttachments && JSON.stringify((payload.message as any).attachments) !== JSON.stringify(previous.attachments);
    const contentChanged = hasContent && previous.content !== payload.message.content;

    if (!contentChanged && !embedsChanged && !attachmentsChanged) {
        if (previous.editHistory?.length && !shouldIgnore({
            channelId: (previous as any).channel_id ?? (previous as any).channelId,
            authorId: previous.author?.id,
            guildId: payload.guildId ?? (previous as any).guildId ?? (previous as any).guild_id,
            flags: previous.flags,
            bot: (previous as any).bot || previous.author?.bot,
            webhookId: (previous as any).webhookId ?? (previous as any).webhook_id
        })) {
            remember(previous);
            queueRecord(previous, LogStatus.EDITED);
        }
        return;
    }

    const message = lodash.cloneDeep(previous);
    const payloadAny = payload.message as any;
    // Assign payload fields but don't clobber content/embeds/attachments when payload didn't include them
    for (const [k, v] of Object.entries(payloadAny)) {
        if (k === "content" && !hasContent) continue;
        if (k === "embeds" && !hasEmbeds) continue;
        if (k === "attachments" && !hasAttachments) continue;
        if (v !== undefined) (message as any)[k] = v;
    }
    if (hasEmbeds) (message as any).embeds = payloadAny.embeds;
    if (hasAttachments) (message as any).attachments = payloadAny.attachments;
    if (hasContent) (message as any).content = payloadAny.content;
    else (message as any).content = previous.content;
    if (!hasEmbeds) (message as any).embeds = previous.embeds;
    if (!hasAttachments) (message as any).attachments = previous.attachments;
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
    invalidateLoggedCaches(message.id);
    if (!shouldIgnore({
        channelId: (message as any).channel_id ?? (message as any).channelId,
        authorId: message.author?.id,
        guildId: (message as any).guildId ?? (message as any).guild_id,
        flags: message.flags,
        bot: (message as any).bot || message.author?.bot,
        webhookId: (message as any).webhookId ?? (message as any).webhook_id
    })) queueRecord(message, LogStatus.EDITED);
}

async function saveDeletedMessage(payload: MessageDeletePayload) {
    const raw: any = payload as any;
    const channelId: string | undefined = raw.channelId ?? raw.channel_id;
    const guildId: string | undefined = raw.guildId ?? raw.guild_id;
    const messageId: string | undefined = raw.id ?? raw.messageId;
    if (!messageId) return;
    const cachedMessage = recentMessages.get(messageId);
    const storedMessage = channelId ? MessageStore.getMessage(channelId, messageId) : undefined;
    let dbFallback: LoggedMessage | undefined;
    if (!cachedMessage && !storedMessage) {
        const chanCached = channelMessageCache.get(messageId);
        if (chanCached) dbFallback = chanCached;
        if (!dbFallback) {
            try {
                const rec = await getLogById(messageId);
                if (rec?.message) dbFallback = rec.message as LoggedMessage;
                if (!dbFallback) {
                    const pending = pendingWrites.get(messageId);
                    if (pending?.message) dbFallback = pending.message;
                }
            } catch { }
        }
        if (!dbFallback) return;
    }

    const source = (cachedMessage ?? storedMessage ?? dbFallback!) as unknown as MessageJSON;
    const message = dbFallback && !cachedMessage && !storedMessage
        ? lodash.cloneDeep(dbFallback)
        : snapshotMessage(source);
    (message as any).guildId = guildId ?? (message as any).guildId;
    message.guildId = payload.guildId ?? message.guildId;
    message.deleted = true;
    message.deletedTimestamp = new Date().toISOString();
    message.attachments = message.attachments.map(attachment => ({ ...attachment, deleted: true }));
    if (settings.store.saveImages && !IS_WEB) {
        try {
            await Promise.all(message.attachments.map(att => ensureAttachmentSaved(att)));
        } catch { /* ignore individual failures */ }
    }
    const ghostPinged = hasCurrentUserMention(message);
    message.ghostPinged = ghostPinged;

    // Pending applications (e.g. appy bot in #pending) should always be kept, even if ignoreBots is on
    let forceKeep = false;
    try {
        const ch2: any = ChannelStore.getChannel(message.channel_id);
        const n = (ch2?.name?.toLowerCase?.() ?? "") as string;
        if (n.includes("pending") || n.includes("application") || n.includes("apply")) forceKeep = true;
        const uname = (message.author?.username ?? "").toLowerCase();
        const gname = ((message.author as any)?.globalName ?? (message.author as any)?.global_name ?? "").toLowerCase();
        if (uname.includes("appy") || gname.includes("appy")) forceKeep = true;
        // Also keep any bot embed with title containing application
        if ((message as any).embeds?.some?.((e: any) => (e.title ?? "").toLowerCase().includes("application") || (e.author?.name ?? "").toLowerCase().includes("appy"))) forceKeep = true;
    } catch {}

    // Ignored messages are dropped from the render cache entirely; logged ones stay
    // cached so they keep rendering inline and the context menu can act on them.
    if (!forceKeep && shouldIgnore({
        channelId: (message as any).channel_id ?? (message as any).channelId ?? channelId,
        authorId: message.author?.id,
        guildId: (message as any).guildId ?? (message as any).guild_id,
        flags: message.flags,
        bot: (message as any).bot || message.author?.bot,
        ghostPinged,
        webhookId: (message as any).webhookId ?? (message as any).webhook_id
    })) {
        if (messageId) recentMessages.delete(messageId);
        if (messageId) channelMessageCache.delete(messageId);
        return;
    }

    if (ghostPinged && settings.store.saveGhostPings) {
        remember(message);
        queueRecord(message, LogStatus.GHOST_PINGED);
        invalidateLoggedCaches(message.id);
        if (settings.store.notifyGhostPings) {
            const authorName = message.author.global_name ?? message.author.globalName ?? message.author.username;
            showNotification({
                title: "MessageLoggerTestcord",
                body: `Captured a ghost ping from ${authorName}.`
            });
        }
    }
    else if (settings.store.saveDeletes) {
        remember(message);
        queueRecord(message, LogStatus.DELETED);
        invalidateLoggedCaches(message.id);
    }
}

export function handleMessageDelete(payload: MessageDeletePayload) {
    if (!active) return;
    // mlDeleted = a locally-initiated hide (our context menu). The record itself is
    // managed explicitly by Delete (Temporary)/(Forever), nothing to do here.
    if (payload.mlDeleted) return;
    void saveDeletedMessage(payload).catch(e => log.error("Failed to save deleted message", e));
}

export function handleMessageDeleteBulk(payload: MessageDeleteBulkPayload) {
    if (!active) return;

    for (const id of payload.ids) {
        if (!payload.mlDeleted) void saveDeletedMessage({ ...payload, id }).catch(e => log.error("Failed to save bulk deleted message", e));
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
export async function localRemoveLoggedMessage(id: string, permanent: boolean, fallbackChannelId?: string): Promise<string | null> {
    const cached = recentMessages.get(id) ?? channelMessageCache.get(id);
    const channelId = (cached as any)?.channel_id ?? fallbackChannelId ?? "";

    recentMessages.delete(id);
    channelMessageCache.delete(id);
    invalidateLoggedCaches(id);

    if (permanent) {
        await deleteLog(id);
    } else {
        // Temp: keep in DB but hide. Ensure any pending write is flushed first so setLogHidden can find it.
        pendingDeletes.delete(id);
        const pending = pendingWrites.get(id);
        if (pending) {
            // Mark pending record as hidden so the upcoming flush persists it correctly
            pending.hidden = true;
            pendingWrites.set(id, pending);
        }
        await flushQueuedLogs();
        await setLogHidden(id, true);
        // If the record was still pending (not yet in DB), the flush above persisted it as hidden.
        // setLogHidden will also mark it hidden if it already existed.
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
        // Per user request: don't bulk-load old logs at startup (prevents lag). Cache only live messages, lazy-load per-channel on demand.
        log.info("Skipped bulk prime (per-channel lazy loading).");
        const doPostPrime = async () => {
            try {
                const currentId = SelectedChannelStore.getChannelId();
                if (!currentId) return;
                const { getChannelLogsLimit } = await import("./db");
                const records = await getChannelLogsLimit(currentId, 30);
                if (records.length) {
                    for (const rec of records) {
                        if (rec.hidden) continue;
                        channelMessageCache.set(rec.message.id, rec.message);
                    }
                    const store = (MessageStore as any).getMessages?.(currentId);
                    if (store?.hasFetched) {
                        const { MessageActions } = await import("@webpack/common");
                        (MessageActions as any).fetchMessages?.({ channelId: currentId, limit: 50 });
                    }
                }
            } catch { }
        };
        const scheduleIdle = (cb: () => void) => {
            const ric = (window as any).requestIdleCallback as any;
            if (ric) (ric as any)(cb, { timeout: 2000 });
            else setTimeout(cb, 500);
        };
        scheduleIdle(() => { void doPostPrime(); });
    } catch (error) {
        log.error("Failed to prime the logged message cache.", error);
    }
}

export function startEngine() {
    active = true;
    // Defer DB/prime work so Discord can paint first; chunking inside primeLoggedCache keeps it off the main thread.
    const scheduleStart = () => {
        void getDatabase()
            .then(performMaintenance)
            .then(primeLoggedCache)
            .catch(error => log.error("Failed to initialize the log database.", error));
    };
    const ric = (window as any).requestIdleCallback as any;
    if (ric) (ric as any)(scheduleStart, { timeout: 1500 });
    else setTimeout(scheduleStart, 800);
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
    channelMessageCache.clear();
    void flushQueuedLogs();
}
