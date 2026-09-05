/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { HeaderBarButton } from "@api/HeaderBar";
import { isPluginEnabled } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { LogsIcon } from "@components/Icons";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Alerts, MessageActions, MessageStore, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

import { removeLoggerContextMenus, setupLoggerContextMenus } from "./contextMenu";
import { getAllEditedForChannel, getChannelEditedLogsAfter, getChannelLogsAfter, getDatabase } from "./db";
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
    maybeStripAntilogNonce,
    mergedEditTimestamps as mergedEditTimestampsRef,
    mergedMessageCache as mergedMessageCacheRef,
    preserveRemovedMedia,
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

    return <HeaderBarButton tooltip="Open MessageLoggerTestcord" icon={LogsIcon} onClick={() => openLogs()} />;
}

async function processMessageFetch(response: FetchMessagesResponse) {
    if (!response.ok || !Array.isArray(response.body)) return;

    try {
        if (response.body.length === 0) {
            const channelId = SelectedChannelStore.getChannelId();
            if (!channelId) return;
            // Empty channel (all deleted) – load all deleted for this channel
            let records = channelAllDeleted.get(channelId);
            if (!records) {
                records = await getChannelLogsAfter(channelId, new Date(0).toISOString());
                if (records.length) {
                    channelAllDeleted.set(channelId, records);
                    try { cacheChannelMessages(records); } catch { }
                }
            }
            if (records?.length) {
                for (const rec of records) {
                    if (rec.message.attachments?.length) {
                        try { await restoreAttachmentBlobs(rec.message.attachments as any); } catch { }
                    }
                }
                response.body.extra = records.map(record => record.message);
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
            if (allDeleted.length) {
                channelAllDeleted.set(channelId, allDeleted);
                try { cacheChannelMessages(allDeleted); } catch { }
            }
        }
        const ts = typeof oldestMessage.timestamp === "string" ? oldestMessage.timestamp : new Date(String(oldestMessage.timestamp)).toISOString();
        const windowRecords = await getChannelLogsAfter(channelId, ts);
        // Merge allDeleted (for initial) + window, dedup
        const seen = new Set<string>();
        const extra: typeof windowRecords = [];
        const source = allDeleted ?? [];
        for (const r of source) {
            if (!seen.has(r.message_id)) { seen.add(r.message_id); extra.push(r); }
        }
        for (const r of windowRecords) {
            if (!seen.has(r.message_id)) { seen.add(r.message_id); extra.push(r); }
        }
        if (extra.length) {
            // Cache any new window records that weren't in allDeleted (shouldn't happen, but just in case)
            try { cacheChannelMessages(extra); } catch { }
            for (const rec of extra) {
                if (rec.message.attachments?.length) {
                    try { await restoreAttachmentBlobs(rec.message.attachments as any); } catch { }
                }
            }
            response.body.extra = extra.map(record => record.message);
        } else {
            for (const rec of windowRecords) {
                if (rec.message.attachments?.length) {
                    try { await restoreAttachmentBlobs(rec.message.attachments as any); } catch { }
                }
            }
            response.body.extra = windowRecords.map(record => record.message);
        }
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
    if (!messages.extra?.length) return messages;
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
    messages.sort((left, right) => toMs(String(right.timestamp)) - toMs(String(left.timestamp)));
    return messages;
}

const lastChannelFetch = new Map<string, number>();
const channelAllDeleted = new Map<string, LogRecord[]>();
const channelAllEdited = new Map<string, LogRecord[]>();
const channelCacheTimeout = new Map<string, ReturnType<typeof setTimeout>>();
let lastSelectedChannelId: string | null = null;

function scheduleChannelUnload(channelId: string) {
    const existing = channelCacheTimeout.get(channelId);
    if (existing) clearTimeout(existing);
    const timeout = setTimeout(() => {
        // Unload if not currently viewing this channel
        if (SelectedChannelStore.getChannelId() !== channelId) {
            channelAllDeleted.delete(channelId);
            channelAllEdited.delete(channelId);
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
                    try { cacheChannelMessages(records); } catch { }
                    // Ensure saved attachments have blob URLs before injecting
                    for (const rec of records) {
                        if (rec.message.attachments?.length) {
                            try { await restoreAttachmentBlobs(rec.message.attachments as any); } catch { }
                        }
                    }
                    // Inject into MessageStore for immediate display
                    try {
                        const Internal: any = (MessageStoreInternal as any);
                        const cache = Internal.get?.(channelId) ?? Internal.getOrCreate?.(channelId);
                        if (cache) {
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
                        }
                    } catch { }
                }
            } catch { }
        })();
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
            }
        } catch { }
    }

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

export default definePlugin({
    name: "MessageLoggerTestcord",
    description: "The best of all loggers in one plugin. Logs deleted/edited messages with inline chat display, ghost ping detection, disk-saved attachments, silent delete, anti-antilog protection, search, protected logs and automatic maintenance.",
    authors: [TestcordDevs.x2b],
    tags: ["Chat", "Utility"],
    dependencies: ["HeaderBarAPI", "ContextMenuAPI"],
    settings,
    settingsAboutComponent: () => (
        <div>
            <p>MessageLoggerEnhanced must remain disabled while MessageLoggerTestcord is enabled. The Silent Delete options defer to AntilogPremium when that plugin is enabled. AntiAntilog is now merged into this plugin (nonce blocking and media preservation). Saved attachments from preserved messages are downloaded to disk and restored after restart, so you can disable the standalone AntiAntilog plugin.</p>
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
        MESSAGE_DELETE: handleMessageDelete as (payload: MessageDeletePayload) => void,
        MESSAGE_DELETE_BULK: handleMessageDeleteBulk as (payload: MessageDeleteBulkPayload) => void,
        CHANNEL_SELECT: handleChannelSelect as (payload: { channelId?: string; }) => void,
    },

    getDeleted(m1: any, m2: any) {
        const deleted = m2?.deleted ?? m1?.deleted;
        return settings.store.showDeletedMessages ? deleted : deleted != null ? false : deleted;
    },

    getEdited(m1: any, m2: any) {
        if (!settings.store.showEditHistory) return m2?.editHistory;
        const editHistory = m2?.editHistory ?? (m1?.editHistory?.length ? m1.editHistory.map(renderApi.mapTimestamp) : undefined);
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
            const ids: string[] = isBulk ? (data.ids ?? []) : [data.id];
            if (!isBulk && !cache.has?.(data.id)) return false;

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
                    if (latest) return latest;
                    return oldGetMessage!.call(MessageStore, channelId, messageId);
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
                            const missing = (loggedMessage.attachments as any[]).filter((a: any) => !seen.has(a?.id));
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
                            const missing = oldEmbeds.filter((e: any) => !seen.has(stableFp(e)));
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
        stopEngine();
        if (oldGetMessage) {
            MessageStore.getMessage = oldGetMessage;
            oldGetMessage = null;
        }
        mergedMessageCache.clear();
        mergedEditTimestamps.clear();
        channelAllDeleted.clear();
        channelAllEdited.clear();
        for (const t of channelCacheTimeout.values()) clearTimeout(t);
        channelCacheTimeout.clear();
        lastChannelFetch.clear();
        try { clearTempClearedEdits(); } catch { }
    },
});
