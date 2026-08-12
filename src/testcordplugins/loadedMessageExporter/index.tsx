/*
 * OpenCord, a Discord client mod
 * Copyright (c) 2026 OpenCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { OpenCordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { saveFile } from "@utils/web";
import type { Channel, Message, MessageAttachment } from "@vencord/discord-types";
import { ChannelStore, Menu, MessageStore, showToast, Toasts } from "@webpack/common";

interface CompactAttachment {
    id: string;
    filename: string;
    url: string;
    size: number;
    contentType?: string;
}

interface CompactMessage {
    id: string;
    timestamp: string;
    editedTimestamp?: string;
    authorId: string;
    authorName: string;
    content: string;
    attachments?: CompactAttachment[];
    referencedMessageId?: string;
}

const settings = definePluginSettings({
    maxMessages: {
        type: OptionType.NUMBER,
        description: "Maximum number of currently loaded messages to export.",
        default: 500,
    },
    newestFirst: {
        type: OptionType.BOOLEAN,
        description: "Export newest loaded messages first instead of oldest first.",
        default: false,
    },
});

function getLimit(value: unknown) {
    return Math.max(1, Math.min(5000, typeof value === "number" ? Math.floor(value) : settings.store.maxMessages));
}

function dateToIso(value: Date | null | undefined): string | undefined {
    return value instanceof Date ? value.toISOString() : undefined;
}

function serializeAttachment(attachment: MessageAttachment): CompactAttachment {
    return {
        id: attachment.id,
        filename: attachment.filename,
        url: attachment.url,
        size: attachment.size,
        contentType: attachment.content_type,
    };
}

function serializeMessage(message: Message): CompactMessage {
    const attachments = message.attachments.map(serializeAttachment);
    const referencedMessageId = message.messageReference?.message_id;

    return {
        id: message.id,
        timestamp: message.timestamp.toISOString(),
        editedTimestamp: dateToIso(message.editedTimestamp),
        authorId: message.author.id,
        authorName: message.author.globalName ?? message.author.username,
        content: message.content,
        attachments: attachments.length ? attachments : undefined,
        referencedMessageId,
    };
}

function getLoadedMessages(channelId: string, limit: number, newestFirst: boolean) {
    const messages = MessageStore.getMessages(channelId)._array
        .filter(message => message.state === "SENT")
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (newestFirst) messages.reverse();
    return messages.slice(0, limit);
}

function sanitizeFilePart(value: string) {
    return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "channel";
}

function buildExportFile(channel: Channel, messages: Message[], newestFirst: boolean) {
    const exportedAt = new Date().toISOString();
    const payload = {
        exportedAt,
        source: "loaded-message-cache",
        note: "Only messages already loaded in the Discord client cache are included. No Discord history requests were made.",
        channel: {
            id: channel.id,
            guildId: channel.guild_id,
            name: channel.name,
        },
        order: newestFirst ? "newest-first" : "oldest-first",
        count: messages.length,
        messages: messages.map(serializeMessage),
    };
    const name = `${sanitizeFilePart(channel.name || channel.id)}-${exportedAt.replace(/[:.]/g, "-")}.json`;

    return new File([JSON.stringify(payload)], name, { type: "application/json" });
}

function exportLoadedMessages(channel: Channel, limit = settings.store.maxMessages, newestFirst = settings.store.newestFirst) {
    const messages = getLoadedMessages(channel.id, getLimit(limit), newestFirst);
    if (!messages.length) {
        showToast("No loaded messages found for this channel.", Toasts.Type.FAILURE);
        return 0;
    }

    saveFile(buildExportFile(channel, messages, newestFirst));
    showToast(`Exported ${messages.length} loaded messages.`, Toasts.Type.SUCCESS);
    return messages.length;
}

const ChannelContextMenuPatch: NavContextMenuPatchCallback = (children, props: { channel?: Channel; thread?: Channel; }) => {
    const targetChannel = props.thread ?? props.channel;
    if (!targetChannel) return;

    children.push(
        <Menu.MenuItem
            id="vc-loaded-message-exporter"
            label="Export Loaded Messages"
            action={() => exportLoadedMessages(targetChannel)}
        />
    );
};

export default definePlugin({
    name: "LoadedMessageExporter",
    description: "Export only messages already loaded in Discord without scraping channel history.",
    authors: [OpenCordDevs.MasuRii],
    tags: ["Chat", "Utility"],
    settings,
    contextMenus: {
        "channel-context": ChannelContextMenuPatch,
        "gdm-context": ChannelContextMenuPatch,
        "thread-context": ChannelContextMenuPatch,
    },
    commands: [
        {
            name: "exportloadedmessages",
            description: "Export currently loaded messages from this channel.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "limit",
                    description: "Maximum loaded messages to export.",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: false,
                },
                {
                    name: "newest-first",
                    description: "Export newest loaded messages first.",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false,
                },
            ],
            execute(args, ctx) {
                const channel = ChannelStore.getChannel(ctx.channel.id);
                const limit = findOption(args, "limit", settings.store.maxMessages);
                const newestFirst = findOption(args, "newest-first", settings.store.newestFirst);
                const count = exportLoadedMessages(channel, getLimit(limit), typeof newestFirst === "boolean" ? newestFirst : settings.store.newestFirst);

                sendBotMessage(ctx.channel.id, {
                    content: count ? `Exported ${count} loaded messages.` : "No loaded messages were available to export.",
                });
            },
        },
    ],
});
