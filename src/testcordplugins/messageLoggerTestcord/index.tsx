/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { addChannelToolbarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton } from "@api/HeaderBar";
import { isPluginEnabled } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { LogsIcon, RestartIcon } from "@components/Icons";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Alerts, MessageActions, MessageStore, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

import { removeLoggerContextMenus, setupLoggerContextMenus } from "./contextMenu";
import { getAllEditedForChannel, getChannelEditedLogsAfter, getChannelLogsAfter, getChannelLogsLimit, getDatabase } from "./db";
import {
    cacheChannelMessages,
    clearAllLogs,
    clearChannelCache,
    clearTempClearedEdits,
    getCachedLoggedMessage,
    handleMessageCreate,
    handleMessageDelete,
    handleMessageDeleteBulk,
    handleMessageUpdate,
    isEditHistoryTempCleared,
    isTempHiddenMessage,
    maybeStripAntilogNonce,
    mergedEditTimestamps as mergedEditTimestampsRef,
    mergedMessageCache as mergedMessageCacheRef,
    preserveRemovedMedia,
    rememberLiveMessages,
    runMaintenanceNow,
    shouldIgnore,
    startEngine,
    stopEngine
} from "./engine";
import { importMleLogs, importMleSettings } from "./io";
import { openLogs } from "./LogsModal";
import { osintScanLoggedMessages } from "./osintBridge";
import { ensureDefaultDir, restoreAttachmentBlobs } from "./saveImage";
import { settings } from "./settings";
import type { FetchMessagesResponse, LoadMessagesPayload, LoggedMessage, LogRecord, MessageCreatePayload, MessageDeleteBulkPayload, MessageDeletePayload, MessageUpdatePayload } from "./types";
import { cl } from "./utils";

const log = new Logger("MessageLoggerTestcord");
const HEADER_SETTINGS = ["showLogsButton"] as const;
const MessageStoreInternal = findByPropsLazy("getOrCreate", "commit", "has", "get");

// From render.ts
let renderApi: typeof import("./render");
const mergedMessageCache = mergedMessageCacheRef;
const mergedEditTimestamps = mergedEditTimestampsRef;
let oldGetMessage: typeof MessageStore.getMessage | null = null;

function OpenLogsButton() {
    const { showLogsButton } = settings.use(HEADER_SETTINGS);
    if (!showLogsButton) return null;

    return <HeaderBarButton tooltip="Open Logs" icon={LogsIcon} onClick={() => openLogs()} />;
}

function LoadMoreButton() {
    return <ChannelToolbarButton tooltip="Load all deleted logs" icon={LogsIcon} onClick={() => { void loadMoreDeletedLogs(); }} />;
}

function ReloadLogsButton() {
    return <ChannelToolbarButton tooltip="Reload logs for this channel" icon={RestartIcon} onClick={() => { void reloadCurrentChannelLogs(); }} />;
}

async function processMessageFetch(response: FetchMessagesResponse) {
    if (!response.ok || !Array.isArray(response.body)) return;

    // Cache live history so later deletes resolve even for messages never
    // seen via MESSAGE_CREATE this session (e.g. older DM photos).
    try { rememberLiveMessages(response.body); } catch { }

    try {
        if (response.body.length === 0) {
            const channelId = SelectedChannelStore.getChannelId();
            if (!channelId) return;
            // Empty channel (all deleted) – load deleted logs for this channel
            let records = channelAllDeleted.get(channelId);
            if (!records) {
                records = await getChannelLogsAfter(channelId, new Date(0).toISOString());
                if (records.length) channelAllDeleted.set(channelId, records);
            }
            const visible = visibleDeletedRecords(channelId);
            if (visible.length) {
                try { cacheChannelMessages(visible); } catch { }
                for (const rec of visible) {
                    if (rec.message.attachments?.length) {
                        try { await restoreAttachmentBlobs(rec.message.attachments as any); } catch { }
                    }
                }
                response.body.extra = visible.map(record => record.message);
            }
            // Also cache edited logs for this channel so getMessage merge works even in empty view
            try {
                let editedAll = channelAllEdited.get(channelId);
                if (!editedAll) {
                    editedAll = await getAllEditedForChannel(channelId);
                    if (editedAll.length) {
                        channelAllEdited.set(channelId, editedAll);
                        try { cacheChannelMessages(editedAll.filter(r => !isEditHistoryTempCleared(r.message_id))); } catch { }
                    }
                } else {
                    try { cacheChannelMessages(editedAll.filter(r => !isEditHistoryTempCleared(r.message_id))); } catch { }
                }
            } catch { }
            return;
        }
        const oldestMessage = response.body[response.body.length - 1];
        if (!oldestMessage?.channel_id || oldestMessage?.timestamp == null) return;
        const channelId = oldestMessage.channel_id as string;
        // Ensure all deleted for this channel are cached (load all on first fetch)
        let allDeleted = channelAllDeleted.get(channelId);
        if (!allDeleted) {
            allDeleted = await getChannelLogsAfter(channelId, new Date(0).toISOString());
            if (allDeleted.length) channelAllDeleted.set(channelId, allDeleted);
        }
        const newestMessage = response.body[0];
        const newestTs = typeof newestMessage.timestamp === "string" ? newestMessage.timestamp : new Date(String(newestMessage.timestamp)).toISOString();
        let rangeRecords: LogRecord[] = [];
        try {
            rangeRecords = await getChannelLogsLimit(channelId, FETCH_RANGE_WINDOW, newestTs);
        } catch { }
        const seenExtra = new Set<string>();
        const combined: LogRecord[] = [];
        for (const rec of [...visibleDeletedRecords(channelId), ...rangeRecords]) {
            if (seenExtra.has(rec.message_id)) continue;
            if (isTempHiddenMessage(rec.message_id)) continue;
            seenExtra.add(rec.message_id);
            combined.push(rec);
        }
        if (combined.length) {
            try { cacheChannelMessages(combined); } catch { }
            for (const rec of combined) {
                if (rec.message.attachments?.length) {
                    try { await restoreAttachmentBlobs(rec.message.attachments as any); } catch { }
                }
            }
            response.body.extra = combined.map(record => record.message);
        }
        const ts = typeof oldestMessage.timestamp === "string" ? oldestMessage.timestamp : new Date(String(oldestMessage.timestamp)).toISOString();
        // Attach editHistory to live messages so they render with history after fetch
        try {
            let editedAll = channelAllEdited.get(channelId);
            if (!editedAll) {
                editedAll = await getAllEditedForChannel(channelId);
                if (editedAll.length) {
                    // Filter out temporarily cleared edits
                    const filtered = editedAll.filter(r => !isEditHistoryTempCleared(r.message_id));
                    channelAllEdited.set(channelId, editedAll);
                    try { cacheChannelMessages(filtered); } catch { }
                }
            } else {
                // Ensure cache respects temp cleared
                try { cacheChannelMessages(editedAll.filter(r => !isEditHistoryTempCleared(r.message_id))); } catch { }
            }
            if (editedAll?.length || (await getChannelEditedLogsAfter(channelId, ts)).length) {
                // Use cached all-edited for fast lookup, but also ensure window is covered
                const editedMap = new Map<string, LogRecord>();
                for (const r of (editedAll ?? [])) if (!isEditHistoryTempCleared(r.message_id)) editedMap.set(r.message_id, r);
                // Also fetch window-specific in case allDeleted load missed due to timing
                if (!editedAll?.length) {
                    const windowEdited = await getChannelEditedLogsAfter(channelId, ts);
                    for (const r of windowEdited) if (!isEditHistoryTempCleared(r.message_id)) editedMap.set(r.message_id, r);
                    if (windowEdited.length) try { cacheChannelMessages(windowEdited.filter(r => !isEditHistoryTempCleared(r.message_id))); } catch { }
                }
                for (const msg of response.body) {
                    if (isEditHistoryTempCleared((msg as any).id)) continue;
                    const rec = editedMap.get((msg as any).id);
                    if (rec?.message?.editHistory?.length) {
                        (msg as any).editHistory = rec.message.editHistory;
                        try { renderApi?.invalidateMessageClassCache((msg as any).id); mergedMessageCache.delete((msg as any).id); mergedEditTimestamps.delete((msg as any).id); } catch { }
                    }
                }
                // Also handle messages that arrived as extra (deleted) may have editHistory
                if (response.body.extra?.length) {
                    for (const msg of response.body.extra) {
                        if (isEditHistoryTempCleared((msg as any).id)) continue;
                        const rec = editedMap.get((msg as any).id);
                        if (rec?.message?.editHistory?.length && !(msg as any).editHistory?.length) {
                            (msg as any).editHistory = rec.message.editHistory;
                            try { renderApi?.invalidateMessageClassCache((msg as any).id); mergedMessageCache.delete((msg as any).id); mergedEditTimestamps.delete((msg as any).id); } catch { }
                        }
                    }
                }
            } else {
                // Window-only fallback
                const windowEdited = await getChannelEditedLogsAfter(channelId, ts);
                const filteredWindow = windowEdited.filter(r => !isEditHistoryTempCleared(r.message_id));
                if (filteredWindow.length) {
                    try { cacheChannelMessages(filteredWindow); } catch { }
                    const editedMap = new Map(filteredWindow.map(r => [r.message_id, r] as const));
                    for (const msg of response.body) {
                        if (isEditHistoryTempCleared((msg as any).id)) continue;
                        const rec = editedMap.get((msg as any).id);
                        if (rec?.message?.editHistory?.length) {
                            (msg as any).editHistory = rec.message.editHistory;
                            try { renderApi?.invalidateMessageClassCache((msg as any).id); mergedMessageCache.delete((msg as any).id); mergedEditTimestamps.delete((msg as any).id); } catch { }
                        }
                    }
                }
            }
        } catch { }
    } catch (error) {
        log.error("Failed to restore persistent logs into the channel.", error);
    }
}

