/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { SafeChooseImageCacheDir, SafeChooseLogsDir, SafeOpenAttachmentsFolder, SafeSaveLogsBackup } from "./settingsComponents";

const antilogPremiumEnabled = () => isPluginEnabled("AntilogPremium");
const silentDeleteOff = () => antilogPremiumEnabled() || !settings.store.enableSilentDelete;

export const settings = definePluginSettings({
    // Capture
    saveDeletes: {
        type: OptionType.BOOLEAN,
        description: "Save deleted messages.",
        default: true
    },
    saveEdits: {
        type: OptionType.BOOLEAN,
        description: "Save edited messages and their history.",
        default: true
    },
    saveGhostPings: {
        type: OptionType.BOOLEAN,
        description: "Save deleted messages that mentioned you as ghost pings.",
        default: true
    },
    notifyGhostPings: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when a ghost ping is captured.",
        default: true
    },
    cacheMessagesFromServers: {
        type: OptionType.BOOLEAN,
        description: "Log messages from all servers instead of only whitelisted ids and DMs.",
        default: true
    },
    alwaysLogDirectMessages: {
        type: OptionType.BOOLEAN,
        description: "Always log DMs.",
        default: true
    },
    alwaysLogCurrentChannel: {
        type: OptionType.BOOLEAN,
        description: "Always log the current channel. Blacklisted channels and users are still ignored.",
        default: true
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore messages by bots.",
        default: false
    },
    ignoreWebhooks: {
        type: OptionType.BOOLEAN,
        description: "Ignore messages by webhooks.",
        default: false
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Ignore messages by yourself.",
        default: false
    },
    ignoreMutedGuilds: {
        type: OptionType.BOOLEAN,
        description: "Messages in muted servers will not be logged.",
        default: false
    },
    ignoreMutedCategories: {
        type: OptionType.BOOLEAN,
        description: "Messages in channels belonging to muted categories will not be logged.",
        default: false
    },
    ignoreMutedChannels: {
        type: OptionType.BOOLEAN,
        description: "Messages in muted channels will not be logged.",
        default: false
    },
    whitelistedIds: {
        type: OptionType.STRING,
        description: "Whitelisted server, channel, or user IDs (comma separated).",
        default: ""
    },
    blacklistedIds: {
        type: OptionType.STRING,
        description: "Blacklisted server, channel, or user IDs (comma separated).",
        default: ""
    },

    // Display
    showDeletedMessages: {
        type: OptionType.BOOLEAN,
        description: "Show deleted messages inline in chat, tinted red.",
        default: true
    },
    showEditHistory: {
        type: OptionType.BOOLEAN,
        description: "Show edited history inline in chat with a hoverable tooltip of old content.",
        default: true
    },
    showLogsButton: {
        type: OptionType.BOOLEAN,
        description: "Show a message log button in the channel header.",
        default: true,
        restartNeeded: true
    },
    hideFromToolbox: {
        type: OptionType.BOOLEAN,
        description: "Hide this plugin from the Toolbox.",
        default: false
    },

    // Storage & maintenance
    maxEditHistory: {
        type: OptionType.NUMBER,
        description: "Maximum saved revisions per message. Set to 0 for no limit.",
        default: 50,
        isValid: (value: number) => value >= 0 ? true : "The edit history limit cannot be negative."
    },
    memoryCacheLimit: {
        type: OptionType.NUMBER,
        description: "Maximum number of recent messages kept in memory. Lower values save RAM; channel history is still loaded from the database on demand.",
        default: 500,
        isValid: (value: number) => value >= 100 ? true : "The memory cache limit must be at least 100."
    },
    batchDelayMs: {
        type: OptionType.NUMBER,
        description: "Delay used to group database writes into one transaction.",
        default: 250,
        isValid: (value: number) => value >= 50 && value <= 5000 ? true : "The batch delay must be between 50 and 5000 milliseconds."
    },
    messageLimit: {
        type: OptionType.NUMBER,
        description: "Maximum number of persistent logs. Set to 0 for no limit.",
        default: 10000,
        isValid: (value: number) => value >= 0 ? true : "The message limit cannot be negative."
    },
    retentionDays: {
        type: OptionType.NUMBER,
        description: "Remove logs older than this many days. Set to 0 to keep them indefinitely.",
        default: 0,
        isValid: (value: number) => value >= 0 ? true : "Retention days cannot be negative."
    },
    preserveCurrentChannel: {
        type: OptionType.BOOLEAN,
        description: "Keep the current channel when applying time-based retention.",
        default: true
    },
    maintenanceIntervalMinutes: {
        type: OptionType.NUMBER,
        description: "Minutes between database maintenance runs.",
        default: 10,
        isValid: (value: number) => value >= 1 ? true : "The maintenance interval must be at least one minute."
    },
    // Attachment saving (desktop only)
    saveImages: {
        type: OptionType.BOOLEAN,
        description: "Save deleted attachments to disk so they stay viewable after the CDN link expires.",
        default: false
    },
    imageCacheDir: {
        type: OptionType.STRING,
        description: "Folder for saved attachments. Empty uses Testcord's data folder. Pick with the button below.",
        default: ""
    },
    chooseImageCacheDir: {
        type: OptionType.COMPONENT,
        description: "Pick where deleted attachments are saved (any disk or folder)",
        component: SafeChooseImageCacheDir
    },
    openAttachmentsFolder: {
        type: OptionType.COMPONENT,
        description: "Open the attachment save folder",
        component: SafeOpenAttachmentsFolder
    },
    logsDir: {
        type: OptionType.STRING,
        description: "Preferred folder for log backups. Pick with the button below.",
        default: ""
    },
    chooseLogsDir: {
        type: OptionType.COMPONENT,
        description: "Pick a default folder for log backups",
        component: SafeChooseLogsDir
    },
    saveLogsBackup: {
        type: OptionType.COMPONENT,
        description: "Write every log to a .json file anywhere on disk",
        component: SafeSaveLogsBackup
    },
    attachmentSizeLimitInMegabytes: {
        type: OptionType.NUMBER,
        description: "Maximum attachment size in megabytes to save. Larger attachments are skipped.",
        default: 12,
        isValid: (value: number) => value >= 1 ? true : "The size limit must be at least 1 MB."
    },
    attachmentFileExtensions: {
        type: OptionType.STRING,
        description: "Comma separated list of file extensions to save. Set to none to block all attachment saving.",
        default: "png,jpg,jpeg,gif,webp,mp4,webm,mp3,ogg,wav"
    },

    // Silent delete (AntilogPremium-style)
    enableSilentDelete: {
        type: OptionType.BOOLEAN,
        description: "Add a Silent Delete option to your own messages that hides them from other message loggers while deleting.",
        default: false,
        hidden: antilogPremiumEnabled
    },
    silentDeleteMode: {
        type: OptionType.SELECT,
        description: "How Silent Delete evades other loggers before removing the message.",
        options: [
            { label: "Ghost edit then delete", value: "ghostEdit", default: true },
            { label: "Nonce replacement then delete", value: "nonce" },
            { label: "Direct delete", value: "direct" }
        ],
        hidden: silentDeleteOff
    },
    silentDeletePlaceholder: {
        type: OptionType.STRING,
        description: "Replacement text used by the Ghost Edit and Nonce modes.",
        default: "message deleted",
        hidden: silentDeleteOff
    },
    silentDeleteDelay: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds between replacement and delete (100-300 recommended).",
        default: 200,
        isValid: (value: number) => value >= 0 && value <= 2000 ? true : "The delay must be between 0 and 2000 milliseconds.",
        hidden: silentDeleteOff
    },
    purgeLocalOnSilentDelete: {
        type: OptionType.BOOLEAN,
        description: "Also remove silently deleted messages from these local logs so they never show in red.",
        default: true,
        hidden: silentDeleteOff
    },

    // Antilog (MLE-style): delete your own message and overwrite it in OTHER people's loggers
    hideFromOtherLoggers: {
        type: OptionType.BOOLEAN,
        description: "Add a Delete Message (Hide From Message Loggers) option to your own messages. Sends a nonce replacement after deleting so other loggers overwrite the captured content.",
        default: false
    },
    hideFromLoggersPlaceholder: {
        type: OptionType.STRING,
        description: "The replacement text other loggers end up capturing instead of your original message.",
        default: "message deleted",
        hidden: () => !settings.store.hideFromOtherLoggers
    },

    // Anti-antilog (merged from AntiAntilog)
    blockAntilogNonce: {
        type: OptionType.BOOLEAN,
        description: "Block the nonce based antilog exploit so antilogged messages still get logged as deletions here.",
        default: true
    },
    includeOwnMessages: {
        type: OptionType.BOOLEAN,
        description: "Apply anti-antilogging to your own messages when anti-antilogged. Keep off to avoid exposing yourself on stream.",
        default: false
    },
    preserveRemovedEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Keep embeds visible when someone removes them via edit, including website/link preview title, description, author, fields and images.",
        default: true
    },
    preserveRemovedAttachments: {
        type: OptionType.BOOLEAN,
        description: "Keep attachments visible when they are stripped from a message via edit.",
        default: true
    },
    logAntiAntilogActivity: {
        type: OptionType.BOOLEAN,
        description: "Log every blocked antilog attempt to the developer console.",
        default: false
    },

    // Logs modal
    sortNewest: {
        type: OptionType.BOOLEAN,
        description: "Sort logs by newest first by default.",
        default: true
    },
    clearLogsOnRestart: {
        type: OptionType.BOOLEAN,
        description: "Clear all logs when Discord restarts.",
        default: false
    },
    pageSize: {
        type: OptionType.NUMBER,
        description: "Number of logs loaded on each page.",
        default: 100,
        isValid: (value: number) => value >= 20 && value <= 500 ? true : "The page size must be between 20 and 500."
    },
    replaceOnImport: {
        type: OptionType.BOOLEAN,
        description: "Clear unprotected logs before importing a backup.",
        default: false
    }
});
