/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findByCodeLazy, findLazy } from "@webpack";
import { GuildStore } from "@webpack/common";
import { settings } from "./settings";
export const isWebhook = (message, user) => {
    const isFollowed = message?.type === 0 && !!message?.messageReference && !settings.store.showWebhookTagFully;
    return !!message?.webhookId && user.isNonUserBot() && !isFollowed;
};
export const tags = [
    {
        name: "WEBHOOK",
        displayName: "Webhook",
        description: "Messages sent by webhooks",
        condition: isWebhook
    }, {
        name: "OWNER",
        displayName: "Owner",
        description: "Owns the server",
        condition: (_, user, channel) => GuildStore.getGuild(channel?.guild_id)?.ownerId === user.id
    }, {
        name: "ADMINISTRATOR",
        displayName: "Admin",
        description: "Has the administrator permission",
        permissions: ["ADMINISTRATOR"]
    }, {
        name: "MODERATOR_STAFF",
        displayName: "Staff",
        description: "Can manage the server, channels or roles",
        permissions: ["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"]
    }, {
        name: "MODERATOR",
        displayName: "Mod",
        description: "Can manage messages or kick/ban people",
        permissions: ["MANAGE_MESSAGES", "KICK_MEMBERS", "BAN_MEMBERS"]
    }, {
        name: "VOICE_MODERATOR",
        displayName: "VC Mod",
        description: "Can manage voice chats",
        permissions: ["MOVE_MEMBERS", "MUTE_MEMBERS", "DEAFEN_MEMBERS"]
    }, {
        name: "CHAT_MODERATOR",
        displayName: "Chat Mod",
        description: "Can timeout people",
        permissions: ["MODERATE_MEMBERS"]
    }
];
export const Tag = findLazy(m => m.Types?.[0] === "BOT");
// PermissionStore.computePermissions will not work here since it only gets permissions for the current user
export const computePermissions = findByCodeLazy(".getCurrentUser()", ".computeLurkerPermissionsAllowList()");