function mergeLoadedMessages(messages: LoggedMessage[] & { extra?: LoggedMessage[]; }, payload: LoadMessagesPayload) {
    if (!messages.extra?.length) {
        // Still cache live messages for delete resolution on plain fetches.
        try { rememberLiveMessages(messages); } catch { }
        return messages;
    }
    if (messages.length === 0) {
        // Empty channel (e.g. #pending after all accepted) — show all deleted logs for it
        const sorted = [...messages.extra].sort((a, b) => Date.parse(String(b.timestamp)) - Date.parse(String(a.timestamp)));
        messages.push(...sorted);
        return messages;
    }

    const toMs = (t: string) => {
        const ms = Date.parse(String(t));
        return Number.isNaN(ms) ? 0 : ms;
    };
    const oldestMs = toMs(String(messages[messages.length - 1].timestamp));
    const newestMs = toMs(String(messages[0].timestamp));
    const includeNewer = !payload.hasMoreAfter && !payload.isBefore;
    const includeOlder = !payload.hasMoreBefore && !payload.isAfter;
    const knownIds = new Set(messages.map(message => message.id));
    const extra = messages.extra.filter(message => {
        if (knownIds.has(message.id)) return false;
        const tsMs = toMs(String(message.timestamp));
        if (!includeNewer && tsMs > newestMs) return false;
        if (!includeOlder && tsMs < oldestMs) return false;
        return true;
    });

    messages.push(...extra);
    // Parse each timestamp once: the old comparator re-parsed both sides on
    // every comparison (O(n log n) Date.parse calls per channel fetch).
    const stamped = messages.map(message => ({ message, ms: toMs(String(message.timestamp)) }));
    stamped.sort((left, right) => right.ms - left.ms);
    messages.length = 0;
    for (const { message } of stamped) messages.push(message);
    try { rememberLiveMessages(messages); } catch { }
    return messages;
}

const lastChannelFetch = new Map<string, number>();
const channelAllDeleted = new Map<string, LogRecord[]>();
const channelAllEdited = new Map<string, LogRecord[]>();
const channelCacheTimeout = new Map<string, ReturnType<typeof setTimeout>>();
const channelDeleteLimit = new Map<string, number>();
const channelWebhookLimit = new Map<string, number>();
const FETCH_RANGE_WINDOW = 200;
let lastSelectedChannelId: string | null = null;

// Mapped edit histories by source array. getEdited runs inside the message
// render patch, and re-mapping plus re-sanitizing every embed on every render
// of an edited message was pure repeat work. Histories are always replaced,
// never mutated, so a stable array means stable output. WeakMap entries die
// with their arrays — no manual invalidation needed.
const mappedEditHistoryCache = new WeakMap<object, any[]>();

function mapEditHistoryCached(editHistory: any[]) {
    const hit = mappedEditHistoryCache.get(editHistory);
    if (hit) return hit;
    const mapped = editHistory.map(renderApi.mapTimestamp);
    mappedEditHistoryCache.set(editHistory, mapped);
    return mapped;
}

function isWebhookMessage(message: any) {
    return (message?.webhookId ?? message?.webhook_id) != null;
}

