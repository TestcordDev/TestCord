/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { addMessagePopoverButton as addButton, removeMessagePopoverButton as removeButton } from "@api/MessagePopover";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, FluxDispatcher, Menu, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    accentColor: {
        type: OptionType.STRING,
        description: "Accent color for the delete icon (hex code).",
        default: "#ed4245"
    },
    mode: {
        type: OptionType.SELECT,
        description: "AntiLog deletion method.",
        default: "ghostEdit",
        options: [
            { label: "Ghost Edit (Edit to placeholder then delete + purge locally)", value: "ghostEdit", default: true },
            { label: "Direct Delete (Instant server delete + purge locally)", value: "direct" },
            { label: "Nonce Overwrite (Send replacement with nonce then delete)", value: "nonce" },
        ]
    },
    replacementMessage: {
        type: OptionType.STRING,
        description: "Placeholder text to replace message with before deletion (for Ghost Edit / Nonce modes).",
        default: "ₓ"
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Delay in ms between edit/replacement and delete (recommended: 100-300).",
        default: 150
    },
    purgeLocalLoggers: {
        type: OptionType.BOOLEAN,
        description: "Completely purge the message from your own local MessageLogger & MLE so it never shows in red.",
        default: true
    },
    purgeInterval: {
        type: OptionType.NUMBER,
        description: "Delay in ms between each message deletion during /silentpurgeenhanced.",
        default: 500
    },
    maxPurgeCount: {
        type: OptionType.NUMBER,
        description: "Maximum number of messages to delete in /silentpurgeenhanced.",
        default: 100,
        min: 1,
        max: 999999
    }
});

const getAccentColor = () => settings.store.accentColor || "#ed4245";

const TrashIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={getAccentColor()}>
        <path d="M15 3.999V2H9V3.999H3V5.999H21V3.999H15Z" />
        <path d="M5 6.99902V18.999C5 20.101 5.897 20.999 7 20.999H17C18.103 20.999 19 20.101 19 18.999V6.99902H5ZM11 17H9V11H11V17ZM15 17H13V11H15V17Z" />
    </svg>
);

async function purgeLocalMessage(channelId: string, messageId: string) {
    if (!settings.store.purgeLocalLoggers) return;

    try {
        // 1. Tell local MessageLogger to completely drop the message rather than marking it deleted in red
        FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            channelId,
            id: messageId,
            mlDeleted: true
        });

        // 2. Also attempt to remove from MessageLoggerEnhanced IndexedDB if active
        const mleDb = await import("../../equicordplugins/messageLoggerEnhanced/db").catch(() => null);
        if (mleDb?.deleteMessageIDB) {
            await mleDb.deleteMessageIDB(messageId).catch(() => {});
        }
    } catch {
        // Ignore local purge failures
    }
}

async function antiLogDelete(channelId: string, messageId: string): Promise<boolean> {
    try {
        const { mode = "ghostEdit", replacementMessage = "ₓ", delay = 150 } = settings.store;

        if (mode === "ghostEdit") {
            // 1. Edit the message on the server first to replace content with placeholder
            await RestAPI.patch({
                url: Constants.Endpoints.MESSAGE(channelId, messageId),
                body: { content: replacementMessage }
            }).catch(() => {});

            await sleep(delay);

            // 2. Delete original message from Discord server
            await RestAPI.del({
                url: Constants.Endpoints.MESSAGE(channelId, messageId)
            });
        } else if (mode === "nonce") {
            // 1. Send replacement message with nonce = messageId
            const response = await RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channelId),
                body: {
                    content: replacementMessage,
                    nonce: messageId,
                    flags: 4096, // Silent message (suppress notifications)
                    tts: false,
                    mobile_network_type: "unknown"
                }
            });

            await sleep(delay);

            // 2. Delete original message
            await RestAPI.del({
                url: Constants.Endpoints.MESSAGE(channelId, messageId)
            });

            // 3. Delete replacement marker
            if (response?.body?.id) {
                await sleep(delay);
                await RestAPI.del({
                    url: Constants.Endpoints.MESSAGE(channelId, response.body.id)
                }).catch(() => {});
            }
        } else {
            // Direct delete mode
            await RestAPI.del({
                url: Constants.Endpoints.MESSAGE(channelId, messageId)
            });
        }

        // 3. Cleanly purge the message from your local MessageLogger / MLE so your client doesn't display it in red
        await purgeLocalMessage(channelId, messageId);

        return true;
    } catch (error: any) {
        console.error("[AntilogPremium] Error during AntiLog deletion:", error);
        showToast(
            error?.body?.message ? `AntiLog Delete failed: ${error.body.message}` : "AntiLog Delete failed",
            Toasts.Type.FAILURE
        );
        return false;
    }
}

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, { message }) => {
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!message || !currentUserId || message.author?.id !== currentUserId || message.deleted) return;

    const group = findGroupChildrenByChildId("delete", children) ?? children;
    group.push(
        <Menu.MenuItem
            id="tc-antilog-delete"
            label={<span style={{ color: getAccentColor() }}>AntiLog Delete</span>}
            action={() => void antiLogDelete(message.channel_id, message.id)}
            icon={TrashIcon}
        />
    );
};

