/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { addMessagePopoverButton as addButton, removeMessagePopoverButton as removeButton } from "@api/MessagePopover";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, FluxDispatcher, Menu, MessageActions, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    deleteOriginalMessage: {
        type: OptionType.BOOLEAN,
        description: "Delete the original server-side message after silent edit. If disabled, the original message will reappear after client reload.",
        default: true
    },
    deleteDelay: {
        type: OptionType.NUMBER,
        description: "Delay (in milliseconds) before deleting the original message.",
        default: 200
    },
    suppressNotifications: {
        type: OptionType.BOOLEAN,
        description: "Suppress notifications for the newly sent edited message (prevents pinging mentioned users).",
        default: true
    },
    accentColor: {
        type: OptionType.STRING,
        description: "Accent color for the Silent Edit icon (hex code).",
        default: "#ed4245"
    }
});

const getAccentColor = () => settings.store.accentColor || "#ed4245";

const SilentEditIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={getAccentColor()}>
        <path d="M19.2929 9.8299L19.9409 9.18278C21.353 7.77064 21.353 5.47197 19.9409 4.05892C18.5287 2.64678 16.2292 2.64678 14.817 4.05892L14.1699 4.70694L19.2929 9.8299ZM12.8962 5.97688L5.18469 13.6906L10.3085 18.813L18.0201 11.0992L12.8962 5.97688ZM4.11851 20.9704L8.75906 19.8112L4.18692 15.239L3.02678 19.8796C2.95028 20.1856 3.04028 20.5105 3.26349 20.7337C3.48669 20.9569 3.8116 21.046 4.11851 20.9704Z" />
    </svg>
);

const pendingSilentEdits = new Map<string, { channelId: string; message: any; }>();
let originalEditMessage: any = null;

async function handleSilentEditSubmit(channelId: string, messageId: string, content: string, originalMessage: any) {
    const { deleteOriginalMessage = true, deleteDelay = 200, suppressNotifications = true } = settings.store;

    const body: any = {
        content,
        nonce: messageId,
        flags: suppressNotifications ? 4096 : 0,
        mobile_network_type: "unknown",
        tts: false
    };

    const ref = originalMessage?.message_reference || originalMessage?.messageReference;
    if (ref?.message_id) {
        body.message_reference = {
            channel_id: ref.channel_id,
            message_id: ref.message_id,
            guild_id: ref.guild_id
        };
    }

    // 1. Post the new edited message content to Discord server
    await RestAPI.post({
        url: Constants.Endpoints.MESSAGES(channelId),
        body
    });

    if (deleteOriginalMessage) {
        await sleep(deleteDelay);

        // 2. Delete the original message from Discord's server
        await RestAPI.del({
            url: Constants.Endpoints.MESSAGE(channelId, messageId)
        }).catch(() => {});

        // 3. Purge the original message from local MessageLogger & MessageLoggerEnhanced so it doesn't show in red
        FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            channelId,
            id: messageId,
            mlDeleted: true
        });

        const mleDb = await import("../../equicordplugins/messageLoggerEnhanced/db").catch(() => null);
        if (mleDb?.deleteMessageIDB) {
            await mleDb.deleteMessageIDB(messageId).catch(() => {});
        }
    }
}

function startSilentEdit(channelId: string, message: any) {
    pendingSilentEdits.set(message.id, { channelId, message });

    // Open inline edit box in Discord UI
    if (typeof (MessageActions as any).startEditMessage === "function") {
        (MessageActions as any).startEditMessage(channelId, message.id, message.content);
    } else {
        FluxDispatcher.dispatch({
            type: "MESSAGE_START_EDIT",
            channelId,
            messageId: message.id,
            content: message.content
        });
    }
}

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, { message }) => {
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!message || !currentUserId || message.author?.id !== currentUserId || message.deleted) return;

    const group = findGroupChildrenByChildId("edit", children) ?? children;
    group.push(
        <Menu.MenuItem
            id="tc-silent-edit"
            label={<span style={{ color: getAccentColor() }}>Silent Edit</span>}
            action={() => startSilentEdit(message.channel_id, message)}
            icon={SilentEditIcon}
        />
    );
};

export default definePlugin({
    name: "SilentEdit",
    description: "\"Silently\" edit a message without showing the (edited) tag and bypass message loggers.",
    tags: ["Chat", "Privacy"],
    authors: [{ name: "Aurick", id: 1348025017233047634n }, TestcordDevs.nnenaza, TestcordDevs.x2b],
    dependencies: ["MessagePopoverAPI", "ContextMenuAPI"],
    settings,

    contextMenus: {
        "message": messageContextMenuPatch
    },

    start() {
        // Intercept MessageActions.editMessage so when the user presses Enter, we run our silent edit flow instead
        if (MessageActions && (MessageActions as any).editMessage && !originalEditMessage) {
            originalEditMessage = (MessageActions as any).editMessage;
            (MessageActions as any).editMessage = async function (channelId: string, messageId: string, contentObj: any) {
                if (pendingSilentEdits.has(messageId)) {
                    const pending = pendingSilentEdits.get(messageId)!;
                    pendingSilentEdits.delete(messageId);

                    // Cancel Discord's native inline editing UI
                    FluxDispatcher.dispatch({ type: "MESSAGE_END_EDIT", channelId });

                    const content = typeof contentObj === "string" ? contentObj : (contentObj?.content ?? "");
                    try {
                        await handleSilentEditSubmit(channelId, messageId, content, pending.message);
                    } catch (error: any) {
                        console.error("[SilentEdit] Error submitting silent edit:", error);
                        showToast("Silent Edit failed", Toasts.Type.FAILURE);
                    }
                    return;
                }

                return originalEditMessage.apply(this, arguments);
            };
        }

        addButton("SilentEdit", msg => {
            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!currentUserId || msg.author?.id !== currentUserId || msg.deleted) return null;

            return {
                label: "Silent Edit",
                icon: SilentEditIcon,
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: () => startSilentEdit(msg.channel_id, msg)
            };
        }, SilentEditIcon);
    },

    stop() {
        removeButton("SilentEdit");
        if (originalEditMessage && MessageActions) {
            (MessageActions as any).editMessage = originalEditMessage;
            originalEditMessage = null;
        }
        pendingSilentEdits.clear();
    }
});
