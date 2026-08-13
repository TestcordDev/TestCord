/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { TestcordRequestCoordinator } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { FormSwitch } from "@components/FormSwitch";
import { TestcordDevs } from "@utils/constants";
import { getUniqueUsername } from "@utils/discord";
import { sleep } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import type { GuildMember, User } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { Button, ChannelStore, ContextMenuApi, Forms, GuildMemberStore, GuildRoleStore, GuildStore, Menu, MessageStore, PresenceStore, React, ScrollerThin, Select, SelectedChannelStore, SelectedGuildStore, TabBar, Text, TextInput, Toasts, useEffect, useRef, UserProfileStore, UserStore, useState } from "@webpack/common";

const ChannelMemberStore = findStoreLazy("ChannelMemberStore") as {
    getProps(guildId?: string, channelId?: string): { groups: { count: number; id: string; }[]; };
};

export type ExportFormat = "html" | "txt" | "md" | "json" | "jsonl" | "csv" | "xml" | "yaml" | "bbcode";
export type ExportTab = "messages" | "memberlist" | "both";

export const settings = definePluginSettings({
    exportType: {
        type: OptionType.SELECT,
        description: "Default export view when opening the Exporter modal.",
        options: [
            { label: "Messages", value: "messages", default: true },
            { label: "Member List", value: "memberlist" },
            { label: "Both (All-in-One)", value: "both" },
        ]
    },
    chatFormat: {
        type: OptionType.SELECT,
        description: "Default format for message history exports.",
        options: [
            { label: "HTML", value: "html", default: true },
            { label: "TXT", value: "txt" },
            { label: "Markdown", value: "md" },
            { label: "JSON", value: "json" },
            { label: "JSONL", value: "jsonl" },
            { label: "CSV", value: "csv" },
            { label: "XML", value: "xml" },
            { label: "YAML", value: "yaml" },
            { label: "BBCode", value: "bbcode" },
        ]
    },
    memberFormat: {
        type: OptionType.SELECT,
        description: "Default format for member list exports.",
        options: [
            { label: "JSON", value: "json", default: true },
            { label: "CSV", value: "csv" },
            { label: "HTML", value: "html" },
            { label: "TXT", value: "txt" },
            { label: "Markdown", value: "md" },
            { label: "JSONL", value: "jsonl" },
            { label: "XML", value: "xml" },
            { label: "YAML", value: "yaml" },
            { label: "BBCode", value: "bbcode" },
        ]
    },
    includeProfileIcons: { type: OptionType.BOOLEAN, default: true, description: "Include avatar CDN links and profile icons." },
    includeProfileDetails: { type: OptionType.BOOLEAN, default: true, description: "Include bio, pronouns, badges, status, and creation dates." },
    includeRoles: { type: OptionType.BOOLEAN, default: true, description: "Include user roles, role colors, and role permissions." },
    includeDeletedMessages: { type: OptionType.BOOLEAN, default: true, description: "Include deleted messages from local cache / MessageLogger." },
    includeMedia: { type: OptionType.BOOLEAN, default: true, description: "Include image/video/audio attachments." },
    includeEmbeds: { type: OptionType.BOOLEAN, default: true, description: "Include link embeds." },
    includeReactions: { type: OptionType.BOOLEAN, default: true, description: "Include message reactions and stickers." },
    includeBots: { type: OptionType.BOOLEAN, default: true, description: "Include bot accounts in member list exports." },
    loadedOnly: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Export only messages already loaded in Discord instead of fetching the full history."
    },
    location: {
        type: OptionType.SELECT,
        description: "Where to display the export action buttons.",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "All locations", value: "all" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true
    }
});

// ── Badges Decoder ──
const BADGE_MAP: Array<[number, string]> = [
    [1 << 0, "Discord Staff"],
    [1 << 1, "Partnered Server Owner"],
    [1 << 2, "HypeSquad Events"],
    [1 << 3, "Bug Hunter Level 1"],
    [1 << 6, "HypeSquad Bravery"],
    [1 << 7, "HypeSquad Brilliance"],
    [1 << 8, "HypeSquad Balance"],
    [1 << 9, "Early Supporter"],
    [1 << 10, "Team Pseudo User"],
    [1 << 14, "Bug Hunter Level 2"],
    [1 << 16, "Verified Bot"],
    [1 << 17, "Early Verified Bot Developer"],
    [1 << 18, "Discord Certified Moderator"],
    [1 << 19, "Bot HTTP Interactions"],
    [1 << 22, "Active Developer"],
];

function decodeBadges(flags: number = 0): string[] {
    const badges: string[] = [];
    for (const [bit, label] of BADGE_MAP) {
        if ((flags & bit) === bit) badges.push(label);
    }
    return badges;
}

// ── Date & Snowflake Utilities ──
function getSnowflakeDate(id: string): Date {
    try {
        const ms = (BigInt(id) >> 22n) + 1420070400000n;
        return new Date(Number(ms));
    } catch {
        return new Date(0);
    }
}

function getAccountAgeDays(id: string): number {
    const created = getSnowflakeDate(id).getTime();
    if (!created) return 0;
    return Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
}

function getUserAvatarUrl(user: User, member?: GuildMember | null, guildId?: string): string {
    if (member?.avatar && guildId) {
        const ext = member.avatar.startsWith("a_") ? "gif" : "webp";
        return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.${ext}?size=256`;
    }
    if (user.avatar) {
        const ext = user.avatar.startsWith("a_") ? "gif" : "webp";
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
    }
    const disc = (user as any).discriminator;
    const index = disc && disc !== "0"
        ? Number(disc) % 5
        : Math.abs(Number((BigInt(user.id || "0") >> 22n) % 6n));
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function getUserBannerUrl(user: User, member?: GuildMember | null, guildId?: string): string | null {
    const memberBanner = (member as any)?.banner;
    if (memberBanner && guildId) {
        const ext = memberBanner.startsWith("a_") ? "gif" : "webp";
        return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/banners/${memberBanner}.${ext}?size=512`;
    }
    if (user.banner) {
        const ext = user.banner.startsWith("a_") ? "gif" : "webp";
        return `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${ext}?size=512`;
    }
    return null;
}

// ── Profile Serializer ──
export interface SerializedUser {
    id: string;
    username: string;
    globalName: string | null;
    displayName: string;
    nickname: string | null;
    discriminator: string;
    bot: boolean;
    system: boolean;
    avatarUrl: string;
    bannerUrl: string | null;
    createdAt: string;
    accountAgeDays: number;
    joinedAt: string | null;
    serverTenureDays: number | null;
    status: string;
    customStatus: string | null;
    activities: string[];
    badges: string[];
    roles: Array<{ id: string; name: string; color: number; colorHex: string; position: number; }>;
    highestRole: { name: string; colorHex: string; } | null;
    bio: string | null;
    pronouns: string | null;
}

