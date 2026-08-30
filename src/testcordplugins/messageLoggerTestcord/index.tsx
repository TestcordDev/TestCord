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
import { Alerts, ChannelStore, MessageActions, MessageStore, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

import { removeLoggerContextMenus, setupLoggerContextMenus } from "./contextMenu";
import { getChannelLogsAfter, getDatabase } from "./db";
import {
    clearAllLogs,
    getCachedLoggedMessage,
    handleMessageCreate,
    handleMessageDelete,
    handleMessageDeleteBulk,
    handleMessageUpdate,
    mergedEditTimestamps as mergedEditTimestampsRef,
    mergedMessageCache as mergedMessageCacheRef,
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
import type { FetchMessagesResponse, LoadMessagesPayload, LoggedMessage, MessageCreatePayload, MessageDeleteBulkPayload, MessageDeletePayload, MessageUpdatePayload } from "./types";
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
            const records = await getChannelLogsAfter(channelId, new Date(0).toISOString());
            if (records.length) response.body.extra = records.map(record => record.message);
            return;
        }
        const oldestMessage = response.body[response.body.length - 1];
        if (!oldestMessage?.channel_id || oldestMessage?.timestamp == null) return;
        // Normalize timestamp to string; getChannelLogsAfter handles Date conversion and hidden filtering
        const ts = typeof oldestMessage.timestamp === "string" ? oldestMessage.timestamp : new Date(String(oldestMessage.timestamp)).toISOString();
        const records = await getChannelLogsAfter(oldestMessage.channel_id, ts);
        response.body.extra = records.map(record => record.message);
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

function handleChannelSelect(payload: { channelId?: string; }) {
    const channelId = payload?.channelId;
    if (channelId == null) return;
    // Only refetch if we have fetched this channel before and have logged messages for it.
    const collection = (MessageStore as any).getMessages?.(channelId);
    if (!collection?.hasFetched) return;
    const now = Date.now();
    const last = lastChannelFetch.get(channelId) ?? 0;
    if (now - last < 30_000) return;
    // Check if we have any non-hidden deleted/ghost logs for this channel to avoid spamming empty fetches
    void getChannelLogsAfter(channelId, new Date(0).toISOString()).then(records => {
        if (records.length === 0) return;
        lastChannelFetch.set(channelId, now);
        try {
            (MessageActions as any).fetchMessages?.({ channelId, limit: 50 });
        } catch {}
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
            <p>MessageLoggerEnhanced must remain disabled while MessageLoggerTestcord is enabled. The Silent Delete options defer to AntilogPremium, and the antilog protections defer to AntiAntilog when those plugins are enabled.</p>
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
            find: "MESSAGE_DELETE:function",
            replacement: [
                {
                    match: /MESSAGE_DELETE:function\((\i)\)\{/,
                    replace: "MESSAGE_DELETE:function($1){if($self.handleStoreDelete2($1))return;"
                }
            ]
        },
        {
            find: "MESSAGE_DELETE_BULK:function",
            replacement: {
                match: /MESSAGE_DELETE_BULK:function\((\i)\)\{/,
                replace: "MESSAGE_DELETE_BULK:function($1){if($self.handleStoreDelete2($1,true))return;"
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

    flux: {
        MESSAGE_CREATE: handleMessageCreate as (payload: MessageCreatePayload) => void,
        MESSAGE_UPDATE: handleMessageUpdate as (payload: MessageUpdatePayload) => void,
        MESSAGE_DELETE: handleMessageDelete as (payload: MessageDeletePayload) => void,
        MESSAGE_DELETE_BULK: handleMessageDeleteBulk as (payload: MessageDeleteBulkPayload) => void,
        CHANNEL_SELECT: handleChannelSelect as (payload: { channelId?: string }) => void,
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
                } catch {}
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
                        } catch {}
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
                        } catch {}
                        return next;
                    });
                } catch {}
            }
            if (newCache !== cache) {
                try { Internal.commit?.(newCache); } catch { try { (Internal as any).commit?.(newCache); } catch {} }
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
            const loggedMessage = getCachedLoggedMessage(messageId);

            if (!loggedMessage) {
                return oldGetMessage!.call(MessageStore, channelId, messageId);
            }

            if (loggedMessage.deleted && settings.store.showDeletedMessages) {
                void restoreAttachmentBlobs(loggedMessage.attachments).catch(() => { });
                return renderApi.messageJsonToMessageClass({ message: loggedMessage });
            }

            const latestMessage = oldGetMessage!.call(MessageStore, channelId, messageId) as any;

            // Honor manual clears of edit history on the store message
            if (latestMessage && Array.isArray(latestMessage.editHistory) && latestMessage.editHistory.length === 0 && (loggedMessage.editHistory?.length ?? 0) > 0) {
                renderApi.invalidateMessageClassCache(messageId);
                mergedMessageCache.delete(messageId);
                mergedEditTimestamps.delete(messageId);
                return latestMessage;
            }

            // Reuse the cached merged object while the message hasn't been edited again
            const cachedMerge = mergedMessageCache.get(messageId);
            const latestEditTS = latestMessage?.editedTimestamp?.valueOf?.() ?? 0;
            if (cachedMerge && mergedEditTimestamps.get(messageId) === latestEditTS) {
                return renderApi.messageJsonToMessageClass({ message: cachedMerge });
            }

            const merged = { ...loggedMessage, ...(latestMessage ?? {}) } as unknown as LoggedMessage;
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
    },
});
