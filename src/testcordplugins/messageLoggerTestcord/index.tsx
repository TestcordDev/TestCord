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
import { Alerts, MessageStore, showToast, Toasts } from "@webpack/common";

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
    startEngine,
    stopEngine
} from "./engine";
import { importMleLogs, importMleSettings } from "./io";
import { openLogs } from "./LogsModal";
import { osintScanLoggedMessages } from "./osintBridge";
import { restoreAttachmentBlobs } from "./saveImage";
import { settings } from "./settings";
import type { FetchMessagesResponse, LoadMessagesPayload, LoggedMessage, MessageCreatePayload, MessageDeleteBulkPayload, MessageDeletePayload, MessageUpdatePayload } from "./types";
import { cl } from "./utils";

const log = new Logger("MessageLoggerTestcord");
const HEADER_SETTINGS = ["showLogsButton"] as const;

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
    if (!response.ok || response.body.length === 0) return;

    try {
        const oldestMessage = response.body[response.body.length - 1];
        const records = await getChannelLogsAfter(oldestMessage.channel_id, oldestMessage.timestamp);
        response.body.extra = records.map(record => record.message);
    } catch (error) {
        log.error("Failed to restore persistent logs into the channel.", error);
    }
}

function mergeLoadedMessages(messages: LoggedMessage[] & { extra?: LoggedMessage[]; }, payload: LoadMessagesPayload) {
    if (!messages.extra?.length || messages.length === 0) return messages;

    const oldestTimestamp = messages[messages.length - 1].timestamp;
    const newestTimestamp = messages[0].timestamp;
    const includeNewer = !payload.hasMoreAfter && !payload.isBefore;
    const includeOlder = !payload.hasMoreBefore && !payload.isAfter;
    const knownIds = new Set(messages.map(message => message.id));
    const extra = messages.extra.filter(message =>
        !knownIds.has(message.id)
        && (includeNewer || message.timestamp <= newestTimestamp)
        && (includeOlder || message.timestamp >= oldestTimestamp)
    );

    messages.push(...extra);
    messages.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    return messages;
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