function serializeUserFull(user: User, member?: GuildMember | null, guildId?: string): SerializedUser {
    const avatarUrl = getUserAvatarUrl(user, member, guildId);
    const bannerUrl = getUserBannerUrl(user, member, guildId);
    const createdAt = getSnowflakeDate(user.id);
    const accountAgeDays = getAccountAgeDays(user.id);

    let joinedAtDate: Date | null = null;
    let serverTenureDays: number | null = null;
    if (member?.joinedAt) {
        joinedAtDate = new Date(member.joinedAt);
        serverTenureDays = Math.floor((Date.now() - joinedAtDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    const status = PresenceStore.getStatus(user.id) || "offline";
    const activitiesRaw = PresenceStore.getActivities(user.id) || [];
    let customStatus: string | null = null;
    const activities: string[] = [];

    for (const act of activitiesRaw) {
        if (act.type === 4) {
            const emoji = act.emoji?.name ? `${act.emoji.name} ` : "";
            customStatus = `${emoji}${act.state ?? ""}`.trim() || null;
        } else if (act.name) {
            activities.push(act.name);
        }
    }

    const flags = (user.publicFlags ?? (user as any).flags ?? 0);
    const badges = decodeBadges(flags);

    const roles: Array<{ id: string; name: string; color: number; colorHex: string; position: number; }> = [];
    if (guildId && member?.roles) {
        for (const rId of member.roles) {
            const r = GuildRoleStore.getRole(guildId, rId);
            if (r) {
                const colorHex = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#99aab5";
                roles.push({ id: r.id, name: r.name, color: r.color, colorHex, position: r.position });
            }
        }
        roles.sort((a, b) => b.position - a.position);
    }

    const highestRole = roles.length ? { name: roles[0].name, colorHex: roles[0].colorHex } : null;

    let bio: string | null = null;
    let pronouns: string | null = null;
    try {
        const profile = UserProfileStore.getUserProfile(user.id);
        if (profile) {
            bio = profile.bio || null;
            pronouns = profile.pronouns || null;
        }
    } catch { }

    return {
        id: user.id,
        username: user.username,
        globalName: user.globalName ?? null,
        displayName: getUniqueUsername(user),
        nickname: member?.nick ?? null,
        discriminator: (user as any).discriminator ?? "0",
        bot: user.bot ?? false,
        system: (user as any).system ?? false,
        avatarUrl,
        bannerUrl,
        createdAt: createdAt.toISOString(),
        accountAgeDays,
        joinedAt: joinedAtDate ? joinedAtDate.toISOString() : null,
        serverTenureDays,
        status,
        customStatus,
        activities,
        badges,
        roles,
        highestRole,
        bio,
        pronouns
    };
}

// ── Rich Message Definition ──
export interface RichMessage {
    id: string;
    timestamp: string;
    editedAt?: string;
    authorId: string;
    authorName: string;
    authorAvatar: string | null;
    authorGlobalName?: string;
    content: string;
    attachments: Array<{ url: string; filename: string; size: number; contentType: string; }>;
    embeds: Array<{ title?: string; description?: string; url?: string; image?: string; type: string; }>;
    stickers: Array<{ name: string; id: string; }>;
    reactions: Array<{ emoji: string; count: number; }>;
    referencedMessage?: { id: string; authorName: string; content: string; };
    pinned: boolean;
    type: number;
    components: any[];
    deleted?: boolean;
}

function getToken(): string {
    try {
        const mod = (window as any).Vencord?.Webpack?.findByProps?.("getToken");
        return mod?.getToken?.() ?? "";
    } catch { return ""; }
}

async function getDeletedMessagesFromIDB(channelId: string): Promise<any[]> {
    try {
        const dbReq: IDBOpenDBRequest = indexedDB.open("MessageLoggerIDB", 1);
        const idb = await new Promise<IDBDatabase>((resolve, reject) => {
            dbReq.onsuccess = () => resolve(dbReq.result);
            dbReq.onerror = () => reject(dbReq.error);
            dbReq.onupgradeneeded = () => {
                dbReq.result.close();
                reject(new Error("DB not initialized"));
            };
        });

        const tx = idb.transaction("messages", "readonly");
        const store = tx.objectStore("messages");
        const index = store.index("by_channel_id");
        const req = index.getAll(channelId);

        const records: any[] = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        idb.close();
        return records.filter(r => r.status === "DELETED" || r.status === "GHOST_PINGED");
    } catch {
        return [];
    }
}

function fromCachedMessage(m: any, deleted: boolean): RichMessage {
    const ref = m.messageReference ?? m.referenced_message;
    return {
        id: m.id,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : (m.timestamp || new Date().toISOString()),
        editedAt: m.editedTimestamp instanceof Date ? m.editedTimestamp.toISOString() : (m.editedTimestamp || m.edited_timestamp),
        authorId: m.author?.id ?? "0",
        authorName: m.author?.globalName ?? m.author?.username ?? "Unknown",
        authorGlobalName: m.author?.globalName ?? undefined,
        authorAvatar: m.author?.avatar ?? null,
        content: m.content ?? "",
        attachments: (m.attachments ?? []).map((a: any) => ({
            url: a.url ?? a.oldUrl ?? "", filename: a.filename ?? "file", size: a.size ?? 0,
            contentType: a.content_type ?? "application/octet-stream",
        })),
        embeds: (m.embeds ?? []).map((e: any) => ({
            title: e.title, description: e.description, url: e.url,
            image: e.image?.url ?? e.thumbnail?.url, type: e.type ?? "rich",
        })),
        stickers: (m.sticker_items ?? m.stickerItems ?? m.stickers ?? []).map((s: any) => ({ name: s.name, id: s.id })),
        reactions: (m.reactions ?? []).map((r: any) => ({ emoji: r.emoji?.name ?? r.emoji?.id, count: r.count })),
        referencedMessage: ref ? {
            id: ref.message_id ?? ref.id ?? "0",
            authorName: ref.author?.username ?? "Unknown",
            content: (ref.content ?? "").slice(0, 100),
        } : undefined,
        pinned: m.pinned ?? false,
        type: m.type ?? 0,
        components: m.components ?? [],
        deleted,
    };
}

function getLoadedRichMessages(channelId: string): RichMessage[] {
    const cached = MessageStore.getMessages(channelId);
    const raw = Array.isArray(cached) ? cached : (cached._array ?? Object.values(cached));
    return raw
        .filter(m => m && m.state === "SENT" && !m.deleted && !m.mlDeleted)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map(m => fromCachedMessage(m, false));
}

async function fetchAllMessages(channelId: string, token: string, onProgress: (n: number) => void, signal?: AbortSignal): Promise<RichMessage[]> {
    const messageMap = new Map<string, RichMessage>();
    let beforeId: string | null = null;
    let count = 0;

    while (true) {
        if (signal?.aborted) break;
        let batch: any[];
        try {
            batch = await TestcordRequestCoordinator.request<any[]>({
                key: `discord:messages:${channelId}:before:${beforeId ?? ""}:limit:100`,
                ttlMs: 30_000,
                run: async () => {
                    const url = `https://discord.com/api/v9/channels/${channelId}/messages?limit=100${beforeId ? `&before=${beforeId}` : ""}`;
                    const res = await fetch(url, { headers: { Authorization: token }, signal });
                    if (!res.ok) return [];
                    const body = await res.json() as unknown;
                    return Array.isArray(body) ? body : [];
                },
                cacheable: Array.isArray,
            });
        } catch (e) {
            if (signal?.aborted) break;
            throw e;
        }
        if (signal?.aborted) break;
        if (!batch.length) break;

        for (const m of batch) {
            messageMap.set(m.id, {
                id: m.id,
                timestamp: m.timestamp,
                editedAt: m.edited_timestamp ?? undefined,
                authorId: m.author.id,
                authorName: m.author.global_name ?? m.author.username,
                authorGlobalName: m.author.global_name ?? undefined,
                authorAvatar: m.author.avatar ?? null,
                content: m.content ?? "",
                attachments: (m.attachments ?? []).map((a: any) => ({
                    url: a.url, filename: a.filename, size: a.size,
                    contentType: a.content_type ?? "application/octet-stream",
                })),
                embeds: (m.embeds ?? []).map((e: any) => ({
                    title: e.title, description: e.description, url: e.url,
                    image: e.image?.url ?? e.thumbnail?.url, type: e.type ?? "rich",
                })),
                stickers: (m.sticker_items ?? []).map((s: any) => ({ name: s.name, id: s.id })),
                reactions: (m.reactions ?? []).map((r: any) => ({ emoji: r.emoji.name ?? r.emoji.id, count: r.count })),
                referencedMessage: m.referenced_message ? {
                    id: m.referenced_message.id,
                    authorName: m.referenced_message.author?.username ?? "Unknown",
                    content: m.referenced_message.content?.slice(0, 100) ?? "",
                } : undefined,
                pinned: m.pinned ?? false,
                type: m.type ?? 0,
                components: m.components ?? [],
                deleted: false
            });
        }

        count += batch.length;
        onProgress(count);
        if (batch.length < 100) break;
        beforeId = batch[batch.length - 1].id;
        await sleep(250);
    }

    if (settings.store.includeDeletedMessages) {
        try {
            const cached = (findStoreLazy("MessageStore") as any)?.getMessages?.(channelId);
            if (cached) {
                const raw = Array.isArray(cached) ? cached : (cached._array ?? (typeof cached.toArray === "function" ? cached.toArray() : Object.values(cached)));
                for (const m of raw) {
                    if (m && (m.deleted || m.state === "DELETED" || m.mlDeleted) && !messageMap.has(m.id)) {
                        messageMap.set(m.id, fromCachedMessage(m, true));
                    }
                }
            }
        } catch { }

        try {
            const idbRecords = await getDeletedMessagesFromIDB(channelId);
            for (const record of idbRecords) {
                const m = record.message;
                if (!m || messageMap.has(record.message_id)) continue;
                messageMap.set(record.message_id, fromCachedMessage({ ...m, id: record.message_id }, true));
            }
        } catch { }
    }

    return Array.from(messageMap.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// ── Helpers ──
function getMediaType(url: string, ct: string): "image" | "video" | "audio" | "file" {
    if (ct.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(url)) return "image";
    if (ct.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url)) return "video";
    if (ct.startsWith("audio/") || /\.(mp3|ogg|wav|flac|m4a)(\?|$)/i.test(url)) return "audio";
    return "file";
}

function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeXml(str: any): string {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function escapeCsv(val: any): string {
    const s = String(val ?? "");
    return `"${s.replace(/"/g, '""')}"`;
}

function toYamlString(obj: any, indent = 0): string {
    const spaces = " ".repeat(indent);
    if (obj === null || obj === undefined) return "null";
    if (typeof obj === "boolean" || typeof obj === "number") return String(obj);
    if (typeof obj === "string") {
        if (obj.includes("\n") || obj.includes(":") || obj.includes("#") || obj.includes('"')) {
            return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
        }
        return obj || '""';
    }
    if (Array.isArray(obj)) {
        if (obj.length === 0) return "[]";
        return obj.map(item => `${spaces}- ${toYamlString(item, indent + 2).trimStart()}`).join("\n");
    }
    if (typeof obj === "object") {
        const keys = Object.keys(obj);
        if (keys.length === 0) return "{}";
        return keys.map(k => {
            const val = obj[k];
            if (typeof val === "object" && val !== null && !Array.isArray(val) && Object.keys(val).length > 0) {
                return `${spaces}${k}:\n${toYamlString(val, indent + 2)}`;
            }
            if (Array.isArray(val) && val.length > 0) {
                return `${spaces}${k}:\n${toYamlString(val, indent + 2)}`;
            }
            return `${spaces}${k}: ${toYamlString(val, indent + 2)}`;
        }).join("\n");
    }
    return String(obj);
}

// ── Generators for 9 Formats ──

// 1. MESSAGES BUILDERS
function buildMessagesHtml(messages: RichMessage[], channelName: string): string {
    const rows = messages.map(m => {
        const d = new Date(m.timestamp).toLocaleString();
        const edited = m.editedAt ? "<span class=\"edited\">(edited)</span>" : "";
        const pinned = m.pinned ? "<span class=\"pin\">[pinned]</span>" : "";
        const avatarUrl = m.authorAvatar
            ? `https://cdn.discordapp.com/avatars/${m.authorId}/${m.authorAvatar}.webp?size=32`
            : `https://cdn.discordapp.com/embed/avatars/${Math.abs(Number((BigInt(m.authorId || "0") >> 22n) % 6n))}.png`;
        const replyHtml = m.referencedMessage
            ? `<div class="reply"><b>${m.referencedMessage.authorName}</b>: ${escapeXml(m.referencedMessage.content)}</div>`
            : "";
        const mediaHtml = settings.store.includeMedia ? m.attachments.map(a => {
            const t_type = getMediaType(a.url, a.contentType);
            if (t_type === "image") return `<div class="media"><img src="${a.url}" alt="${escapeXml(a.filename)}" loading="lazy"><div class="media-name">${escapeXml(a.filename)} (${formatSize(a.size)})</div></div>`;
            if (t_type === "video") return `<div class="media"><video src="${a.url}" controls preload="none"></video><div class="media-name">${escapeXml(a.filename)}</div></div>`;
            if (t_type === "audio") return `<div class="media"><audio src="${a.url}" controls></audio><div class="media-name">${escapeXml(a.filename)}</div></div>`;
            return `<div class="attachment"><a href="${a.url}" target="_blank">${escapeXml(a.filename)}</a> <span class="size">${formatSize(a.size)}</span></div>`;
        }).join("") : "";
        const embedHtml = settings.store.includeEmbeds ? m.embeds.map(e => {
            let html = '<div class="embed">';
            if (e.title) html += `<div class="embed-title">${escapeXml(e.title)}</div>`;
            if (e.description) html += `<div class="embed-desc">${escapeXml(e.description.slice(0, 300))}</div>`;
            if (e.image) html += `<img src="${e.image}" class="embed-img" loading="lazy">`;
            if (e.url) html += `<a href="${e.url}" target="_blank" class="embed-url">${escapeXml(e.url)}</a>`;
            return html + "</div>";
        }).join("") : "";
        const stickerHtml = settings.store.includeReactions ? m.stickers.map(s => `<span class="sticker">${escapeXml(s.name)}</span>`).join("") : "";
        const reactHtml = (settings.store.includeReactions && m.reactions.length)
            ? `<div class="reactions">${m.reactions.map(r => `<span class="reaction">${escapeXml(r.emoji)} ${r.count}</span>`).join("")}</div>` : "";
        const content = m.content ? `<div class="content">${escapeXml(m.content).replace(/\n/g, "<br>")}</div>` : "";
        const msgClass = m.deleted ? "msg deleted" : "msg";
        return `<div class="${msgClass}">${replyHtml}<div class="msg-header">${settings.store.includeProfileIcons ? `<img src="${avatarUrl}" class="avatar">` : ""}<span class="author">${escapeXml(m.authorName)}</span><span class="ts">${d}</span>${edited}${pinned}</div>${content}${mediaHtml}${embedHtml}${stickerHtml}${reactHtml}</div>`;
    }).join("");

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Export — ${escapeXml(channelName)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#1e1f22;color:#dbdee1;font-family:system-ui,-apple-system,sans-serif;padding:20px;max-width:920px;margin:0 auto}h1{color:#5865f2;margin-bottom:4px}.meta{color:#949ba4;font-size:13px;margin-bottom:24px}.msg.deleted{background-color:rgba(240,71,71,0.1);border-left:2px solid #f04747}.msg{padding:10px 12px;border-radius:4px;margin-bottom:2px}.msg:hover{background:rgba(255,255,255,0.04)}.msg-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}.avatar{width:32px;height:32px;border-radius:50%}.author{font-weight:700;color:#f2f3f5;font-size:14px}.ts{font-size:11px;color:#949ba4;margin-left:4px}.edited,.pin{font-size:10px;color:#949ba4;margin-left:4px}.reply{font-size:12px;color:#949ba4;padding:4px 8px;border-left:3px solid #4f545c;margin-bottom:6px;background:rgba(255,255,255,0.03)}.content{font-size:14px;line-height:1.5;color:#dbdee1;white-space:pre-wrap;word-break:break-word;margin-bottom:4px}.media{margin:6px 0}.media img,.media video{max-width:420px;max-height:320px;border-radius:8px;display:block}.media-name{font-size:11px;color:#949ba4;margin-top:2px}.attachment{padding:6px 10px;background:rgba(0,0,0,0.2);border-radius:4px;margin:4px 0;display:inline-block}.attachment a{color:#00aff4;text-decoration:none}.embed{border-left:4px solid #5865f2;background:rgba(255,255,255,0.04);border-radius:0 4px 4px 0;padding:8px 12px;margin:6px 0}.embed-title{font-weight:700;color:#00aff4;margin-bottom:4px}.embed-desc{font-size:13px;color:#dbdee1}.embed-img{max-width:300px;border-radius:4px;margin-top:6px}.embed-url{font-size:12px;color:#00aff4;display:block;margin-top:4px;text-decoration:none}.sticker{font-size:12px;color:#b5bac1;background:rgba(255,255,255,0.06);border-radius:4px;padding:2px 6px;margin:2px}.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.reaction{background:rgba(255,255,255,0.08);border-radius:8px;padding:2px 8px;font-size:12px}audio{width:300px;margin-top:4px}</style>
</head><body><h1>${escapeXml(channelName)}</h1><p class="meta">Exported on ${new Date().toLocaleString()} · ${messages.length} messages</p>${rows}</body></html>`;
}

function buildMessagesTxt(messages: RichMessage[], channelName: string): string {
    const lines = [`=== Export Messages — ${channelName} ===`, `Exported on ${new Date().toLocaleString()}`, `Total: ${messages.length} messages`, ""];
    for (const m of messages) {
        const d = new Date(m.timestamp).toLocaleString();
        if (m.referencedMessage) lines.push(`  > [${m.referencedMessage.authorName}]: ${m.referencedMessage.content}`);
        lines.push(`[${d}]${m.editedAt ? " (edited)" : ""}${m.deleted ? " [DELETED]" : ""} ${m.authorName}: ${m.content}`);
        if (settings.store.includeMedia) {
            for (const a of m.attachments) lines.push(`  [${getMediaType(a.url, a.contentType).toUpperCase()}] ${a.filename} (${formatSize(a.size)}) — ${a.url}`);
        }
        if (settings.store.includeEmbeds) {
            for (const e of m.embeds) { if (e.url) lines.push(`  [LINK] ${e.title ?? "Embed"}: ${e.url}`); }
        }
        if (settings.store.includeReactions) {
            for (const s of m.stickers) lines.push(`  [STICKER] ${s.name}`);
            if (m.reactions.length) lines.push(`  ${m.reactions.map(r => `${r.emoji} x${r.count}`).join(" ")}`);
        }
    }
    return lines.join("\n");
}

function buildMessagesMd(messages: RichMessage[], channelName: string): string {
    const lines = [`# Export Messages — ${channelName}`, `> Exported on ${new Date().toLocaleString()} · **${messages.length} messages**`, ""];
    for (const m of messages) {
        const d = new Date(m.timestamp).toLocaleString();
        if (m.referencedMessage) lines.push(`> **${m.referencedMessage.authorName}**: ${m.referencedMessage.content}`);
        lines.push(`**${m.authorName}** — *${d}*${m.editedAt ? " *(edited)*" : ""}${m.pinned ? " *[pinned]*" : ""}${m.deleted ? " **[DELETED]**" : ""}`);
        if (m.content) lines.push(m.content);
        if (settings.store.includeMedia) {
            for (const a of m.attachments) lines.push(`[${a.filename}](${a.url}) *(${formatSize(a.size)})*`);
        }
        if (settings.store.includeEmbeds) {
            for (const e of m.embeds) { if (e.url) lines.push(`[${e.title ?? "Link"}](${e.url})`); }
        }
        if (settings.store.includeReactions) {
            for (const s of m.stickers) lines.push(`*Sticker: ${s.name}*`);
            if (m.reactions.length) lines.push(m.reactions.map(r => `${r.emoji} \`${r.count}\``).join(" "));
        }
        lines.push("");
    }
    return lines.join("\n");
}

function buildMessagesJson(messages: RichMessage[], channelName: string): string {
    return JSON.stringify({ channel: channelName, exportedAt: new Date().toISOString(), count: messages.length, messages }, null, 2);
}

function buildMessagesJsonl(messages: RichMessage[]): string {
    return messages.map(m => JSON.stringify(m)).join("\n");
}

function buildMessagesCsv(messages: RichMessage[]): string {
    const rows = [["ID", "Timestamp", "EditedAt", "AuthorID", "AuthorName", "Content", "Attachments", "Embeds", "Stickers", "Reactions", "ReplyTo", "Pinned", "Deleted"]];
    for (const m of messages) {
        rows.push([
            m.id, m.timestamp, m.editedAt ?? "", m.authorId, m.authorName, m.content,
            m.attachments.map(a => a.url).join("|"), m.embeds.map(e => e.url ?? e.title ?? "").join("|"),
            m.stickers.map(s => s.name).join("|"), m.reactions.map(r => `${r.emoji}:${r.count}`).join("|"),
            m.referencedMessage?.id ?? "", m.pinned ? "yes" : "no", m.deleted ? "yes" : "no"
        ]);
    }
    return rows.map(r => r.map(escapeCsv).join(",")).join("\n");
}

function buildMessagesXml(messages: RichMessage[], channelName: string): string {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<exporter type="messages">',
        `  <channel name="${escapeXml(channelName)}" exportedAt="${new Date().toISOString()}" count="${messages.length}"/>`,
        "  <messages>"
    ];
    for (const m of messages) {
        lines.push(`    <message id="${m.id}" timestamp="${m.timestamp}" authorId="${m.authorId}" authorName="${escapeXml(m.authorName)}" deleted="${m.deleted ? "true" : "false"}">`);
        lines.push(`      <content>${escapeXml(m.content)}</content>`);
        if (m.attachments.length) {
            lines.push("      <attachments>");
            for (const a of m.attachments) lines.push(`        <attachment filename="${escapeXml(a.filename)}" size="${a.size}" url="${escapeXml(a.url)}"/>`);
            lines.push("      </attachments>");
        }
        lines.push("    </message>");
    }
    lines.push("  </messages>", "</exporter>");
    return lines.join("\n");
}

function buildMessagesYaml(messages: RichMessage[], channelName: string): string {
    return toYamlString({
        exporter: {
            type: "messages",
            channelName,
            exportedAt: new Date().toISOString(),
            count: messages.length,
            messages
        }
    });
}

function buildMessagesBbcode(messages: RichMessage[], channelName: string): string {
    const lines = [`[b]Export Messages — ${channelName}[/b]`, `[i]Exported on ${new Date().toLocaleString()} · ${messages.length} messages[/i]`, ""];
    for (const m of messages) {
        const d = new Date(m.timestamp).toLocaleString();
        lines.push(`[b]${m.authorName}[/b] [color=#949ba4](${d})[/color]${m.deleted ? " [color=#f04747][DELETED][/color]" : ""}`);
        if (m.content) lines.push(m.content);
        if (settings.store.includeMedia) {
            for (const a of m.attachments) {
                if (getMediaType(a.url, a.contentType) === "image") lines.push(`[img]${a.url}[/img]`);
                else lines.push(`[url=${a.url}]${a.filename}[/url] (${formatSize(a.size)})`);
            }
        }
        lines.push("");
    }
    return lines.join("\n");
}

// 2. MEMBER LIST BUILDERS
function buildMembersHtml(members: SerializedUser[], title: string): string {
    const cards = members.map(m => {
        const roleTags = settings.store.includeRoles ? m.roles.map(r => `<span class="role-tag" style="border-color:${r.colorHex};color:${r.colorHex}">${escapeXml(r.name)}</span>`).join("") : "";
        const badgeTags = settings.store.includeProfileDetails ? m.badges.map(b => `<span class="badge-tag">${escapeXml(b)}</span>`).join("") : "";
        const statusClass = `status-${m.status}`;
        const bannerStyle = m.bannerUrl ? `background-image:url(${m.bannerUrl});background-size:cover;` : "";

        return `<div class="member-card">
  <div class="card-banner" style="${bannerStyle}"></div>
  <div class="card-header">
    <div class="avatar-wrap">
      ${settings.store.includeProfileIcons ? `<img src="${m.avatarUrl}" class="avatar">` : `<div class="avatar-ph">${escapeXml(m.displayName[0] ?? "?")}</div>`}
      <span class="status-dot ${statusClass}"></span>
    </div>
    <div class="user-names">
      <div class="display-name">${escapeXml(m.nickname || m.globalName || m.username)}${m.bot ? ' <span class="bot-tag">BOT</span>' : ""}</div>
      <div class="handle">@${escapeXml(m.username)} ${m.discriminator !== "0" ? `#${m.discriminator}` : ""} • ID: ${m.id}</div>
    </div>
  </div>
  <div class="card-body">
    ${m.customStatus ? `<div class="status-text">${escapeXml(m.customStatus)}</div>` : ""}
    ${m.bio && settings.store.includeProfileDetails ? `<div class="bio">${escapeXml(m.bio)}</div>` : ""}
    ${m.pronouns && settings.store.includeProfileDetails ? `<div class="meta-row"><b>Pronouns:</b> ${escapeXml(m.pronouns)}</div>` : ""}
    <div class="meta-row"><b>Created:</b> ${new Date(m.createdAt).toLocaleDateString()} (${m.accountAgeDays}d ago)</div>
    ${m.joinedAt ? `<div class="meta-row"><b>Joined:</b> ${new Date(m.joinedAt).toLocaleDateString()} (${m.serverTenureDays}d ago)</div>` : ""}
    ${badgeTags ? `<div class="badges-row">${badgeTags}</div>` : ""}
    ${roleTags ? `<div class="roles-row">${roleTags}</div>` : ""}
  </div>
</div>`;
    }).join("");

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Member List — ${escapeXml(title)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#111214;color:#dbdee1;font-family:system-ui,-apple-system,sans-serif;padding:24px;max-width:1200px;margin:0 auto}h1{color:#5865f2;margin-bottom:4px}.meta{color:#949ba4;font-size:13px;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}.member-card{background:#1e1f22;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column}.card-banner{height:60px;background:#2b2d31}.card-header{padding:0 14px;margin-top:-24px;display:flex;align-items:flex-end;gap:12px;margin-bottom:10px}.avatar-wrap{position:relative;width:56px;height:56px;flex-shrink:0}.avatar{width:56px;height:56px;border-radius:50%;border:4px solid #1e1f22;object-fit:cover}.avatar-ph{width:56px;height:56px;border-radius:50%;border:4px solid #1e1f22;background:#5865f2;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px}.status-dot{position:absolute;bottom:2px;right:2px;width:14px;height:14px;border-radius:50%;border:3px solid #1e1f22}.status-online{background:#23a55a}.status-idle{background:#f0b232}.status-dnd{background:#f23f43}.status-offline{background:#80848e}.user-names{overflow:hidden}.display-name{font-size:15px;font-weight:700;color:#f2f3f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.handle{font-size:11px;color:#949ba4}.bot-tag{background:#5865f2;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;font-weight:700;vertical-align:middle}.card-body{padding:0 14px 14px;display:flex;flex-direction:column;gap:6px;font-size:12px}.status-text{font-style:italic;color:#b5bac1;background:rgba(0,0,0,0.2);padding:4px 8px;border-radius:4px}.bio{background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:6px;color:#dbdee1;white-space:pre-wrap;word-break:break-word}.meta-row{color:#949ba4}.meta-row b{color:#b5bac1}.badges-row,.roles-row{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.badge-tag{background:rgba(88,101,242,0.15);color:#5865f2;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:600}.role-tag{border:1px solid;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;background:rgba(0,0,0,0.2)}</style>
</head><body><h1>${escapeXml(title)}</h1><p class="meta">Exported on ${new Date().toLocaleString()} · ${members.length} members</p><div class="grid">${cards}</div></body></html>`;
}

function buildMembersTxt(members: SerializedUser[], title: string): string {
    const lines = [`=== Member List — ${title} ===`, `Exported on ${new Date().toLocaleString()}`, `Total Members: ${members.length}`, ""];
    for (const m of members) {
        lines.push(`ID: ${m.id} | @${m.username}${m.nickname ? ` (Nick: ${m.nickname})` : ""} | Name: ${m.displayName}${m.bot ? " [BOT]" : ""}`);
        lines.push(`  Status: ${m.status}${m.customStatus ? ` (${m.customStatus})` : ""}`);
        lines.push(`  Created: ${m.createdAt} (${m.accountAgeDays} days ago)`);
        if (m.joinedAt) lines.push(`  Joined: ${m.joinedAt} (${m.serverTenureDays} days ago)`);
        if (m.roles.length) lines.push(`  Roles: ${m.roles.map(r => r.name).join(", ")}`);
        if (m.badges.length) lines.push(`  Badges: ${m.badges.join(", ")}`);
        lines.push("");
    }
    return lines.join("\n");
}

function buildMembersMd(members: SerializedUser[], title: string): string {
    const lines = [`# Member List — ${title}`, `> Exported on ${new Date().toLocaleString()} · **${members.length} members**`, ""];
    for (const m of members) {
        lines.push(`### ${m.displayName} (@${m.username}) ${m.bot ? "`[BOT]`" : ""}`);
        lines.push(`- **User ID:** \`${m.id}\``);
        lines.push(`- **Status:** \`${m.status}\`${m.customStatus ? ` — *${m.customStatus}*` : ""}`);
        lines.push(`- **Created:** ${m.createdAt.slice(0, 10)} (*${m.accountAgeDays} days ago*)`);
        if (m.joinedAt) lines.push(`- **Joined Server:** ${m.joinedAt.slice(0, 10)} (*${m.serverTenureDays} days ago*)`);
        if (m.roles.length) lines.push(`- **Roles:** ${m.roles.map(r => `\`${r.name}\``).join(", ")}`);
        if (m.badges.length) lines.push(`- **Badges:** ${m.badges.map(b => `\`${b}\``).join(", ")}`);
        if (m.bio) lines.push(`- **Bio:** ${m.bio}`);
        lines.push("");
    }
    return lines.join("\n");
}

function buildMembersJson(members: SerializedUser[], title: string): string {
    return JSON.stringify({ title, exportedAt: new Date().toISOString(), count: members.length, members }, null, 2);
}

function buildMembersJsonl(members: SerializedUser[]): string {
    return members.map(m => JSON.stringify(m)).join("\n");
}

function buildMembersCsv(members: SerializedUser[]): string {
    const headers = ["ID", "Username", "GlobalName", "DisplayName", "Nickname", "Discriminator", "Bot", "System", "CreatedAt", "AccountAgeDays", "JoinedAt", "ServerTenureDays", "Status", "CustomStatus", "Badges", "HighestRole", "Roles", "AvatarUrl", "BannerUrl", "Bio", "Pronouns"];
    const rows = [headers];

    for (const m of members) {
        rows.push([
            m.id, m.username, m.globalName ?? "", m.displayName, m.nickname ?? "", m.discriminator,
            m.bot ? "yes" : "no", m.system ? "yes" : "no", m.createdAt, String(m.accountAgeDays),
            m.joinedAt ?? "", String(m.serverTenureDays ?? ""), m.status, m.customStatus ?? "",
            m.badges.join("|"), m.highestRole?.name ?? "", m.roles.map(r => r.name).join("|"),
            m.avatarUrl, m.bannerUrl ?? "", m.bio ?? "", m.pronouns ?? ""
        ]);
    }

    return rows.map(r => r.map(escapeCsv).join(",")).join("\n");
}

function buildMembersXml(members: SerializedUser[], title: string): string {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<exporter type="memberlist">',
        `  <meta title="${escapeXml(title)}" exportedAt="${new Date().toISOString()}" count="${members.length}"/>`,
        "  <members>"
    ];

    for (const m of members) {
        lines.push(`    <member id="${m.id}" username="${escapeXml(m.username)}" displayName="${escapeXml(m.displayName)}" bot="${m.bot}">`);
        lines.push(`      <createdAt>${m.createdAt}</createdAt>`);
        if (m.joinedAt) lines.push(`      <joinedAt>${m.joinedAt}</joinedAt>`);
        lines.push(`      <status>${escapeXml(m.status)}</status>`);
        if (m.roles.length) {
            lines.push("      <roles>");
            for (const r of m.roles) lines.push(`        <role id="${r.id}" name="${escapeXml(r.name)}" colorHex="${r.colorHex}"/>`);
            lines.push("      </roles>");
        }
        lines.push("    </member>");
    }

    lines.push("  </members>", "</exporter>");
    return lines.join("\n");
}

function buildMembersYaml(members: SerializedUser[], title: string): string {
    return toYamlString({
        exporter: {
            type: "memberlist",
            title,
            exportedAt: new Date().toISOString(),
            count: members.length,
            members
        }
    });
}

function buildMembersBbcode(members: SerializedUser[], title: string): string {
    const lines = [`[b]Member List — ${title}[/b]`, `[i]Exported on ${new Date().toLocaleString()} · ${members.length} members[/i]`, ""];
    for (const m of members) {
        lines.push(`[b]${m.displayName}[/b] (@${m.username}) ${m.bot ? "[color=#5865f2][BOT][/color]" : ""}`);
        lines.push(`User ID: ${m.id} | Status: ${m.status}`);
        if (m.roles.length) lines.push(`Roles: ${m.roles.map(r => r.name).join(", ")}`);
        lines.push("");
    }
    return lines.join("\n");
}

async function saveOrDownloadFile(content: string, filename: string, mime: string = "text/plain"): Promise<boolean> {
    const { DiscordNative } = (window as any);
    if (DiscordNative?.fileManager?.saveWithDialog) {
        try {
            const data = new TextEncoder().encode(content);
            await DiscordNative.fileManager.saveWithDialog(data, filename);
        } catch (e) {
            console.error("[Exporter] saveWithDialog failed:", e);
        }
        return true;
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
}

// ── Icons ──
function ExportIcon({ width = 18, height = 18 }: { width?: number; height?: number; }) {
    return (
        <svg aria-hidden="true" role="img" width={width} height={height} viewBox="0 0 24 24" fill="none">
            <path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29a1 1 0 1 1 1.4 1.41l-4 3.99a1 1 0 0 1-1.4 0l-4-3.99a1 1 0 0 1 1.4-1.41L11 12.59V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
        </svg>
    );
}

interface ExportChannelItem {
    id: string;
    type: any;
    name: string;
    icon?: string | null;
    recipientId?: string;
    avatar?: string | null;
    isGuildChannel?: boolean;
}

const FORMATS: Array<{ key: ExportFormat; label: string; desc: string; }> = [
    { key: "html", label: "HTML", desc: "Discord web view" },
    { key: "txt", label: "TXT", desc: "Plain text" },
    { key: "md", label: "MD", desc: "Markdown" },
    { key: "json", label: "JSON", desc: "Structured data" },
    { key: "jsonl", label: "JSONL", desc: "Line JSON" },
    { key: "csv", label: "CSV", desc: "Spreadsheet" },
    { key: "xml", label: "XML", desc: "XML tree" },
    { key: "yaml", label: "YAML", desc: "YAML config" },
    { key: "bbcode", label: "BBCode", desc: "Forum tags" },
];

// ── Unified Discord Native Exporter Modal ──
export function ExporterModal({ rootProps, initialTab }: { rootProps: any; initialTab?: ExportTab; }) {
    const [tab, setTab] = useState<ExportTab>(initialTab ?? (settings.store.exportType as ExportTab) ?? "messages");

    // Channels / DMs selection state
    const [channels, setChannels] = useState<ExportChannelItem[]>([]);
    const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());

    // Members selection state
    const [members, setMembers] = useState<Array<{ member: GuildMember; user: User; }>>([]);
    const [rolesList, setRolesList] = useState<Array<{ id: string; name: string; }>>([]);
    const [selectedRole, setSelectedRole] = useState<string>("all");
    const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

    // Settings / Filters State
    const [format, setFormat] = useState<ExportFormat>((tab === "memberlist" ? settings.store.memberFormat : settings.store.chatFormat) as ExportFormat);
    const [status, setStatus] = useState<"idle" | "fetching" | "done" | "error">("idle");
    const [progress, setProgress] = useState("");

    const [includeProfileIcons, setIncludeProfileIcons] = useState(settings.store.includeProfileIcons);
    const [includeProfileDetails, setIncludeProfileDetails] = useState(settings.store.includeProfileDetails);
    const [includeRoles, setIncludeRoles] = useState(settings.store.includeRoles);
    const [includeMedia, setIncludeMedia] = useState(settings.store.includeMedia);
    const [includeEmbeds, setIncludeEmbeds] = useState(settings.store.includeEmbeds);
    const [includeReactions, setIncludeReactions] = useState(settings.store.includeReactions);
    const [includeDeletedMessages, setIncludeDeletedMessages] = useState(settings.store.includeDeletedMessages);
    const [includeBots, setIncludeBots] = useState(settings.store.includeBots);
    const [loadedOnly, setLoadedOnly] = useState(settings.store.loadedOnly);

    const [search, setSearch] = useState("");
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const currentGuildId = SelectedGuildStore.getGuildId();
    const currentChannelId = SelectedChannelStore.getChannelId();
    const currentGuild = currentGuildId ? GuildStore.getGuild(currentGuildId) : null;

    // Load Channels/DMs list
    useEffect(() => {
        try {
            const raw = ChannelStore.getSortedPrivateChannels?.() ?? {};
            const list: ExportChannelItem[] = (Array.isArray(raw) ? raw : Object.values(raw))
                .filter((c: any) => c.type === 1 || c.type === 3)
                .map((c: any) => {
                    let name = c.name ?? "";
                    let avatar: string | null = null;
                    let userId: string | undefined;
                    if (!name && c.type === 1 && c.recipients?.length) {
                        const user = UserStore.getUser?.(c.recipients[0]);
                        name = user?.globalName ?? user?.username ?? c.recipients[0];
                        avatar = user?.avatar ?? null;
                        userId = c.recipients[0];
                    }
                    return { id: c.id, type: c.type, name: name || `DM ${c.id.slice(-4)}`, icon: c.icon ?? null, recipientId: userId, avatar };
                });

            if (currentGuildId && currentChannelId) {
                const currentChan = ChannelStore.getChannel(currentChannelId);
                if (currentChan && currentChan.guild_id === currentGuildId) {
                    list.unshift({
                        id: currentChan.id,
                        type: currentChan.type,
                        name: `#${currentChan.name}`,
                        isGuildChannel: true
                    });
                }
            }

            setChannels(list);
            if (currentChannelId) {
                setSelectedChannels(new Set([currentChannelId]));
            } else if (list.length > 0) {
                setSelectedChannels(new Set([list[0].id]));
            }
        } catch { }
    }, [currentGuildId, currentChannelId]);

    // Load Members list (for memberlist / both tabs)
    useEffect(() => {
        if (!currentGuildId) return;
        try {
            const memberIds = GuildMemberStore.getMemberIds(currentGuildId);
            const loadedMembers: Array<{ member: GuildMember; user: User; }> = [];
            for (const uid of memberIds) {
                const member = GuildMemberStore.getMember(currentGuildId, uid);
                const user = UserStore.getUser(uid);
                if (member && user) {
                    if (!includeBots && user.bot) continue;
                    loadedMembers.push({ member, user });
                }
            }
            setMembers(loadedMembers);
            setSelectedMembers(new Set(loadedMembers.map(m => m.user.id)));

            const guildRoles = (GuildRoleStore as any).getRoles?.(currentGuildId) ?? (GuildRoleStore as any).getGuildRoles?.(currentGuildId);
            if (guildRoles) {
                const rolesArr = (Array.isArray(guildRoles) ? guildRoles : Object.values(guildRoles))
                    .map((r: any) => ({ id: r.id, name: r.name }))
                    .filter(r => r.name !== "@everyone");
                setRolesList(rolesArr);
            }
        } catch { }
    }, [currentGuildId, includeBots]);

    useEffect(() => () => abortRef.current?.abort(), []);

    function closeModal() {
        abortRef.current?.abort();
        rootProps.onClose();
    }

    async function doExport() {
        if (status === "fetching") return;
        const token = getToken();
        if ((tab === "messages" || tab === "both") && !loadedOnly && !token) {
            setStatus("error");
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Token not found" });
            return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setStatus("fetching");
        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Exporting..." });

        try {
            const date = new Date().toISOString().slice(0, 10);

            // 1. Export Member List
            if (tab === "memberlist") {
                const selectedList = members.filter(m => selectedMembers.has(m.user.id));
                const serializedMembers = selectedList.map(({ member, user }) => serializeUserFull(user, member, currentGuildId ?? undefined));

                const title = currentGuild ? currentGuild.name : "Member List";
                let content: string; let ext: string; let mime: string;

                switch (format) {
                    case "html": content = buildMembersHtml(serializedMembers, title); ext = "html"; mime = "text/html"; break;
                    case "txt": content = buildMembersTxt(serializedMembers, title); ext = "txt"; mime = "text/plain"; break;
                    case "md": content = buildMembersMd(serializedMembers, title); ext = "md"; mime = "text/markdown"; break;
                    case "json": content = buildMembersJson(serializedMembers, title); ext = "json"; mime = "application/json"; break;
                    case "jsonl": content = buildMembersJsonl(serializedMembers); ext = "jsonl"; mime = "application/x-ndjson"; break;
                    case "csv": content = buildMembersCsv(serializedMembers); ext = "csv"; mime = "text/csv"; break;
                    case "xml": content = buildMembersXml(serializedMembers, title); ext = "xml"; mime = "application/xml"; break;
                    case "yaml": content = buildMembersYaml(serializedMembers, title); ext = "yaml"; mime = "text/yaml"; break;
                    case "bbcode": content = buildMembersBbcode(serializedMembers, title); ext = "txt"; mime = "text/plain"; break;
                    default: content = buildMembersJson(serializedMembers, title); ext = "json"; mime = "application/json"; break;
                }

                const safeName = (title || "members").replace(/[^a-z0-9_-]/gi, "_").slice(0, 30);
                await saveOrDownloadFile(content, `MemberList_${safeName}_${date}.${ext}`, mime);
            }

            // 2. Export Messages Only
            else if (tab === "messages") {
                const targetChannels = channels.filter(c => selectedChannels.has(c.id));
                for (let i = 0; i < targetChannels.length; i++) {
                    if (controller.signal.aborted) return;
                    const ch = targetChannels[i];
                    const channelPrefix = targetChannels.length > 1 ? `[${i + 1}/${targetChannels.length}] ${ch.name}: ` : "";

                    let msgs: RichMessage[];
                    if (loadedOnly) {
                        msgs = getLoadedRichMessages(ch.id);
                        if (!msgs.length) {
                            setProgress(`${channelPrefix}No loaded messages for ${ch.name}, skipping...`);
                            continue;
                        }
                    } else {
                        msgs = await fetchAllMessages(ch.id, token, n => setProgress(`${channelPrefix}Fetching: ${n} messages...`), controller.signal);
                        if (controller.signal.aborted) return;
                    }

                    if (!includeMedia) msgs = msgs.map(m => ({ ...m, attachments: [] }));
                    if (!includeEmbeds) msgs = msgs.map(m => ({ ...m, embeds: [] }));
                    if (!includeReactions) msgs = msgs.map(m => ({ ...m, reactions: [], stickers: [] }));

                    setProgress(`${channelPrefix}${msgs.length} messages — generating file...`);
                    const safeName = ch.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 30) || "Export";

                    let content: string; let ext: string; let mime: string;
                    switch (format) {
                        case "html": content = buildMessagesHtml(msgs, ch.name); ext = "html"; mime = "text/html"; break;
                        case "txt": content = buildMessagesTxt(msgs, ch.name); ext = "txt"; mime = "text/plain"; break;
                        case "md": content = buildMessagesMd(msgs, ch.name); ext = "md"; mime = "text/markdown"; break;
                        case "json": content = buildMessagesJson(msgs, ch.name); ext = "json"; mime = "application/json"; break;
                        case "jsonl": content = buildMessagesJsonl(msgs); ext = "jsonl"; mime = "application/x-ndjson"; break;
                        case "csv": content = buildMessagesCsv(msgs); ext = "csv"; mime = "text/csv"; break;
                        case "xml": content = buildMessagesXml(msgs, ch.name); ext = "xml"; mime = "application/xml"; break;
                        case "yaml": content = buildMessagesYaml(msgs, ch.name); ext = "yaml"; mime = "text/yaml"; break;
                        case "bbcode": content = buildMessagesBbcode(msgs, ch.name); ext = "txt"; mime = "text/plain"; break;
                        default: content = buildMessagesHtml(msgs, ch.name); ext = "html"; mime = "text/html"; break;
                    }

                    await saveOrDownloadFile(content, `Messages_${safeName}_${date}.${ext}`, mime);
                }
            }

            // 3. Export Both (All-in-One SINGLE FILE)
            else if (tab === "both") {
                const selectedList = members.filter(m => selectedMembers.has(m.user.id));
                const serializedMembers = selectedList.map(({ member, user }) => serializeUserFull(user, member, currentGuildId ?? undefined));

                let targetChannels = channels.filter(c => selectedChannels.has(c.id));
                if (targetChannels.length === 0 && currentChannelId) {
                    const currentChan = ChannelStore.getChannel(currentChannelId);
                    if (currentChan) {
                        targetChannels = [{
                            id: currentChan.id,
                            type: currentChan.type,
                            name: currentChan.name ? `#${currentChan.name}` : `DM ${currentChan.id.slice(-4)}`
                        }];
                    }
                }

                const title = currentGuild ? currentGuild.name : "Export";
                const safeName = (title || "export").replace(/[^a-z0-9_-]/gi, "_").slice(0, 30);
                const allMessagesMap: Record<string, RichMessage[]> = {};

                for (let i = 0; i < targetChannels.length; i++) {
                    if (controller.signal.aborted) return;
                    const ch = targetChannels[i];
                    setProgress(`Fetching ${ch.name}...`);
                    let msgs: RichMessage[];
                    if (loadedOnly) {
                        msgs = getLoadedRichMessages(ch.id);
                        if (!msgs.length) {
                            setProgress(`No loaded messages for ${ch.name}, skipping...`);
                            continue;
                        }
                    } else {
                        msgs = await fetchAllMessages(ch.id, token, n => setProgress(`Fetching ${ch.name}: ${n} messages...`), controller.signal);
                        if (controller.signal.aborted) return;
                    }

                    if (!includeMedia) msgs = msgs.map(m => ({ ...m, attachments: [] }));
                    if (!includeEmbeds) msgs = msgs.map(m => ({ ...m, embeds: [] }));
                    if (!includeReactions) msgs = msgs.map(m => ({ ...m, reactions: [], stickers: [] }));
                    allMessagesMap[ch.name] = msgs;
                }

                setProgress("Generating All-in-One export file...");
                let content: string; let ext: string; let mime: string;
                switch (format) {
                    case "json":
                        content = JSON.stringify({ title, exportedAt: new Date().toISOString(), memberList: serializedMembers, channels: allMessagesMap }, null, 2);
                        ext = "json"; mime = "application/json"; break;
                    case "jsonl":
                        content = JSON.stringify({ recordType: "meta", title, exportedAt: new Date().toISOString() }) + "\n" +
                            serializedMembers.map(m => JSON.stringify({ recordType: "member", ...m })).join("\n") + "\n" +
                            Object.entries(allMessagesMap).flatMap(([cName, msgs]) => msgs.map(m => JSON.stringify({ recordType: "message", channel: cName, ...m }))).join("\n");
                        ext = "jsonl"; mime = "application/x-ndjson"; break;
                    case "txt":
                        content = buildMembersTxt(serializedMembers, title) + "\n\n" + Object.entries(allMessagesMap).map(([cName, msgs]) => buildMessagesTxt(msgs, cName)).join("\n\n");
                        ext = "txt"; mime = "text/plain"; break;
                    case "md":
                        content = buildMembersMd(serializedMembers, title) + "\n\n" + Object.entries(allMessagesMap).map(([cName, msgs]) => buildMessagesMd(msgs, cName)).join("\n\n");
                        ext = "md"; mime = "text/markdown"; break;
                    default:
                        content = buildMembersHtml(serializedMembers, `${title} — Member List`) + "\n" + Object.entries(allMessagesMap).map(([cName, msgs]) => buildMessagesHtml(msgs, cName)).join("\n");
                        ext = "html"; mime = "text/html"; break;
                }

                await saveOrDownloadFile(content, `Exporter_AllInOne_${safeName}_${date}.${ext}`, mime);
            }

            if (!controller.signal.aborted) {
                setStatus("done");
                setProgress("Export completed successfully.");
                Toasts.show({ id: Toasts.genId(), type: Toasts.Type.SUCCESS, message: "Export completed successfully." });
            }
        } catch (e: any) {
            setStatus("error");
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: `Export failed: ${e?.message || e}` });
        }
    }

    const toggleChannel = (id: string) => {
        const next = new Set(selectedChannels);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedChannels(next);
    };

    const toggleMember = (id: string) => {
        const next = new Set(selectedMembers);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedMembers(next);
    };

    const filteredChannels = search.trim()
        ? channels.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
        : channels;

    const filteredMembers = members.filter(({ member, user }) => {
        if (!includeBots && user.bot) return false;
        if (selectedRole !== "all" && !member.roles.includes(selectedRole)) return false;
        if (search.trim()) {
            const query = search.toLowerCase();
            const nameMatch = user.username.toLowerCase().includes(query) || (user.globalName && user.globalName.toLowerCase().includes(query)) || (member.nick && member.nick.toLowerCase().includes(query));
            const idMatch = user.id.includes(query);
            return nameMatch || idMatch;
        }
        return true;
    });

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    <ExportIcon width={20} height={20} /> Exporter
                </Forms.FormTitle>
                <ModalCloseButton onClick={closeModal} />
            </ModalHeader>

            <ModalContent style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* 1. TabBar */}
                <TabBar
                    type="top"
                    selectedItem={tab}
                    onItemSelect={(id: string) => setTab(id as ExportTab)}
                >
                    <TabBar.Item id="messages">Messages</TabBar.Item>
                    <TabBar.Item id="memberlist">Member List</TabBar.Item>
                    <TabBar.Item id="both">Both (All-in-One)</TabBar.Item>
                </TabBar>

                {/* 2. Search & Role Filter */}
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                        <TextInput
                            value={search}
                            onChange={setSearch}
                            placeholder={tab === "memberlist" ? "Search members by name or ID..." : tab === "messages" ? "Search channels..." : "Search channels or members..."}
                        />
                    </div>
                    {tab !== "messages" && rolesList.length > 0 && (
                        <div style={{ width: 160 }}>
                            <Select
                                options={[
                                    { label: "All Roles", value: "all" },
                                    ...rolesList.map(r => ({ label: r.name, value: r.id }))
                                ]}
                                isSelected={v => v === selectedRole}
                                select={v => setSelectedRole(v)}
                                serialize={v => v}
                            />
                        </div>
                    )}
                </div>

                {/* 3. Items Selection List */}
                {tab === "both" ? (
                    <div style={{ display: "flex", gap: "12px" }}>
                        <div style={{ flex: 1 }}>
                            <Forms.FormTitle tag="h5" style={{ marginBottom: 4 }}>
                                SELECT CHANNELS ({selectedChannels.size} selected)
                            </Forms.FormTitle>
                            <ScrollerThin style={{
                                maxHeight: 180,
                                background: "var(--background-secondary, var(--background-secondary-alt))",
                                borderRadius: "var(--radius-sm, 4px)",
                                padding: "8px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "4px"
                            }}>
                                {filteredChannels.length === 0 && <Text variant="text-sm/normal" style={{ textAlign: "center", color: "var(--text-muted)", padding: 12 }}>No channels found</Text>}
                                {filteredChannels.map(c => {
                                    const isSel = selectedChannels.has(c.id);
                                    const isHov = hoveredId === c.id;
                                    const bg = isSel
                                        ? (isHov ? "var(--background-modifier-selected-hover, color-mix(in hsl, var(--background-brand) 28%, transparent)))" : "var(--background-modifier-selected, color-mix(in hsl, var(--background-brand) 18%, transparent))")
                                        : (isHov ? "var(--background-modifier-hover, rgba(255, 255, 255, 0.08))" : "transparent");
                                    return (
                                        <div
                                            key={c.id}
                                            style={{
                                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                                padding: "8px 10px", borderRadius: 4, cursor: "pointer",
                                                background: bg,
                                                transition: "background 0.15s ease"
                                            }}
                                            onClick={() => toggleChannel(c.id)}
                                            onMouseEnter={() => setHoveredId(c.id)}
                                            onMouseLeave={() => setHoveredId(null)}
                                        >
                                            <Text variant="text-sm/medium">{c.name}</Text>
                                            {isSel && <Text variant="text-sm/bold" style={{ color: "var(--brand-experiment, var(--background-brand))" }}>✓</Text>}
                                        </div>
                                    );
                                })}
                            </ScrollerThin>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Forms.FormTitle tag="h5" style={{ marginBottom: 4 }}>
                                SELECT MEMBERS ({selectedMembers.size} selected)
                            </Forms.FormTitle>
                            <ScrollerThin style={{
                                maxHeight: 180,
                                background: "var(--background-secondary, var(--background-secondary-alt))",
                                borderRadius: "var(--radius-sm, 4px)",
                                padding: "8px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "4px"
                            }}>
                                {filteredMembers.length === 0 && <Text variant="text-sm/normal" style={{ textAlign: "center", color: "var(--text-muted)", padding: 12 }}>No members found</Text>}
                                {filteredMembers.map(({ member, user }) => {
                                    const isSel = selectedMembers.has(user.id);
                                    const isHov = hoveredId === user.id;
                                    const bg = isSel
                                        ? (isHov ? "var(--background-modifier-selected-hover, color-mix(in hsl, var(--background-brand) 28%, transparent)))" : "var(--background-modifier-selected, color-mix(in hsl, var(--background-brand) 18%, transparent))")
                                        : (isHov ? "var(--background-modifier-hover, rgba(255, 255, 255, 0.08))" : "transparent");
                                    return (
                                        <div
                                            key={user.id}
                                            style={{
                                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                                padding: "8px 10px", borderRadius: 4, cursor: "pointer",
                                                background: bg,
                                                transition: "background 0.15s ease"
                                            }}
                                            onClick={() => toggleMember(user.id)}
                                            onMouseEnter={() => setHoveredId(user.id)}
                                            onMouseLeave={() => setHoveredId(null)}
                                        >
                                            <div>
                                                <Text variant="text-sm/medium">{member.nick || user.globalName || user.username}{user.bot ? " [BOT]" : ""}</Text>
                                                <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>@{user.username}</Text>
                                            </div>
                                            {isSel && <Text variant="text-sm/bold" style={{ color: "var(--brand-experiment, var(--background-brand))" }}>✓</Text>}
                                        </div>
                                    );
                                })}
                            </ScrollerThin>
                        </div>
                    </div>
                ) : (
                    <Forms.FormSection
                        title={`${tab === "messages" ? "SELECT CHANNELS / DMS" : "SELECT MEMBERS"} (${tab === "messages" ? selectedChannels.size : selectedMembers.size} selected)`}
                    >
                        <ScrollerThin style={{
                            maxHeight: 180,
                            background: "var(--background-secondary, var(--background-secondary-alt))",
                            borderRadius: "var(--radius-sm, 4px)",
                            padding: "8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px"
                        }}>
                            {tab === "messages" && (
                                <>
                                    {filteredChannels.length === 0 && <Text variant="text-sm/normal" style={{ textAlign: "center", color: "var(--text-muted)", padding: 12 }}>No channels found</Text>}
                                    {filteredChannels.map(c => {
                                        const isSel = selectedChannels.has(c.id);
                                        const isHov = hoveredId === c.id;
                                        const bg = isSel
                                            ? (isHov ? "var(--background-modifier-selected-hover, color-mix(in hsl, var(--background-brand) 28%, transparent)))" : "var(--background-modifier-selected, color-mix(in hsl, var(--background-brand) 18%, transparent))")
                                            : (isHov ? "var(--background-modifier-hover, rgba(255, 255, 255, 0.08))" : "transparent");
                                        return (
                                            <div
                                                key={c.id}
                                                style={{
                                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                                    padding: "8px 10px", borderRadius: 4, cursor: "pointer",
                                                    background: bg,
                                                    transition: "background 0.15s ease"
                                                }}
                                                onClick={() => toggleChannel(c.id)}
                                                onMouseEnter={() => setHoveredId(c.id)}
                                                onMouseLeave={() => setHoveredId(null)}
                                            >
                                                <Text variant="text-sm/medium">{c.name}</Text>
                                                {isSel && <Text variant="text-sm/bold" style={{ color: "var(--brand-experiment, var(--background-brand))" }}>✓</Text>}
                                            </div>
                                        );
                                    })}
                                </>
                            )}
                            {tab === "memberlist" && (
                                <>
                                    {filteredMembers.length === 0 && <Text variant="text-sm/normal" style={{ textAlign: "center", color: "var(--text-muted)", padding: 12 }}>No members found</Text>}
                                    {filteredMembers.map(({ member, user }) => {
                                        const isSel = selectedMembers.has(user.id);
                                        const isHov = hoveredId === user.id;
                                        const bg = isSel
                                            ? (isHov ? "var(--background-modifier-selected-hover, color-mix(in hsl, var(--background-brand) 28%, transparent)))" : "var(--background-modifier-selected, color-mix(in hsl, var(--background-brand) 18%, transparent))")
                                            : (isHov ? "var(--background-modifier-hover, rgba(255, 255, 255, 0.08))" : "transparent");
                                        return (
                                            <div
                                                key={user.id}
                                                style={{
                                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                                    padding: "8px 10px", borderRadius: 4, cursor: "pointer",
                                                    background: bg,
                                                    transition: "background 0.15s ease"
                                                }}
                                                onClick={() => toggleMember(user.id)}
                                                onMouseEnter={() => setHoveredId(user.id)}
                                                onMouseLeave={() => setHoveredId(null)}
                                            >
                                                <div>
                                                    <Text variant="text-sm/medium">{member.nick || user.globalName || user.username}{user.bot ? " [BOT]" : ""}</Text>
                                                    <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>@{user.username} • ID: {user.id}</Text>
                                                </div>
                                                {isSel && <Text variant="text-sm/bold" style={{ color: "var(--brand-experiment, var(--background-brand))" }}>✓</Text>}
                                            </div>
                                        );
                                    })}
                                </>
                            )}
                        </ScrollerThin>
                    </Forms.FormSection>
                )}

                {/* 4. Format Selection */}
                <Forms.FormSection title="EXPORT FORMAT">
                    <Select
                        options={FORMATS.map(f => ({ label: `${f.label} — ${f.desc}`, value: f.key }))}
                        isSelected={v => v === format}
                        select={v => setFormat(v as ExportFormat)}
                        serialize={v => v}
                    />
                </Forms.FormSection>

                {/* 5. Options (Discord Native FormSwitches) */}
                <Forms.FormSection title="EXPORT OPTIONS">
                    <FormSwitch
                        value={includeProfileIcons}
                        onChange={setIncludeProfileIcons}
                        title="Profile Icons"
                        description="Include avatar CDN links and fallback avatars"
                    />
                    <FormSwitch
                        value={includeProfileDetails}
                        onChange={setIncludeProfileDetails}
                        title="Bio & Badges"
                        description="Include bio, pronouns, badges, and account creation dates"
                    />
                    <FormSwitch
                        value={includeRoles}
                        onChange={setIncludeRoles}
                        title="Roles & Colors"
                        description="Include role lists, role positions, and role hex colors"
                    />
                    <FormSwitch
                        value={includeMedia}
                        onChange={setIncludeMedia}
                        title="Media Attachments"
                        description="Include image, video, and audio attachments"
                    />
                    <FormSwitch
                        value={includeEmbeds}
                        onChange={setIncludeEmbeds}
                        title="Link Embeds"
                        description="Include embedded links and open-graph data"
                    />
                    <FormSwitch
                        value={includeReactions}
                        onChange={setIncludeReactions}
                        title="Reactions & Stickers"
                        description="Include message reaction counts and sticker items"
                    />
                    <FormSwitch
                        value={includeDeletedMessages}
                        onChange={setIncludeDeletedMessages}
                        title="Deleted Messages"
                        description="Include deleted messages cached locally by MessageLogger"
                    />
                    <FormSwitch
                        value={includeBots}
                        onChange={setIncludeBots}
                        title="Include Bots"
                        description="Include bot accounts in member list exports"
                    />
                    <FormSwitch
                        value={loadedOnly}
                        onChange={setLoadedOnly}
                        title="Loaded Messages Only"
                        description="Export only messages already loaded in Discord without fetching full history"
                    />
                </Forms.FormSection>
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", flexDirection: "row" }}>
                    <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 12 }}>
                        {status !== "idle" && progress && (
                            <Text
                                variant="text-xs/normal"
                                style={{ color: status === "error" ? "var(--text-danger, #ed4245)" : status === "done" ? "var(--text-positive, #23a55a)" : "var(--text-warning, #f0b232)" }}
                            >
                                {progress}
                            </Text>
                        )}
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                        <Button color={Button.Colors.PRIMARY} onClick={closeModal}>
                            Cancel
                        </Button>
                        <Button
                            color={Button.Colors.BRAND}
                            onClick={() => doExport()}
                            disabled={status === "fetching" || (tab === "messages" && selectedChannels.size === 0) || ((tab === "memberlist" || tab === "both") && selectedMembers.size === 0)}
                        >
                            {status === "fetching" ? "Exporting..." : "Export"}
                        </Button>
                    </div>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

