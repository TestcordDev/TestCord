/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

const logger = new Logger("GreedCmds");

const settings = definePluginSettings({
    enableProtectReadd: {
        type: OptionType.BOOLEAN,
        description: "Automatically re-add uwulock protect when someone removes it from you or protected users. Triggers on ,uwulock protect remove and sends ,uwulock protect add instantly.",
        default: true
    },
    enableUwulockRemove: {
        type: OptionType.BOOLEAN,
        description: "Automatically remove uwulock when someone applies it to you or protected users. Triggers on ,uwulock <@user> and sends ,uwulock remove <@user>.",
        default: true
    },
    enableCounterTo: {
        type: OptionType.BOOLEAN,
        description: "Counter attacks that target you or protected users with timeout. When someone uses ,uwulock, ,to, ,kick, ,ban or ,mute on you, automatically send ,to <@attacker> 60s.",
        default: true
    },
    counterDuration: {
        type: OptionType.NUMBER,
        description: "Duration in seconds for the counter ,to command.",
        default: 60
    },
    protectedUserIds: {
        type: OptionType.STRING,
        description: "Additional user IDs to protect (comma separated). Example: 123456789012345678, 987654321098765432",
        default: ""
    },
    allowedGuildIds: {
        type: OptionType.STRING,
        description: "Only run in these servers (comma separated guild IDs). Leave empty to run in all servers.",
        default: ""
    }
});

function parseIdList(value: string): Set<string> {
    const ids = new Set<string>();
    if (!value) return ids;
    for (const part of value.split(/[,\s]+/)) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        if (/^\d{5,22}$/.test(trimmed)) ids.add(trimmed);
    }
    return ids;
}

function getProtectedIds(): Set<string> {
    const ids = new Set<string>();
    const current = UserStore.getCurrentUser?.()?.id;
    if (current) ids.add(current);
    const extra = parseIdList(settings.store.protectedUserIds);
    for (const id of extra) ids.add(id);
    return ids;
}

function getAllowedGuildIds(): Set<string> | null {
    const raw = settings.store.allowedGuildIds?.trim();
    if (!raw) return null;
    const set = parseIdList(raw);
    if (set.size === 0) return null;
    return set;
}

function isTargeted(message: any, targetId: string): boolean {
    if (!message?.content || typeof message.content !== "string") return false;
    const { content } = message as { content: string; };
    if (Array.isArray(message.mentions) && message.mentions.some((m: any) => m?.id === targetId)) return true;
    if (content.includes(`<@${targetId}>`) || content.includes(`<@!${targetId}>`)) return true;
    if (content.includes(targetId) && new RegExp(`\\b${targetId}\\b`).test(content)) return true;
    return false;
}

function getTargetedIds(message: any, protectedIds: Set<string>): string[] {
    const out: string[] = [];
    for (const id of protectedIds) {
        if (isTargeted(message, id)) out.push(id);
    }
    return out;
}

function isGuildAllowed(guildId: string | undefined, allowed: Set<string> | null): boolean {
    if (!allowed) return true;
    if (!guildId) return false;
    return allowed.has(guildId);
}

function sendBotCommand(channelId: string, content: string) {
    if (!channelId || !content) return;
    try {
        logger.info(`Sending: ${content} in ${channelId}`);
        sendMessage(channelId, { content });
    } catch (e) {
        logger.error("Failed to send bot command", e);
    }
}

const PROTECT_REMOVE_RE = /^\s*,uwulock\s+protect\s+remove\b/i;
const UWULOCK_REMOVE_RE = /^\s*,uwulock\s+remove\b/i;
const ATTACK_PREFIXES = [
    /^\s*,uwulock\b/i,
    /^\s*,to\b/i,
    /^\s*,kick\b/i,
    /^\s*,ban\b/i,
    /^\s*,mute\b/i,
];

function isPlainUwulock(content: string): boolean {
    if (!/^\s*,uwulock\b/i.test(content)) return false;
    if (/protect/i.test(content)) return false;
    if (UWULOCK_REMOVE_RE.test(content)) return false;
    return true;
}

function handleMessage(message: any) {
    if (!message?.content || typeof message.content !== "string") return;
    if (!message.author?.id) return;
    if (!message.channel_id) return;

    const currentUserId = UserStore.getCurrentUser?.()?.id;
    if (!currentUserId) return;
    if (message.author.id === currentUserId) return;
    if (message.author.bot) return;

    const allowed = getAllowedGuildIds();
    if (!isGuildAllowed(message.guild_id, allowed)) return;

    const protectedIds = getProtectedIds();
    if (protectedIds.size === 0) return;

    const { content } = message as { content: string; };
    const targeted = getTargetedIds(message, protectedIds);

    // If no direct mention match, some commands may still target protected users via raw id
    // getTargetedIds already checks raw id, so empty means not targeting protected
    if (targeted.length === 0) return;

    const attackerId = message.author.id;
    const attackerMention = `<@${attackerId}>`;

    // 1. Protect re-add: ,uwulock protect remove <@target> -> ,uwulock protect add <@target>
    if (settings.store.enableProtectReadd && PROTECT_REMOVE_RE.test(content)) {
        for (const tid of targeted) {
            sendBotCommand(message.channel_id, `,uwulock protect add <@${tid}>`);
        }
    }

    // 2. Uwulock remove: ,uwulock <@target> -> ,uwulock remove <@target>
    if (settings.store.enableUwulockRemove && isPlainUwulock(content)) {
        for (const tid of targeted) {
            sendBotCommand(message.channel_id, `,uwulock remove <@${tid}>`);
        }
    }

    // 3. Counter timeout: ,uwulock/,to/,kick/,ban/,mute on protected -> ,to <@attacker> 60s
    if (settings.store.enableCounterTo) {
        const isAttack = ATTACK_PREFIXES.some(re => re.test(content));
        if (isAttack) {
            const duration = Math.max(1, Number(settings.store.counterDuration) || 60);
            // avoid sending multiple counters for same message
            sendBotCommand(message.channel_id, `,to ${attackerMention} ${duration}s`);
        }
    }
}

export default definePlugin({
    name: "GreedCmds",
    description: "Greed bot auto defense. Re-adds uwulock protect, removes uwulock, and counters kick/ban/mute/to attacks with timeout. Supports protected users and allowed servers filtering.",
    authors: [TestcordDevs.SirPhantom89],
    settings,

    flux: {
        MESSAGE_CREATE(data: any) {
            const message = data?.message ?? data;
            if (message) handleMessage(message);
        }
    }
});
