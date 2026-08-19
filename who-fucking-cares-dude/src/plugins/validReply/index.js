/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordRequestCoordinator } from "@api/index";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";
const fetching = new Map();
let ReplyStore;
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
    setReplyStore(store) {
        ReplyStore = store;
    },
    async fetchReply(reply) {
        const { channel_id: channelId, message_id: messageId } = reply.baseMessage.messageReference;
        if (fetching.has(messageId)) {
            return;
        }
        fetching.set(messageId, channelId);
        TestcordRequestCoordinator.fetchMessageAround(channelId, messageId)
            .then((reply) => {
            if (!reply)
                return;
            if (reply.id !== messageId) {
                ReplyStore.set(channelId, messageId, {
                    state: 2 /* ReferencedMessageState.Deleted */
                });
                FluxDispatcher.dispatch({
                    type: "MESSAGE_DELETE",
                    channelId: channelId,
                    message: messageId
                });
            }
            else {
                ReplyStore.set(reply.channel_id, reply.id, {
                    state: 0 /* ReferencedMessageState.Loaded */,
                    message: createMessageRecord(reply)
                });
                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    message: reply
                });
            }
        })
            .catch(() => { })
            .finally(() => {
            fetching.delete(messageId);
        });
    }
});
