/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildMemberStore, GuildStore, SelectedChannelStore, SelectedGuildStore, Toasts, UserStore } from "@webpack/common";

const ALARM_URL = "https://www.myinstants.com/media/sounds/nextel-walkie-talkie.mp3";
const STAFF_FLAG = 1;

const settings = definePluginSettings({
    volume: {
        type: OptionType.SLIDER,
        description: "Alert volume when Staff is detected.",
        default: 100,
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: false
    },
    playSound: {
        type: OptionType.BOOLEAN,
        description: "Play alert sound when Staff is detected.",
        default: true
    },
    autoScanOnJoin: {
        type: OptionType.BOOLEAN,
        description: "Automatically scan new members when they join and alert if they have the Discord Staff badge.",
        default: true
    }
});

function isStaff(user: any): boolean {
    if (!user) return false;
    try {
        if (typeof user.hasFlag === "function" && user.hasFlag(STAFF_FLAG)) return true;
    } catch { }
    const pf = user.publicFlags ?? user.public_flags ?? 0;
    const f = user.flags ?? 0;
    if (typeof pf === "bigint" || typeof f === "bigint") {
        const pfBig = typeof pf === "bigint" ? pf : BigInt(pf ?? 0);
        const fBig = typeof f === "bigint" ? f : BigInt(f ?? 0);
        if ((pfBig & 1n) === 1n) return true;
        if ((fBig & 1n) === 1n) return true;
        return false;
    }
    if ((pf & STAFF_FLAG) === STAFF_FLAG) return true;
    if ((f & STAFF_FLAG) === STAFF_FLAG) return true;
    return false;
}

function playAlert() {
    if (!settings.store.playSound) return;
    try {
        const audio = document.createElement("audio");
        audio.src = ALARM_URL;
        audio.volume = Math.max(0, Math.min(1, (settings.store.volume as number) / 100));
        audio.play().catch(() => { });
    } catch { }
}

function triggerStaffAlert(guildName: string, staff: Array<{ id: string; username: string; }>, channelId?: string) {
    if (!staff.length) return;
    playAlert();
    const names = staff.map(s => `${s.username} (${s.id})`).join(", ");
    const msg = `Staff found in ${guildName}: ${names}`;
    Toasts.show({
        message: msg,
        id: `staff-scanner-${Date.now()}`,
        type: Toasts.Type.FAILURE,
        options: {
            position: Toasts.Position.BOTTOM,
            duration: 6000
        }
    });

    if (channelId) {
        try {
            const content = staff.length === 1
                ? `🚨 Staff found in **${guildName}**\n<@${staff[0].id}> (${staff[0].username}) has Discord Staff badge.`
                : `🚨 Staff found in **${guildName}**\n${staff.map(s => `<@${s.id}> (${s.username})`).join("\n")}`;
            sendBotMessage(channelId, { content });
        } catch { }
    }
}

function getGuildIdForScan(ctx?: any): string | null {
    if (ctx?.guild?.id) return ctx.guild.id;
    if (ctx?.channel?.guild_id) return ctx.channel.guild_id;
    if (ctx?.channel?.guildId) return ctx.channel.guildId;
    try {
        const gid = SelectedGuildStore.getGuildId();
        if (gid) return gid;
    } catch { }
    try {
        const chId = SelectedChannelStore.getChannelId();
        if (chId) {
            const ch = ChannelStore?.getChannel?.(chId);
            if (ch?.guild_id) return ch.guild_id;
        }
    } catch { }
    return null;
}

function scanCurrentGuild(channelId: string, guildId: string) {
    const guild = GuildStore.getGuild(guildId);
    const guildName = guild?.name ?? "This server";

    let memberIds: string[] = [];
    try {
        const ids = GuildMemberStore.getMemberIds(guildId) as string[] | undefined;
        if (ids && Array.isArray(ids) && ids.length) memberIds = ids;
    } catch { }

    if (!memberIds.length) {
        try {
            const members = GuildMemberStore.getMembers(guildId) as any[];
            if (Array.isArray(members) && members.length) {
                memberIds = members.map(m => m?.userId ?? m?.user?.id ?? m?.id).filter(Boolean);
            }
        } catch { }
    }

    if (!memberIds.length) {
        sendBotMessage(channelId, { content: `No members cached for **${guildName}**. Try opening the member list first and run again.` });
        Toasts.show({
            message: `No members cached for ${guildName}.`,
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    sendBotMessage(channelId, { content: `Scanning **${guildName}** (${memberIds.length} members) for Discord Staff...` });

    const staff: Array<{ id: string; username: string; }> = [];
    for (const id of memberIds) {
        const user = UserStore.getUser(id);
        if (!user) continue;
        if (isStaff(user)) {
            staff.push({ id, username: (user as any).globalName ?? user.username ?? id });
        }
    }

    if (!staff.length) {
        sendBotMessage(channelId, { content: `No Discord Staff found in **${guildName}**. Scanned ${memberIds.length} members.` });
        Toasts.show({
            message: `No Staff found in ${guildName} (${memberIds.length} scanned).`,
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    triggerStaffAlert(guildName, staff, channelId);
}

export default definePlugin({
    name: "StaffScanner",
    description: "Scan server members for Discord Staff badge, alert with sound and toast. Also auto scans new members on join.",
    authors: [TestcordDevs.x2b],
    tags: ["Utility", "Servers"],
    settings,

    commands: [
        {
            name: "scans",
            description: "Scan every member in this server for Discord Staff badge.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_args, ctx) => {
                const channelId = ctx.channel.id;
                const guildId = getGuildIdForScan(ctx);
                if (!guildId) {
                    sendBotMessage(channelId, { content: "Please run this command inside a server." });
                    return;
                }
                scanCurrentGuild(channelId, guildId);
            }
        }
    ],

    flux: {
        GUILD_MEMBER_ADD(event: any) {
            if (!settings.store.autoScanOnJoin) return;
            const guildId: string | undefined = event.guildId ?? event.guild_id ?? event.member?.guildId ?? event.guild?.id;
            const userId: string | undefined = event.user?.id ?? event.userId ?? event.member?.userId;
            const guildName = (guildId ? GuildStore.getGuild(guildId)?.name : undefined) ?? (guildId ? `Server ${guildId}` : "a server");
            setTimeout(() => {
                let { user } = event;
                if (!user && userId) {
                    try { user = UserStore.getUser(userId); } catch { }
                }
                if (!user && userId) return;
                if (!isStaff(user)) return;
                const username = user.globalName ?? user.username ?? userId ?? "Unknown";
                const entryId = user.id ?? userId ?? "0";
                if (entryId === "0") return;
                playAlert();
                Toasts.show({
                    message: `Staff found in ${guildName}: ${username} (${entryId}) joined.`,
                    id: `staff-join-${entryId}-${Date.now()}`,
                    type: Toasts.Type.FAILURE,
                    options: { position: Toasts.Position.BOTTOM, duration: 6000 }
                });
                try {
                    const currentGuildId = SelectedGuildStore.getGuildId();
                    const currentChannelId = SelectedChannelStore.getChannelId();
                    if (currentGuildId && currentGuildId === guildId && currentChannelId) {
                        sendBotMessage(currentChannelId, {
                            content: `🚨 Staff joined **${guildName}**\n<@${entryId}> (${username}) has Discord Staff badge and just joined.`
                        });
                    }
                } catch { }
            }, 600);
        }
    }
});