function visibleDeletedRecords(channelId: string): LogRecord[] {
    const all = channelAllDeleted.get(channelId) ?? [];
    const messageLimit = channelDeleteLimit.get(channelId) ?? settings.store.initialDeletedMessages;
    const webhookLimit = channelWebhookLimit.get(channelId) ?? settings.store.initialDeletedWebhooks;
    const visible: LogRecord[] = [];
    let messages = 0;
    let webhooks = 0;
    for (let i = all.length - 1; i >= 0; i--) {
        const record = all[i];
        // Session hides (Delete Message Temporary) stay out of chat until restart.
        if (isTempHiddenMessage(record.message_id)) continue;
        if (isWebhookMessage(record.message)) {
            if (webhooks >= webhookLimit) continue;
            webhooks++;
        } else {
            if (messages >= messageLimit) continue;
            messages++;
        }
        visible.push(record);
        if (messages >= messageLimit && webhooks >= webhookLimit) break;
    }
    return visible;
}

function injectDeletedRecords(channelId: string, records: LogRecord[]) {
    try {
        const Internal: any = (MessageStoreInternal as any);
        const cache = Internal.get?.(channelId) ?? Internal.getOrCreate?.(channelId);
        if (!cache) return;
        let newCache = cache;
        for (const rec of records) {
            if (newCache.has?.(rec.message_id)) continue;
            const msgClass = (renderApi as any)?.messageJsonToMessageClass?.({ message: rec.message });
            if (!msgClass) continue;
            if (typeof newCache.set === "function") newCache = newCache.set(rec.message_id, msgClass);
        }
        if (newCache !== cache) {
            try { Internal.commit?.(newCache); } catch { }
        }
    } catch { }
}

// Patch already-cached live messages with their logged edit history and commit
// so chat re-renders immediately instead of showing no history until the next
// fetch/scroll replaces the collection. Work is bounded by loaded store entries
// (tens/hundreds), not by every logged edit (potentially thousands).
function injectEditedHistories(channelId: string, records: LogRecord[]) {
    try {
        const Internal: any = (MessageStoreInternal as any);
        const cache = Internal.get?.(channelId);
        if (!cache || typeof cache.update !== "function") return;
        const histById = new Map<string, unknown>();
        for (const rec of records) {
            const hist = rec.message?.editHistory;
            if (!Array.isArray(hist) || hist.length === 0) continue;
            if (isEditHistoryTempCleared(rec.message_id)) continue;
            histById.set(rec.message_id, hist);
        }
        if (histById.size === 0) return;
        const needsPatch: { id: string; hist: unknown; }[] = [];
        const consider = (id: string, msg: any) => {
            try {
                const hist = histById.get(id);
                if (hist == null) return;
                const cur = (msg as any)?.editHistory;
                const curLen = Array.isArray(cur) ? cur.length : 0;
                if (curLen < (hist as unknown[]).length) needsPatch.push({ id, hist });
            } catch { }
        };
        try {
            if (typeof cache.forEach === "function") {
                cache.forEach((msg: any, id: unknown) => {
                    if (typeof id === "string") consider(id, msg);
                });
            } else {
                for (const [id, hist] of histById) {
                    let existing: any;
                    try { existing = cache.get?.(id); } catch { continue; }
                    if (existing) consider(id, existing);
                }
            }
        } catch { return; }
        if (needsPatch.length === 0) return;
        let newCache = cache;
        for (const { id, hist } of needsPatch) {
            try {
                newCache = newCache.update(id, (m: any) => {
                    try {
                        if (m && typeof m.set === "function") return m.set("editHistory", hist);
                        if (m) m.editHistory = hist;
                        return m;
                    } catch { return m; }
                });
            } catch { }
            try { renderApi?.invalidateMessageClassCache(id); mergedMessageCache.delete(id); mergedEditTimestamps.delete(id); } catch { }
        }
        if (newCache !== cache) {
            try { Internal.commit?.(newCache); } catch { }
        }
    } catch { }
}

async function loadMoreDeletedLogs() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) {
        showToast("Open a channel first.", Toasts.Type.FAILURE);
        return;
    }
    let all = channelAllDeleted.get(channelId);
    if (!all) {
        try {
            all = await getChannelLogsAfter(channelId, new Date(0).toISOString());
        } catch { all = []; }
        channelAllDeleted.set(channelId, all);
    }
    if (!all.length) {
        showToast("No deleted logs in this channel.", Toasts.Type.MESSAGE);
        return;
    }
    const loadedIds = new Set(visibleDeletedRecords(channelId).map(record => record.message_id));
    channelDeleteLimit.set(channelId, Number.MAX_SAFE_INTEGER);
    channelWebhookLimit.set(channelId, Number.MAX_SAFE_INTEGER);
    const fresh = visibleDeletedRecords(channelId).filter(record => !loadedIds.has(record.message_id));
    if (!fresh.length) {
        showToast("All deleted logs already loaded.", Toasts.Type.MESSAGE);
        return;
    }
    try { cacheChannelMessages(fresh); } catch { }
    for (const rec of fresh) {
        if (rec.message.attachments?.length) {
            try { await restoreAttachmentBlobs(rec.message.attachments as any); } catch { }
        }
    }
    injectDeletedRecords(channelId, fresh);
    showToast(`Loaded ${fresh.length} more deleted logs.`, Toasts.Type.SUCCESS);
}

function reloadCurrentChannelLogs() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) {
        showToast("Open a channel first.", Toasts.Type.FAILURE);
        return;
    }
    // Drop this channel's cached logs and limit overrides so the default
    // amount is loaded fresh below.
    channelAllDeleted.delete(channelId);
    channelAllEdited.delete(channelId);
    channelDeleteLimit.delete(channelId);
    channelWebhookLimit.delete(channelId);
    const pendingTimeout = channelCacheTimeout.get(channelId);
    if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        channelCacheTimeout.delete(channelId);
    }
    try { clearChannelCache(channelId); } catch { }
    handleChannelSelect({ channelId });
    showToast("Reloading message logs for this channel.", Toasts.Type.MESSAGE);
}

function scheduleChannelUnload(channelId: string) {
    const existing = channelCacheTimeout.get(channelId);
    if (existing) clearTimeout(existing);
    const timeout = setTimeout(() => {
        // Unload if not currently viewing this channel
        if (SelectedChannelStore.getChannelId() !== channelId) {
            channelAllDeleted.delete(channelId);
            channelAllEdited.delete(channelId);
            channelDeleteLimit.delete(channelId);
            channelWebhookLimit.delete(channelId);
            channelCacheTimeout.delete(channelId);
            clearChannelCache(channelId);
            // Also remove from MessageStore cache to free memory
            try {
                const Internal: any = (MessageStoreInternal as any);
                const cache = Internal.get?.(channelId);
                if (cache) {
                    const all = channelAllDeleted.get(channelId) ?? [];
                    // Actually we already deleted, so nothing to do – just clear the cache entries for deleted messages
                    // For now, just clear the channel's MessageStore cache for deleted messages that are not live
                    // We keep live messages, but remove deleted that were injected
                    // Simplest: do nothing, let MessageStore keep them until next fetch overwrites
                }
            } catch { }
        }
    }, 60_000);
    channelCacheTimeout.set(channelId, timeout);
}