let isModalOpen = false;

export function openExporter(tab?: ExportTab) {
    if (isModalOpen) return;
    isModalOpen = true;
    openModal(props => (
        <ExporterModal
            rootProps={{
                ...props,
                onClose: () => {
                    isModalOpen = false;
                    props.onClose();
                }
            }}
            initialTab={tab}
        />
    ));
}

function ExportButton() {
    return (
        <HeaderBarButton
            icon={ExportIcon}
            tooltip="Exporter"
            onClick={() => openExporter()}
        />
    );
}

function ExporterChannelToolbarButton() {
    return (
        <ChannelToolbarButton
            icon={ExportIcon as any}
            tooltip="Exporter"
            onClick={() => openExporter("memberlist")}
        />
    );
}

function ExporterMenu({ channelId }: { channelId?: string; }) {
    return (
        <Menu.Menu navId="pc-exporter-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Exporter">
            <Menu.MenuItem
                id="pc-exporter-open-messages"
                label="Export Messages"
                action={() => openExporter("messages")}
            />
            <Menu.MenuItem
                id="pc-exporter-open-members"
                label="Export Member List"
                action={() => openExporter("memberlist")}
            />
            <Menu.MenuItem
                id="pc-exporter-open-both"
                label="Export Both (All-in-One)"
                action={() => openExporter("both")}
            />
        </Menu.Menu>
    );
}