export default definePlugin({
    name: "AntilogPremium",
    description: "Delete messages while hiding them from message loggers. Combines best anti-logging methods. (its made to replace AntiLog, SilentDelete, and MLE's silent delete at once)",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessagePopoverAPI", "CommandsAPI", "ContextMenuAPI"],
    settings,

    contextMenus: {
        "message": messageContextMenuPatch
    },

    commands: [
        {
            name: "silentpurgeenhanced",
            description: "Silently delete your recent messages in this channel (hides from message loggers)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{
                name: "count",
                description: "Number of messages to delete (1-100)",
                type: ApplicationCommandOptionType.INTEGER,
                required: true,
            }],
            execute: (opts, ctx) => {
                const count = opts.find(o => o.name === "count")?.value as unknown as number;
                const maxCount = settings.store.maxPurgeCount || 100;
                const actualCount = Math.min(count, maxCount);
                if (!actualCount || actualCount < 1) return;
                const channelId = ctx.channel.id;
                const currentUserId = UserStore.getCurrentUser()?.id;
                if (!currentUserId) {
                    sendBotMessage(channelId, { content: "User state not ready. Please try again in a moment." });
                    return;
                }
                (async () => {
                    try {
                        const userMessages: any[] = [];
                        let lastMessageId: string | undefined;
                        while (userMessages.length < actualCount) {
                            const response = await RestAPI.get({
                                url: Constants.Endpoints.MESSAGES(channelId),
                                query: { limit: 100, ...(lastMessageId && { before: lastMessageId }) }
                            });
                            const messages = response.body;
                            if (!messages?.length) break;
                            for (const msg of messages) {
                                if (msg.author?.id === currentUserId) {
                                    userMessages.push(msg);
                                    if (userMessages.length >= actualCount) break;
                                }
                            }
                            lastMessageId = messages[messages.length - 1].id;
                            if (messages.length < 100) break;
                            await sleep(100);
                        }
                        if (!userMessages.length) {
                            sendBotMessage(channelId, { content: "No messages found to delete." });
                            return;
                        }
                        const purgeInterval = settings.store.purgeInterval || 500;
                        let successCount = 0;
                        for (let i = 0; i < userMessages.length; i++) {
                            if (await antiLogDelete(channelId, userMessages[i].id)) successCount++;
                            if (i < userMessages.length - 1) await sleep(purgeInterval);
                        }
                        sendBotMessage(channelId, { content: `Successfully silently deleted ${successCount} message(s).` });
                    } catch (error) {
                        console.error("[AntilogPremium] Error during silent purge:", error);
                    }
                })();
            }
        }
    ],
    start() {
        addButton("AntilogPremium", msg => {
            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!currentUserId || msg.author?.id !== currentUserId || msg.deleted) return null;
            return {
                label: "AntiLog Delete",
                icon: TrashIcon,
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: () => void antiLogDelete(msg.channel_id, msg.id),
                dangerous: true
            };
        }, TrashIcon);
    },
    stop() {
        removeButton("AntilogPremium");
    }
});