function handleChannelSelect(payload: { channelId?: string; }) {
    const channelId = payload?.channelId;
    if (channelId == null) return;
    const prev = lastSelectedChannelId;
    if (prev && prev !== channelId) {
        // Schedule unload for previous channel after 1min if not revisited
        scheduleChannelUnload(prev);
    }
    lastSelectedChannelId = channelId;
    // Cancel unload for this channel if we came back quickly
    const existingTimeout = channelCacheTimeout.get(channelId);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        channelCacheTimeout.delete(channelId);
    }

    // Load all deleted for this channel (if not already cached)
    if (!channelAllDeleted.has(channelId)) {
        void (async () => {
            try {
                const records = await getChannelLogsAfter(channelId, new Date(0).toISOString());
                if (records.length) {
                    channelAllDeleted.set(channelId, records);
                    const visible = visibleDeletedRecords(channelId);
                    try { cacheChannelMessages(visible); } catch { }
                    // Ensure saved attachments have blob URLs before injecting
                    for (const rec of visible) {
                        if (rec.message.attachments?.length) {
                            try { await restoreAttachmentBlobs(rec.message.attachments as any); } catch { }
                        }
                    }
                    // Inject into MessageStore for immediate display
                    injectDeletedRecords(channelId, visible);
                }
            } catch { }
        })();
    } else {
        injectDeletedRecords(channelId, visibleDeletedRecords(channelId));
    }
    // Load edited history for this channel so MessageStore.getMessage can merge it
    if (!channelAllEdited.has(channelId)) {
        void (async () => {
            try {
                const edited = await getAllEditedForChannel(channelId);
                if (edited.length) {
                    channelAllEdited.set(channelId, edited);
                    const toCache = edited.filter(r => !isEditHistoryTempCleared(r.message_id));
                    try { cacheChannelMessages(toCache); } catch { }
                    // Invalidate any cached MessageClass so re-render picks up editHistory
                    for (const rec of toCache) {
                        try { (renderApi as any)?.invalidateMessageClassCache?.(rec.message_id); } catch { }
                        try { mergedMessageCache.delete(rec.message_id); mergedEditTimestamps.delete(rec.message_id); } catch { }
                    }
                    // Push history into already-rendered store entries so the
                    // channel re-renders with history right away instead of
                    // staying blank until the next fetch/scroll.
                    try { injectEditedHistories(channelId, toCache); } catch { }
                }
            } catch { }
        })();
    } else {
        // Refresh cache for existing channel, respecting temp cleared
        try {
            const existing = channelAllEdited.get(channelId);
            if (existing?.length) {
                const toCache = existing.filter(r => !isEditHistoryTempCleared(r.message_id));
                try { cacheChannelMessages(toCache); } catch { }
                try { injectEditedHistories(channelId, toCache); } catch { }
            }
        } catch { }
    }

    // Snapshot whatever is already rendered so deletes resolve even before
    // the next fetch populates the cache (e.g. just-opened DM history).
    try {
        const liveCollection = (MessageStore as any).getMessages?.(channelId) as any;
        if (Array.isArray(liveCollection)) {
            if (liveCollection.length) rememberLiveMessages(liveCollection as any);
        } else if (typeof liveCollection?.toArray === "function") {
            const arr = liveCollection.toArray();
            if (arr?.length) rememberLiveMessages(arr as any);
        } else if (typeof liveCollection?.forEach === "function") {
            const arr: LoggedMessage[] = [];
            liveCollection.forEach((m: any) => { if (m) arr.push(m); });
            if (arr.length) rememberLiveMessages(arr);
        }
    } catch { }

    // Only refetch if we have fetched this channel before and have logged messages for it.
    const collection = (MessageStore as any).getMessages?.(channelId);
    if (!collection?.hasFetched) return;
    const now = Date.now();
    const last = lastChannelFetch.get(channelId) ?? 0;
    if (now - last < 30_000) return;
    void Promise.all([
        getChannelLogsAfter(channelId, new Date(0).toISOString()),
        getAllEditedForChannel(channelId)
    ]).then(([deleted, edited]) => {
        if (deleted.length === 0 && edited.length === 0) return;
        lastChannelFetch.set(channelId, now);
        try {
            (MessageActions as any).fetchMessages?.({ channelId, limit: 50 });
        } catch { }
    }).catch(() => { });
}

/**
 * Fallback live-keep: if the MessageStore patch missed a delete (stale match,
 * cache lookup failure), put the marked-deleted copy back instantly so the
 * message stays visible instead of only reappearing after a restart.
 */
function reInjectDeletedLive(channelId: string, snapshot: LoggedMessage) {
    try {
        const Internal: any = (MessageStoreInternal as any);
        const cache = Internal.get?.(channelId);
        if (!cache || cache.has?.(snapshot.id)) return;
        const marked: LoggedMessage = {
            ...snapshot,
            deleted: true,
            deletedTimestamp: (snapshot as any).deletedTimestamp ?? new Date().toISOString(),
            attachments: snapshot.attachments?.map(a => ({ ...a, deleted: true })) ?? []
        };
        try { renderApi?.invalidateMessageClassCache(snapshot.id); } catch { }
        try { mergedMessageCache.delete(snapshot.id); mergedEditTimestamps.delete(snapshot.id); } catch { }
        const msgClass = (renderApi as any)?.messageJsonToMessageClass?.({ message: marked });
        if (!msgClass || typeof cache.set !== "function") return;
        const newCache = cache.set(snapshot.id, msgClass);
        if (newCache !== cache) {
            try { Internal.commit?.(newCache); } catch { }
        }
    } catch { }
}

function snapshotForDelete(channelId: string | undefined, messageId: string | undefined): LoggedMessage | undefined {
    if (!messageId) return undefined;
    try {
        let snap = getCachedLoggedMessage(messageId);
        if (!snap && channelId) {
            const live: any = MessageStore.getMessage(channelId, messageId);
            if (live) {
                try { rememberLiveMessages([live]); } catch { }
                snap = getCachedLoggedMessage(messageId) ?? live;
            }
        }
        return snap;
    } catch {
        return undefined;
    }
}