function openCurrentChannelMenu(e: React.MouseEvent) {
    const channelId = SelectedChannelStore.getChannelId();
    ContextMenuApi.openContextMenu(e, () => <ExporterMenu channelId={channelId} />);
}

const ExporterChatBarButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat || settings.store.location !== "chatbar") return null;

    return (
        <ChatBarButton
            tooltip="Exporter"
            onClick={() => openExporter()}
            onContextMenu={openCurrentChannelMenu}
        >
            <ExportIcon width={20} height={20} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "Exporter",
    description: "Exports DMs, channels, and server member lists with profile icons, banners, badges, bios, and 9 file formats.",
    tags: ["Media", "Utility"],
    authors: [TestcordDevs.sirphantom89],
    dependencies: ["HeaderBarAPI", "ChatInputButtonAPI"],
    settings,
    chatBarButton: {
        icon: ExportIcon as any,
        render: ExporterChatBarButton
    },

    start() {
        const loc = settings.store.location;
        if (loc === "all" || loc === "headerbar") {
            addHeaderBarButton("exporter-headerbar", () => <ExportButton />, 4);
        }
        if (loc === "all" || loc === "channeltoolbar") {
            addChannelToolbarButton("exporter-channeltoolbar", () => <ExporterChannelToolbarButton />, 5);
        }
    },
    stop() {
        removeHeaderBarButton("exporter-headerbar");
        removeChannelToolbarButton("exporter-channeltoolbar");
    },
});
