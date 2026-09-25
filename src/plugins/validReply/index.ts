/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordRequestCoordinator } from "@api/index";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Channel, Message, User } from "@vencord/discord-types";
import { findByCodeLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const enum ReferencedMessageState {
    Loaded,
    NotLoaded,
    Deleted
}

interface Reply {
    baseAuthor: User,
    baseMessage: Message;
    channel: Channel;
    referencedMessage: { state: ReferencedMessageState; };
    compact: boolean;
    isReplyAuthorBlocked: boolean;
}

const fetching = new Map<string, string>();
/** messageId -> earliest time another fetch may be attempted after a failed one. */
const retryAfter = new Map<string, number>();
const RETRY_COOLDOWN_MS = 5_000;
/** Entries are only read on the next hover, which may never come, so prune by size. */
const RETRY_MAP_MAX = 500;

function setRetryAfter(messageId: string, at: number) {
    if (retryAfter.size >= RETRY_MAP_MAX) {
        const now = Date.now();
        for (const [id, until] of retryAfter) {
            if (until <= now) retryAfter.delete(id);
        }
        while (retryAfter.size >= RETRY_MAP_MAX) {
            const oldest = retryAfter.keys().next().value;
            if (oldest === undefined) break;
            retryAfter.delete(oldest);
        }
    }
    retryAfter.set(messageId, at);
}

let ReplyStore: any;

const createMessageRecord = findByCodeLazy(".createFromServer(", ".isBlockedForMessage", "messageReference:");

export default definePlugin({
    name: "ValidReply",
    description: 'Fixes "Message could not be loaded" upon hovering over the reply',
    tags: ["Chat", "Utility"],
    authors: [Devs.newwares],
    patches: [
        {
            // Same find as in ReplyTimestamp
            find: "#{intl::REPLY_QUOTE_MESSAGE_NOT_LOADED}",
            replacement: {
                match: /#{intl::REPLY_QUOTE_MESSAGE_NOT_LOADED}\)/,
                replace: "$&,onMouseEnter:()=>$self.fetchReply(arguments[0])"
            }
        },
        {
            find: "ReferencedMessageStore",
            replacement: [
                {
                    match: /_channelCaches=new Map;/,
                    replace: "$&_=$self.setReplyStore(this);"
                }
            ]
        }
    ],

    setReplyStore(store: any) {
        ReplyStore = store;
    },

    async fetchReply(reply: Reply) {
        const { channel_id: channelId, message_id: messageId } = reply.baseMessage.messageReference!;

        const retryAt = retryAfter.get(messageId);
        if (retryAt !== undefined) {
            if (Date.now() < retryAt) return;
            retryAfter.delete(messageId);
        }

        if (fetching.has(messageId)) {
            return;
        }
        fetching.set(messageId, channelId);

        TestcordRequestCoordinator.fetchMessageAround(channelId, messageId)
            .then((reply: Message | undefined) => {
                if (!reply) return;

                if (reply.id !== messageId) {
                    ReplyStore.set(channelId, messageId, {
                        state: ReferencedMessageState.Deleted
                    });

                    FluxDispatcher.dispatch({
                        type: "MESSAGE_DELETE",
                        channelId: channelId,
                        message: messageId
                    });
                } else {
                    ReplyStore.set(reply.channel_id, reply.id, {
                        state: ReferencedMessageState.Loaded,
                        message: createMessageRecord(reply)
                    });

                    FluxDispatcher.dispatch({
                        type: "MESSAGE_UPDATE",
                        message: reply
                    });
                }
            })
            .catch(() => {
                // Nothing was resolved, so the "not loaded" placeholder stays and can be
                // hovered again. Hold a short cooldown before allowing another attempt,
                // otherwise enter/leave/enter re-requests on every pass. A successful
                // fetch flips the placeholder to Loaded or Deleted, so it never re-hovers.
                setRetryAfter(messageId, Date.now() + RETRY_COOLDOWN_MS);
            })
            .finally(() => {
                fetching.delete(messageId);
            });
    }
});