function onFluxMessageDelete(payload: MessageDeletePayload) {
    if ((payload as any)?.mlDeleted) {
        handleMessageDelete(payload);
        return;
    }
    const channelId = (payload as any)?.channelId ?? (payload as any)?.channel_id;
    const messageId = (payload as any)?.id ?? (payload as any)?.messageId;
    const snap = snapshotForDelete(channelId, messageId);
    handleMessageDelete(payload);
    if (snap && channelId && messageId) {
        // Microtask runs before paint: no visible flicker when the patch missed.
        queueMicrotask(() => {
            try {
                const Internal: any = (MessageStoreInternal as any);
                if (Internal.get?.(channelId)?.has?.(messageId)) return;
                reInjectDeletedLive(channelId, snap);
            } catch { }
        });
    }
}

function onFluxMessageDeleteBulk(payload: MessageDeleteBulkPayload) {
    if ((payload as any)?.mlDeleted) {
        handleMessageDeleteBulk(payload);
        return;
    }
    const channelId = (payload as any)?.channelId ?? (payload as any)?.channel_id;
    const ids: string[] = (payload as any)?.ids ?? [];
    const snaps = new Map<string, LoggedMessage>();
    for (const id of ids) {
        const snap = snapshotForDelete(channelId, id);
        if (snap) snaps.set(id, snap);
    }
    handleMessageDeleteBulk(payload);
    if (snaps.size && channelId) {
        queueMicrotask(() => {
            try {
                const Internal: any = (MessageStoreInternal as any);
                const cache = Internal.get?.(channelId);
                for (const [id, snap] of snaps) {
                    try {
                        if (cache?.has?.(id)) continue;
                        reInjectDeletedLive(channelId, snap);
                    } catch { }
                }
            } catch { }
        });
    }
}

