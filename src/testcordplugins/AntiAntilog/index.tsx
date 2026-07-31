/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { MessageStore, UserStore } from "@webpack/common";

const SUPPRESS_EMBEDS = 1 << 2;
const logger = new Logger("AntiAntilog");

const settings = definePluginSettings({
    blockNonceAntilog: {
        type: OptionType.BOOLEAN,
        description: "Block the nonce based antilog exploit so antilogged messages still show as deleted with their original content.",
        default: true
    },
    includeOwnMessages: {
        type: OptionType.BOOLEAN,
        description: "Apply anti-antilogging to your own messages when anti-antilogged.",
        default: false
    },
    preserveRemovedEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Keep image and video embeds visible when someone removes the embed from their message.",
        default: true
    },
    preserveRemovedAttachments: {
        type: OptionType.BOOLEAN,
        description: "Keep attachments visible when they are stripped from a message via edit.",
        default: true
    },
    logActivity: {
        type: OptionType.BOOLEAN,
        description: "Log every blocked antilog attempt to the developer console.",
        default: false
    }
});

interface IncomingMessage {
    id?: string;
    channel_id?: string;
    nonce?: string | null;
    author?: { id?: string; };
    flags?: number;
    embeds?: any[];
    attachments?: any[];
}

interface MessageCreateAction {
    type: string;
    channelId?: string;
    message: IncomingMessage;
    optimistic?: boolean;
}

interface MessageUpdateAction {
    type: string;
    message: IncomingMessage;
}

function isLegitimateOptimisticConfirmation(action: MessageCreateAction): boolean {
    if (action.optimistic) return true;

    const message = action?.message;
    const nonce = message?.nonce;
    const channelId = action.channelId ?? message?.channel_id;

    if (channelId && nonce) {
        const existing = MessageStore.getMessage(channelId, nonce) as any;
        // If the existing message in store is currently sending/pending, this is a legitimate send confirmation
        if (existing && (existing.state === "SENDING" || existing.isPending?.() === true)) {
            return true;
        }
    }

    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!currentUserId) return true;

    if (message?.author?.id === currentUserId && !settings.store.includeOwnMessages) {
        return true;
    }

    return false;
}

function maybeStripAntilogNonce(action: MessageCreateAction) {
    try {
        if (!settings.store.blockNonceAntilog) return;

        const message = action?.message;
        if (!message || !message.nonce) return;

        // If message.id is equal to nonce, this is an optimistic local message, not an antilog payload
        if (message.id === message.nonce) return;

        const channelId = action.channelId ?? message.channel_id;
        if (!channelId) return;

        if (isLegitimateOptimisticConfirmation(action)) return;

        const antilogNonce = message.nonce;

        // Strip nonce directly from the message object so MessageStore/MessageLogger see null
        message.nonce = null;
        delete message.nonce;

        if (settings.store.logActivity) {
            logger.info(`Blocked antilog nonce dedupe for ${channelId} (incoming ${message.id} → antilog nonce ${antilogNonce}).`);
        }
    } catch (error) {
        logger.error("Failed to evaluate incoming MESSAGE_CREATE for antilog.", error);
    }
}

function preserveRemovedMedia(action: MessageUpdateAction) {
    try {
        const newMsg = action?.message;
        if (!newMsg?.id || !newMsg?.channel_id) return;

        const old = MessageStore.getMessage(newMsg.channel_id, newMsg.id) as IncomingMessage | undefined;
        if (!old) return;

        let updated: IncomingMessage | null = null;
        const ensureClone = () => {
            if (!updated) updated = { ...newMsg };
            return updated;
        };

        if (settings.store.preserveRemovedEmbeds) {
            const oldEmbeds = old.embeds ?? [];
            if (oldEmbeds.length > 0) {
                const incomingEmbeds = newMsg.embeds;
                const oldFlags = old.flags ?? 0;
                const incomingFlags = newMsg.flags ?? oldFlags;
                const wasSuppressed = (oldFlags & SUPPRESS_EMBEDS) === SUPPRESS_EMBEDS;
                const nowSuppressed = (incomingFlags & SUPPRESS_EMBEDS) === SUPPRESS_EMBEDS;

                let removed: any[] = [];
                let baseEmbeds: any[] = incomingEmbeds ?? oldEmbeds;

                if (!wasSuppressed && nowSuppressed) {
                    removed = oldEmbeds;
                    baseEmbeds = incomingEmbeds ?? [];
                } else if (incomingEmbeds !== undefined && incomingEmbeds.length < oldEmbeds.length) {
                    const fingerprint = (e: any) => `${e?.type ?? ""}|${e?.url ?? ""}|${e?.timestamp ?? ""}`;
                    const seen = new Set(incomingEmbeds.map(fingerprint));
                    removed = oldEmbeds.filter(e => !seen.has(fingerprint(e)));
                    baseEmbeds = incomingEmbeds;
                }

                if (removed.length > 0) {
                    const target = ensureClone();
                    target.embeds = [...baseEmbeds, ...removed];
                    if (nowSuppressed) {
                        target.flags = incomingFlags & ~SUPPRESS_EMBEDS;
                    }

                    if (settings.store.logActivity) {
                        logger.info(`Restored ${removed.length} removed embed(s) for ${newMsg.channel_id}/${newMsg.id}.`);
                    }
                }
            }
        }

        if (settings.store.preserveRemovedAttachments) {
            const oldAttachments = old.attachments ?? [];
            const incomingAttachments = newMsg.attachments;

            if (incomingAttachments !== undefined && oldAttachments.length > incomingAttachments.length) {
                const seenIds = new Set(incomingAttachments.map(a => a?.id));
                const removed = oldAttachments.filter(a => !seenIds.has(a?.id));

                if (removed.length > 0) {
                    const target = ensureClone();
                    target.attachments = [...incomingAttachments, ...removed];

                    if (settings.store.logActivity) {
                        logger.info(`Restored ${removed.length} removed attachment(s) for ${newMsg.channel_id}/${newMsg.id}.`);
                    }
                }
            }
        }

        if (updated) {
            action.message = updated;
        }
    } catch (error) {
        logger.error("Failed to preserve removed media on MESSAGE_UPDATE.", error);
    }
}

export default definePlugin({
    name: "AntiAntilog",
    description: "Counters antilog plugins so deleted messages stay visible as deletions, and keeps removed image/video embeds and attachments from disappearing.(doesnt work on ur own msgs so u cant expose urself on stream)",
    tags: ["Privacy", "Utility", "Chat"],
    authors: [TestcordDevs.x2b],
    settings,

    maybeStripAntilogNonce,
    preserveRemovedMedia,

    patches: [
        {
            find: '"MessageStore"',
            replacement: [
                {
                    match: /(?<=MESSAGE_CREATE:function\((\i)\)\{)/,
                    replace: "$self.maybeStripAntilogNonce($1);",
                    predicate: () => settings.store.blockNonceAntilog
                },
                {
                    match: /(?<=MESSAGE_UPDATE:function\((\i)\)\{)/,
                    replace: "$self.preserveRemovedMedia($1);",
                    predicate: () => settings.store.preserveRemovedEmbeds || settings.store.preserveRemovedAttachments
                }
            ]
        }
    ]
});