export default definePlugin({
    name: "MessageLoggerTestcord",
    description: "The best of all loggers in one plugin. Logs deleted/edited messages with inline chat display, ghost ping detection, disk-saved attachments, silent delete, anti-antilog protection, search, protected logs and automatic maintenance.",
    authors: [TestcordDevs.x2b],
    tags: ["Chat", "Utility"],
    dependencies: ["MessageLogger", "HeaderBarAPI", "ContextMenuAPI"],
    settings,
    settingsAboutComponent: () => (
        <div>
            <p>MessageLogger is required by MessageLoggerTestcord to function. MessageLoggerEnhanced must remain disabled while MessageLoggerTestcord is enabled. The Silent Delete options defer to AntilogPremium when that plugin is enabled. AntiAntilog is now merged into this plugin (nonce blocking and media preservation). Saved attachments from preserved messages are downloaded to disk and restored after restart, so you can disable the standalone AntiAntilog plugin.</p>
            <div className={cl("actions")} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="vc-testcord-ml-btn" onClick={() => openLogs()}>Open logs</button>
                <button
                    className="vc-testcord-ml-btn"
                    onClick={() => void runMaintenanceNow()
                        .then(() => showToast("Message log maintenance completed.", Toasts.Type.SUCCESS))
                        .catch(() => showToast("Message log maintenance failed.", Toasts.Type.FAILURE))}
                >
                    Run maintenance
                </button>
                <button
                    className="vc-testcord-ml-btn"
                    onClick={async () => {
                        try {
                            const count = await importMleSettings();
                            showToast(`Imported ${count} settings from MessageLoggerEnhanced.`, Toasts.Type.SUCCESS);
                        } catch (e) {
                            showToast(e instanceof Error ? e.message : "Failed to import settings.", Toasts.Type.FAILURE);
                        }
                    }}
                >
                    Import MLE settings
                </button>
                <button
                    className="vc-testcord-ml-btn"
                    onClick={async () => {
                        try {
                            await getDatabase();
                            const count = await importMleLogs();
                            showToast(`Imported ${count} logged messages from MessageLoggerEnhanced.`, Toasts.Type.SUCCESS);
                        } catch (e) {
                            showToast(e instanceof Error ? e.message : "Failed to import MLE logs.", Toasts.Type.FAILURE);
                        }
                    }}
                >
                    Import MLE logs
                </button>
                <button
                    className="vc-testcord-ml-btn"
                    style={{ color: "var(--status-danger)" }}
                    onClick={() => Alerts.show({
                        title: "Clear every message log",
                        body: "This also removes protected logs and cannot be undone.",
                        confirmText: "Clear everything",
                        cancelText: "Cancel",
                        onConfirm: async () => {
                            await clearAllLogs(true);
                            showToast("Cleared every message log.", Toasts.Type.SUCCESS);
                        }
                    })}
                >
                    Clear everything
                </button>
            </div>
        </div>
    ),

    commands: [
        {
            name: "testcordlogs",
            description: "Open the persistent message log.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{
                name: "query",
                description: "Optional advanced search query.",
                type: ApplicationCommandOptionType.STRING
            }],
            execute(args) {
                openLogs(findOption(args, "query", ""));
            }
        },
        {
            name: "osintlogs",
            description: "Run the OSINT analyzer over a user's logged deleted and edited messages.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "user",
                    description: "The user whose logged messages to analyze.",
                    type: ApplicationCommandOptionType.USER,
                    required: true
                },
                {
                    name: "include_edits_only",
                    description: "Only analyze edited messages (deleted are always included).",
                    type: ApplicationCommandOptionType.BOOLEAN
                }
            ],
            execute(args) {
                const userId = findOption(args, "user", "") as string;
                if (!userId) {
                    showToast("Pick a user to analyze.", Toasts.Type.FAILURE);
                    return;
                }
                void osintScanLoggedMessages(userId);
            }
        }
    ],

    headerBarButton: {
        icon: LogsIcon,
        render: OpenLogsButton
    },

    patches: [
        // Keep deleted messages in the MessageStore cache so they stay visible live instead of disappearing after the dispatch
        {
            find: '"MessageStore"',
            replacement: [
                {
                    match: /MESSAGE_DELETE:function\((\i)\)\{/,
                    replace: "MESSAGE_DELETE:function($1){if($self.handleStoreDelete2($1))return;"
                },
                {
                    match: /MESSAGE_DELETE_BULK:function\((\i)\)\{/,
                    replace: "MESSAGE_DELETE_BULK:function($1){if($self.handleStoreDelete2($1,true))return;"
                }
            ]
        },
        // Anti-antilog: block nonce dedupe and preserve removed embeds/attachments (merged from AntiAntilog)
        {
            find: '"MessageStore"',
            replacement: [
                {
                    match: /(?<=MESSAGE_CREATE:function\((\i)\)\{)/,
                    replace: "$self.maybeStripAntilogNonce($1);"
                },
                {
                    match: /(?<=MESSAGE_UPDATE:function\((\i)\)\{)/,
                    replace: "$self.preserveRemovedMedia($1);"
                }
            ]
        },
        // Fix pagination for channels with many deleted logs (e.g. #pending with 165) — don't drop newer messages when fetching older batches
        {
            find: "function F(e,t)",
            noWarn: true,
            replacement: {
                match: /if\((\i)\.hasMoreAfter\)return (\i);/,
                replace: "if(false&&$1.hasMoreAfter)return $2;"
            }
        },
        // Restore logged deleted/edited messages when a channel history is fetched
        {
            find: "_tryFetchMessagesCached",
            replacement: [
                {
                    match: /(?<=\.get\(\{url.{0,150}?\.then\()(\i)=>\(/,
                    replace: "async $1=>(await $self.processMessageFetch($1),"
                },
                {
                    match: /(?<=type:"LOAD_MESSAGES_SUCCESS",.{1,100})messages:(\i)/,
                    replace: "get messages(){return $self.mergeLoadedMessages($1,this)}"
                }
            ]
        },
        // Render deleted/edit state inline in normal chat rendering
        {
            find: ".PREMIUM_REFERRAL&&(",
            replacement: {
                match: /deleted:\i\.deleted, editHistory:\i\.editHistory,/,
                replace: "deleted:$self.getDeleted(...arguments), editHistory:$self.getEdited(...arguments),"
            }
        },
        // dont fetch messages for deleted logged messages when jumping
        {
            find: "Using PollReferenceMessageContext without",
            noWarn: true,
            replacement: {
                match: /(?:\i\.)?\i\.(?:default\.)?focusMessage\(/,
                replace: "!(arguments[0]?.message?.deleted || arguments[0]?.message?.editHistory?.length > 0) && $&"
            }
        },
        // fix saved videos failing to play back from blob: urls (readyState stuck LOADING)
        {
            find: ".handleImageLoad)",
            noWarn: true,
            replacement: {
                match: /(componentDidMount\(\){)(.{1,150}===(.+?)\.LOADING)/,
                replace: "$1if(this.props?.src?.startsWith('blob:') && this.props?.item?.type === 'VIDEO')return this.setState({readyState: $3.READY});$2"
            }
        },
        // only check for expired attachments if the message is not deleted
        {
            find: "refreshed_urls",
            noWarn: true,
            replacement: {
                match: /\i\.attachments\.some\(\i\)\|\|\i\.embeds\.some/,
                replace: "!arguments[0].deleted && $&"
            }
        }
    ],

    get toolboxActions(): Record<string, () => void> {
        if (settings.store.hideFromToolbox) return {};
        return { "Message Logger Testcord": () => openLogs() };
    },

    processMessageFetch,
    mergeLoadedMessages,
    maybeStripAntilogNonce,
    preserveRemovedMedia,

    flux: {
        MESSAGE_CREATE: handleMessageCreate as (payload: MessageCreatePayload) => void,
        MESSAGE_UPDATE: handleMessageUpdate as (payload: MessageUpdatePayload) => void,
        MESSAGE_DELETE: onFluxMessageDelete as (payload: MessageDeletePayload) => void,
        MESSAGE_DELETE_BULK: onFluxMessageDeleteBulk as (payload: MessageDeleteBulkPayload) => void,
        CHANNEL_SELECT: handleChannelSelect as (payload: { channelId?: string; }) => void,
    },

    getDeleted(m1: any, m2: any) {
        const deleted = m2?.deleted ?? m1?.deleted;
        return settings.store.showDeletedMessages ? deleted : deleted != null ? false : deleted;
    },

    getEdited(m1: any, m2: any) {
        const clearedId = (m2 as any)?.id ?? (m1 as any)?.id;
        if (typeof clearedId === "string" && isEditHistoryTempCleared(clearedId)) return [];
        if (!settings.store.showEditHistory) return m2?.editHistory;
        const editHistory = m2?.editHistory ?? (m1?.editHistory?.length ? mapEditHistoryCached(m1.editHistory) : undefined);
        // On a fresh channel switch the store objects render before the async
        // edited-log load finishes, so fall back to the logger cache to avoid
        // a transient blank history.
        try {
            const id = (m2 as any)?.id ?? (m1 as any)?.id;
            if (typeof id === "string") {
                const cachedHist = getCachedLoggedMessage(id)?.editHistory;
                if (Array.isArray(cachedHist) && cachedHist.length > 0) {
                    if (!Array.isArray(editHistory) || cachedHist.length > editHistory.length) return cachedHist;
                }
            }
        } catch { }
        return editHistory;
    },

    handleStoreDelete(cache: any, data: { channelId: string; id: string; ids?: string[]; mlDeleted?: boolean; }, isBulk: boolean) {
        try {
            if (cache == null || (!isBulk && !cache.has(data.id))) return cache;
            const EPHEMERAL = 64;
            const mutate = (id: string) => {
                const msg = cache.get(id);
                if (!msg) return;
                if (data.mlDeleted || (msg.flags & EPHEMERAL) === EPHEMERAL) {
                    cache = cache.remove(id);
                    return;
                }
                // Determine if this bot/ webhook message should be kept: reuse the same ignore logic as the logger.
                // hasCurrentUserMention check for ghost pings — keep them even if otherwise ignored
                let ghostPinged = false;
                try {
                    const currentUserId = UserStore.getCurrentUser()?.id;
                    if (currentUserId) {
                        ghostPinged = !!msg.mention_everyone || (Array.isArray(msg.mentions) && msg.mentions.some((m: any) => (m?.id ?? m) === currentUserId));
                    }
                } catch { }
                const ignored = shouldIgnore({
                    channelId: msg.channel_id ?? data.channelId,
                    authorId: msg.author?.id,
                    guildId: (msg as any).guild_id ?? (msg as any).guildId,
                    flags: msg.flags,
                    bot: msg.bot || msg.author?.bot,
                    ghostPinged,
                    webhookId: (msg as any).webhookId
                });
                if (ignored) {
                    cache = cache.remove(id);
                } else {
                    // Keep the message but mark its attachments/embeds as deleted so the UI tints it correctly.
                    cache = cache.update(id, (m: any) => {
                        let next = m.set("deleted", true);
                        try {
                            const atts = m.attachments;
                            if (Array.isArray(atts) || atts?.map) {
                                next = next.set("attachments", atts.map((a: any) => ((a.deleted = true), a)));
                            }
                        } catch { }
                        return next;
                    });
                }
            };
            if (isBulk) {
                for (const id of (data.ids ?? [])) mutate(id);
            } else {
                mutate(data.id);
            }
        } catch (e) {
            log.error("Error during handleStoreDelete", e);
        }
        return cache;
    },

    handleStoreDelete2(data: any, isBulk?: boolean) {
        try {
            const Internal: any = (MessageStoreInternal as any);
            const channelId = data.channelId ?? data.channel_id;
            const cache = Internal.get?.(channelId) ?? Internal.getOrCreate?.(channelId);
            if (!cache) return false;
            const singleId = data.id ?? data.messageId;
            const ids: string[] = isBulk ? (data.ids ?? []) : [singleId];
            if (!isBulk) {
                const present = typeof cache.has === "function" ? cache.has(singleId) : !!cache.get?.(singleId);
                if (!present) return false;
            }

            const EPHEMERAL = 64;
            // Keep all non-ephemeral, non-mlDeleted messages live (red) regardless of ignore settings.
            // This ensures pending applications (e.g. appy bot) stay visible when deleted on acceptance,
            // even if the user has ignoreBots/ignoreWebhooks enabled. Persistence to DB is still gated by shouldIgnore in the flux handler.
            let shouldKeepAny = false;
            for (const id of ids) {
                const msg = cache.get?.(id);
                if (!msg) continue;
                if (data.mlDeleted || (msg.flags & EPHEMERAL) === EPHEMERAL) continue;
                shouldKeepAny = true;
                break;
            }
            if (!shouldKeepAny) return false;

            let newCache: any = cache;
            for (const id of ids) {
                const msg = newCache.get?.(id);
                if (!msg) continue;
                if (data.mlDeleted || (msg.flags & EPHEMERAL) === EPHEMERAL) continue;
                try {
                    newCache = newCache.update(id, (m: any) => {
                        let next = m.set("deleted", true);
                        try {
                            const atts = m.attachments;
                            if (atts && typeof atts.map === "function") next = next.set("attachments", atts.map((a: any) => ((a.deleted = true), a)));
                        } catch { }
                        return next;
                    });
                } catch { }
            }
            if (newCache !== cache) {
                try { Internal.commit?.(newCache); } catch { try { (Internal as any).commit?.(newCache); } catch { } }
                return true;
            }
        } catch (e) {
            log.error("Error during handleStoreDelete2", e);
        }
        return false;
    },

    async start() {
        renderApi = await import("./render");

        if (isPluginEnabled("MessageLoggerEnhanced")) {
            Settings.plugins.MessageLoggerEnhanced.enabled = false;
            showToast("MessageLoggerEnhanced was disabled. Restart to activate MessageLoggerTestcord safely.", Toasts.Type.FAILURE);
            return;
        }

        if (!isPluginEnabled("MessageLogger")) {
            Settings.plugins.MessageLogger = Settings.plugins.MessageLogger ?? {};
            Settings.plugins.MessageLogger.enabled = true;
            showToast("MessageLogger is required by MessageLoggerTestcord. Restart to activate safely.", Toasts.Type.FAILURE);
            return;
        }

        if (settings.store.clearLogsOnRestart) {
            try {
                await clearAllLogs(true);
            } catch (e) {
                log.error("Failed to clear logs on restart", e);
            }
        }

        // Ensure a default attachment dir is cached for after-restart blob restores
        if (settings.store.saveImages) {
            void ensureDefaultDir().catch(() => { });
        }

        setupLoggerContextMenus();
        addChannelToolbarButton("testcord-ml-load-more", () => <LoadMoreButton />, 6);
        addChannelToolbarButton("testcord-ml-reload", () => <ReloadLogsButton />, 5);

        oldGetMessage = MessageStore.getMessage;
        MessageStore.getMessage = (channelId: string, messageId: string) => {
            // Respect temporary per-session hide of edit history (context menu → Delete History Temporary)
            // Must be checked before the cache lookup, because clearEditHistoryCache now keeps a
            // copy with empty history – we still want to hide the DB history.
            if (isEditHistoryTempCleared(messageId)) {
                const loggedMessageTmp = getCachedLoggedMessage(messageId);
                if (loggedMessageTmp?.deleted) {
                    // Deleted messages use hidden flag, not tempCleared – fall through to normal handling
                } else {
                    const latest = oldGetMessage!.call(MessageStore, channelId, messageId) as any;
                    // Discord's cached copy may still carry editHistory injected by
                    // processMessageFetch before the temp clear – strip it so the
                    // message renders without history.
                    if (latest?.editHistory?.length) {
                        try {
                            if (typeof latest.set === "function") return latest.set("editHistory", []);
                            return { ...latest, editHistory: [] };
                        } catch { }
                    }
                    return latest;
                }
            }

            const loggedMessage = getCachedLoggedMessage(messageId);

            if (!loggedMessage) {
                return oldGetMessage!.call(MessageStore, channelId, messageId);
            }

            if (loggedMessage.deleted && settings.store.showDeletedMessages) {
                void restoreAttachmentBlobs(loggedMessage.attachments).catch(() => { });
                return renderApi.messageJsonToMessageClass({ message: loggedMessage });
            }

            const latestMessage = oldGetMessage!.call(MessageStore, channelId, messageId) as any;

            // Reuse the cached merged object while the message hasn't been edited again
            const cachedMerge = mergedMessageCache.get(messageId);
            const latestEditTS = latestMessage?.editedTimestamp?.valueOf?.() ?? 0;
            if (cachedMerge && mergedEditTimestamps.get(messageId) === latestEditTS) {
                return renderApi.messageJsonToMessageClass({ message: cachedMerge });
            }

            const merged: any = { ...loggedMessage, ...(latestMessage ?? {}) } as unknown as LoggedMessage;
            // Preserve logger's edit history when Discord's fresh message has none (prevents flash-then-vanish on channel switch)
            if (Array.isArray((loggedMessage as any).editHistory) && (loggedMessage as any).editHistory.length) {
                const latestEH: any = (latestMessage as any)?.editHistory;
                if (!Array.isArray(latestEH) || latestEH.length === 0 || latestEH.length < (loggedMessage as any).editHistory.length) {
                    merged.editHistory = (loggedMessage as any).editHistory;
                }
            }
            if ((loggedMessage as any).deleted && !merged.deleted) merged.deleted = true;
            if ((loggedMessage as any).ghostPinged && !merged.ghostPinged) merged.ghostPinged = true;
            if ((loggedMessage as any).deletedTimestamp && !merged.deletedTimestamp) merged.deletedTimestamp = (loggedMessage as any).deletedTimestamp;

            // Anti-antilog: restore stripped media even after restart / stale MessageStore cache
            try {
                if (latestMessage) {
                    if (settings.store.preserveRemovedAttachments && Array.isArray(loggedMessage.attachments) && loggedMessage.attachments.length) {
                        const latestAtts: any[] = latestMessage.attachments ?? [];
                        if (!latestMessage.attachments || latestAtts.length < loggedMessage.attachments.length) {
                            const seen = new Set(latestAtts.map((a: any) => a?.id));
                            const loggedIds = new Set((loggedMessage.attachments as any[]).map((a: any) => a?.id));
                            // Replacement, not removal: a fresh attachment set means the old ones were
                            // swapped out — don't pile them back on.
                            const missing = latestAtts.some((a: any) => !loggedIds.has(a?.id))
                                ? []
                                : (loggedMessage.attachments as any[]).filter((a: any) => !seen.has(a?.id));
                            if (missing.length) {
                                void restoreAttachmentBlobs(missing as any).catch(() => { });
                                merged.attachments = latestAtts.length ? [...latestAtts, ...missing] : [...(loggedMessage.attachments as any[])];
                            } else if (!latestMessage.attachments) {
                                void restoreAttachmentBlobs(loggedMessage.attachments as any).catch(() => { });
                                merged.attachments = loggedMessage.attachments;
                            }
                        } else if ((merged.attachments as any[])?.some((a: any) => a?.path && !a?.blobUrl)) {
                            void restoreAttachmentBlobs(merged.attachments as any).catch(() => { });
                        }
                    }
                    // Only resurrect embeds if the message was actually edited/deleted (not for every
                    // auto-preview refresh). This prevents phantom embeds on non-edited messages.
                    const isEditedForEmbeds = !!(latestMessage?.editedTimestamp ?? (loggedMessage as any).editHistory?.length ?? (loggedMessage as any).deleted);
                    if (settings.store.preserveRemovedEmbeds && isEditedForEmbeds && Array.isArray(loggedMessage.embeds) && (loggedMessage.embeds as any[]).length) {
                        const latestEmbeds: any[] = latestMessage.embeds ?? [];
                        const oldEmbeds: any[] = loggedMessage.embeds as any[];
                        const stableFp = (e: any) => {
                            if (!e || typeof e !== "object") return String(e);
                            try {
                                return JSON.stringify({
                                    url: e.url, type: e.type, title: e.title, description: e.description,
                                    author: e.author?.name ?? e.author?.url, provider: e.provider?.name,
                                    fields: Array.isArray(e.fields) ? e.fields.map((f: any) => ({ name: f.name, value: f.value, inline: f.inline })) : undefined,
                                    footer: e.footer?.text, image: e.image?.url, thumbnail: e.thumbnail?.url, video: e.video?.url
                                });
                            } catch { return `${e?.type ?? ""}|${e?.url ?? ""}|${e?.title ?? ""}|${e?.description ?? ""}`; }
                        };
                        {
                            // If same URL but middle content (description/fields) stripped, restore it into latest embed instead of duplicating
                            const latestByUrl = new Map<string, any>();
                            for (const e of latestEmbeds) if (e?.url) latestByUrl.set(e.url, e);
                            let hasMergedMiddle = false;
                            for (const old of oldEmbeds) {
                                if (!old?.url) continue;
                                const match: any = latestByUrl.get(old.url);
                                if (!match) continue;
                                if (old.description && !match.description) { match.description = old.description; hasMergedMiddle = true; }
                                if (old.title && !match.title) { match.title = old.title; hasMergedMiddle = true; }
                                if (Array.isArray(old.fields) && old.fields.length && (!Array.isArray(match.fields) || !match.fields.length)) { match.fields = old.fields; hasMergedMiddle = true; }
                                if (old.author && !match.author) { match.author = old.author; hasMergedMiddle = true; }
                                if (old.footer?.text && !match.footer?.text) { match.footer = old.footer; hasMergedMiddle = true; }
                                if (old.provider && !match.provider) { match.provider = old.provider; hasMergedMiddle = true; }
                            }
                            const seen = new Set(latestEmbeds.map(stableFp));
                            // Same rule as the live path: resurrect only on pure removal. A fresh
                            // embed set is a legitimate replacement, not a strip.
                            const loggedSeen = new Set(oldEmbeds.map(stableFp));
                            const hasNewEmbeds = latestEmbeds.some((e: any) => !loggedSeen.has(stableFp(e)));
                            const missing = hasNewEmbeds ? [] : oldEmbeds.filter((e: any) => !seen.has(stableFp(e)));
                            if (missing.length) merged.embeds = latestEmbeds.length ? [...latestEmbeds, ...missing] : [...oldEmbeds];
                            else if (!latestMessage.embeds) merged.embeds = [...oldEmbeds];
                            else if (hasMergedMiddle) merged.embeds = [...latestEmbeds];
                        }
                        const SUPPRESS = 1 << 2;
                        const oldFlags = (loggedMessage as any).flags ?? 0;
                        const newFlags = latestMessage.flags ?? oldFlags;
                        if ((oldFlags & SUPPRESS) === 0 && (newFlags & SUPPRESS) !== 0) {
                            merged.flags = newFlags & ~SUPPRESS;
                            if (!merged.embeds || merged.embeds.length === 0) merged.embeds = oldEmbeds;
                        }
                    }
                    if (Array.isArray(merged.attachments) && merged.attachments.length) {
                        const needsBlob = (merged.attachments as any[]).some((a: any) => a?.path && !a?.blobUrl);
                        if (needsBlob) void restoreAttachmentBlobs(merged.attachments as any).catch(() => { });
                    }
                } else if (Array.isArray(merged.attachments) && merged.attachments.some((a: any) => a?.path)) {
                    void restoreAttachmentBlobs(merged.attachments as any).catch(() => { });
                }
            } catch { }

            mergedMessageCache.set(messageId, merged);
            mergedEditTimestamps.set(messageId, latestEditTS);
            renderApi.invalidateMessageClassCache(messageId);
            return renderApi.messageJsonToMessageClass({ message: merged as LoggedMessage });
        };

        startEngine();
    },

    stop() {
        removeLoggerContextMenus();
        removeChannelToolbarButton("testcord-ml-load-more");
        removeChannelToolbarButton("testcord-ml-reload");
        stopEngine();
        if (oldGetMessage) {
            MessageStore.getMessage = oldGetMessage;
            oldGetMessage = null;
        }
        mergedMessageCache.clear();
        mergedEditTimestamps.clear();
        channelAllDeleted.clear();
        channelAllEdited.clear();
        channelDeleteLimit.clear();
        channelWebhookLimit.clear();
        for (const t of channelCacheTimeout.values()) clearTimeout(t);
        channelCacheTimeout.clear();
        lastChannelFetch.clear();
        try { clearTempClearedEdits(); } catch { }
    },
});
