/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fetchUserProfile } from "@utils/discord";
import { GuildMemberStore, GuildStore, RelationshipStore, SnowflakeUtils, UserProfileStore, UserStore } from "@webpack/common";

import type { MessageData } from "./algorithms";

export interface SocialHit {
    platform: string;
    handle: string;
    url: string | null;
    verified: boolean;
    source: "message" | "bio" | "connection";
    count: number;
}

export interface StyleFingerprint {
    total: number;
    avgLength: number;
    capsRatio: number;
    emojiRate: number;
    customEmojiRate: number;
    questionRate: number;
    exclaimRate: number;
    linkRate: number;
    mentionRate: number;
    replyRate: number;
    attachmentRate: number;
    stickerRate: number;
    codeblockRate: number;
    spoilerRate: number;
    vocabRichness: number;
    topWords: Array<[string, number]>;
    topEmojis: Array<[string, number]>;
    topDomains: Array<[string, number]>;
    hourHist: number[];
    weekdayHist: number[];
    scripts: { latin: number; cyrillic: number; cjk: number; arabic: number; other: number; };
}

export interface DimensionScore {
    label: string;
    score: number;
    detail: string;
}

export interface LinkSignal {
    label: string;
    detail: string;
    score: number;
    weight: number;
}

export interface LinkReport {
    score: number;
    verdict: string;
    signals: LinkSignal[];
    dimensions: DimensionScore[];
}

export interface UserSnapshot {
    userId: string;
    username: string;
    globalName: string | null;
    avatarHash: string | null;
    bannerHash: string | null;
    accentColor: number | null;
    bot: boolean;
    flags: string[];
    createdAt: number;
    bio: string | null;
    connections: Array<{ type: string; name: string; id: string; }>;
    guildIds: string[];
}

interface PlatformDef {
    platform: string;
    domains: string[];
    urlFor: (handle: string) => string | null;
}

const PLATFORMS: PlatformDef[] = [
    { platform: "X / Twitter", domains: ["twitter.com", "x.com"], urlFor: h => `https://x.com/${h}` },
    { platform: "Instagram", domains: ["instagram.com"], urlFor: h => `https://instagram.com/${h}` },
    { platform: "TikTok", domains: ["tiktok.com"], urlFor: h => `https://tiktok.com/@${h}` },
    { platform: "YouTube", domains: ["youtube.com", "youtu.be"], urlFor: h => h.startsWith("@") ? `https://youtube.com/${h}` : null },
    { platform: "Twitch", domains: ["twitch.tv"], urlFor: h => `https://twitch.tv/${h}` },
    { platform: "GitHub", domains: ["github.com"], urlFor: h => `https://github.com/${h}` },
    { platform: "Steam", domains: ["steamcommunity.com", "store.steampowered.com"], urlFor: h => /^\d{10,}$/.test(h) ? `https://steamcommunity.com/profiles/${h}` : `https://steamcommunity.com/id/${h}` },
    { platform: "Spotify", domains: ["open.spotify.com"], urlFor: () => null },
    { platform: "Reddit", domains: ["reddit.com"], urlFor: h => h.startsWith("u/") ? `https://reddit.com/${h}` : null },
    { platform: "Telegram", domains: ["t.me"], urlFor: h => `https://t.me/${h}` },
    { platform: "Discord", domains: ["discord.gg", "discord.com"], urlFor: h => `https://discord.gg/${h}` },
    { platform: "SoundCloud", domains: ["soundcloud.com"], urlFor: h => `https://soundcloud.com/${h}` },
    { platform: "Roblox", domains: ["roblox.com"], urlFor: () => null },
    { platform: "Pinterest", domains: ["pinterest.com"], urlFor: h => `https://pinterest.com/${h}` },
];

const CONNECTION_URLS: Record<string, (c: { name: string; id: string; }) => string | null> = {
    github: c => `https://github.com/${c.name}`,
    twitter: c => `https://x.com/${c.name}`,
    twitch: c => `https://twitch.tv/${c.name}`,
    youtube: c => `https://youtube.com/channel/${c.id}`,
    steam: c => `https://steamcommunity.com/profiles/${c.id}`,
    spotify: c => `https://open.spotify.com/user/${c.id}`,
    reddit: c => `https://reddit.com/user/${c.name}`,
    tiktok: c => `https://tiktok.com/@${c.name}`,
    instagram: c => `https://instagram.com/${c.name}`,
};

const FLAG_NAMES: Array<[number, string]> = [
    [1 << 0, "Staff"], [1 << 1, "Partner"], [1 << 2, "HypeSquad"], [1 << 3, "Bug Hunter 1"],
    [1 << 6, "HypeSquad Online 1"], [1 << 7, "HypeSquad Online 2"], [1 << 8, "HypeSquad Online 3"],
    [1 << 9, "Premium Early Supporter"], [1 << 10, "Team User"], [1 << 14, "Bug Hunter 2"],
    [1 << 16, "Verified Bot"], [1 << 17, "Verified Developer"], [1 << 18, "Certified Mod"],
    [1 << 19, "Bot HTTP Interactions"], [1 << 22, "Active Developer"],
];

const HANDLE_REGEX = /(^|[\s:;,.!?()"'“”‘’[\]{}<>|/\\])@([A-Za-z0-9._]{3,32})/g;
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
const CUSTOM_EMOJI_REGEX = /<a?:(\w+):\d+>/g;
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const STOP_WORDS = new Set([
    "the", "and", "for", "with", "that", "this", "have", "from", "they", "would",
    "there", "their", "what", "about", "which", "when", "your", "said", "each",
]);

export function decodePublicFlags(flags: number): string[] {
    const out: string[] = [];
    for (const [bit, name] of FLAG_NAMES) if ((flags & bit) !== 0) out.push(name);
    return out;
}

export function creationDate(userId: string): number {
    try { return SnowflakeUtils.extractTimestamp(userId); } catch { return 0; }
}

function jaroWinkler(a: string, b: string): number {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    const lower = (s: string) => s.toLowerCase();
    a = lower(a); b = lower(b);
    if (a === b) return 1;
    const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
    const aMatch = new Array<boolean>(a.length).fill(false);
    const bMatch = new Array<boolean>(b.length).fill(false);
    let matches = 0;
    for (let i = 0; i < a.length; i++) {
        const lo = Math.max(0, i - range), hi = Math.min(b.length - 1, i + range);
        for (let j = lo; j <= hi; j++) {
            if (!bMatch[j] && a[i] === b[j]) { aMatch[i] = true; bMatch[j] = true; matches++; break; }
        }
    }
    if (!matches) return 0;
    let transpositions = 0, k = 0;
    for (let i = 0; i < a.length; i++) {
        if (!aMatch[i]) continue;
        while (!bMatch[k]) k++;
        if (a[i] !== b[k]) transpositions++;
        k++;
    }
    const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
    let prefix = 0;
    for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
        if (a[i] === b[i]) prefix++;
        else break;
    }
    return jaro + prefix * 0.1 * (1 - jaro);
}

export function nameSimilarity(a: string, b: string): number {
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9._]/g, "");
    const x = clean(a), y = clean(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.includes(y) || y.includes(x)) return 0.9;
    return jaroWinkler(x, y);
}

function domainOf(url: string): string | null {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host.startsWith("www.") ? host.slice(4) : host;
    } catch { return null; }
}

function platformForDomain(domain: string): PlatformDef | undefined {
    return PLATFORMS.find(p => p.domains.some(d => domain === d || domain.endsWith(`.${d}`)));
}

function handleFromUrl(platform: PlatformDef, url: string): string | null {
    try {
        const u = new URL(url);
        const parts = u.pathname.split("/").filter(Boolean);
        if (platform.platform === "X / Twitter") {
            if (parts[0] && !["i", "home", "explore", "messages", "settings"].includes(parts[0].toLowerCase())) return parts[0].replace("@", "");
        } else if (platform.platform === "TikTok") {
            const at = parts.find(p => p.startsWith("@"));
            if (at) return at.slice(1);
        } else if (platform.platform === "YouTube") {
            const at = parts.find(p => p.startsWith("@"));
            if (at) return at;
            if ((parts[0] === "channel" || parts[0] === "c" || parts[0] === "user") && parts[1]) return `${parts[0]}/${parts[1]}`;
            if (parts[0] === "watch" && u.searchParams.get("v")) return `watch?v=${u.searchParams.get("v")}`;
        } else if (platform.platform === "Discord") {
            if (parts[0]) return parts[0];
        } else if (platform.platform === "Reddit") {
            if (parts[0] === "u" && parts[1]) return `u/${parts[1]}`;
        } else if (platform.platform === "Steam") {
            if ((parts[0] === "profiles" || parts[0] === "id") && parts[1]) return parts[1];
        } else if (parts[0]) {
            return parts[0].replace("@", "");
        }
        return null;
    } catch { return null; }
}

function pushSocial(map: Map<string, SocialHit>, platform: string, handle: string, url: string | null, verified: boolean, source: SocialHit["source"]) {
    const key = `${platform}::${handle.toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
        existing.count++;
        if (url && !existing.url) existing.url = url;
        if (verified) existing.verified = true;
        if (source === "connection") existing.source = source;
    } else {
        map.set(key, { platform, handle, url, verified, source, count: 1 });
    }
}

export function extractSocials(messages: MessageData[], bio?: string | null, connections?: Array<{ type: string; name: string; id: string; }>): SocialHit[] {
    const map = new Map<string, SocialHit>();
    const scanText = (text: string, source: SocialHit["source"]) => {
        for (const match of text.matchAll(URL_REGEX)) {
            const domain = domainOf(match[0]);
            if (!domain) continue;
            const platform = platformForDomain(domain);
            if (!platform) continue;
            const handle = handleFromUrl(platform, match[0]);
            if (!handle) continue;
            pushSocial(map, platform.platform, handle, platform.urlFor(handle), false, source);
        }
        for (const match of text.matchAll(HANDLE_REGEX)) {
            const handle = match[2];
            if (/^\d+$/.test(handle)) continue;
            pushSocial(map, "Possible handle", `@${handle}`, null, false, source);
        }
    };
    for (const m of messages) if (m.content) scanText(m.content, "message");
    if (bio) scanText(bio, "bio");
    for (const c of connections ?? []) {
        const label = c.type.charAt(0).toUpperCase() + c.type.slice(1);
        const builder = CONNECTION_URLS[c.type.toLowerCase()];
        pushSocial(map, label, c.name, builder ? builder(c) : null, true, "connection");
    }
    return [...map.values()].sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || b.count - a.count);
}

export function buildFingerprint(messages: MessageData[]): StyleFingerprint {
    const words = new Map<string, number>();
    const emojis = new Map<string, number>();
    const domains = new Map<string, number>();
    const hourHist = new Array<number>(24).fill(0);
    const weekdayHist = new Array<number>(7).fill(0);
    const scripts = { latin: 0, cyrillic: 0, cjk: 0, arabic: 0, other: 0 };
    let totalLen = 0, caps = 0, totalWords = 0;
    let emoji = 0, customEmoji = 0, question = 0, exclaim = 0, links = 0, mentions = 0;
    let replies = 0, attachments = 0, stickers = 0, codeblocks = 0, spoilers = 0;
    for (const m of messages) {
        const text = m.content ?? "";
        totalLen += text.length;
        const upper = text.replace(/[^A-Za-z]/g, "");
        if (upper.length >= 4 && upper === upper.toUpperCase() && /[A-Z]/.test(upper)) caps++;
        const uni = text.match(EMOJI_REGEX);
        if (uni) { emoji += uni.length; for (const e of uni) emojis.set(e, (emojis.get(e) ?? 0) + 1); }
        for (const cm of text.matchAll(CUSTOM_EMOJI_REGEX)) { customEmoji++; emojis.set(`:${cm[1]}:`, (emojis.get(`:${cm[1]}:`) ?? 0) + 1); }
        if (text.includes("?")) question++;
        if (text.includes("!")) exclaim++;
        const urls = text.match(URL_REGEX) ?? [];
        if (urls.length > 0) links++;
        for (const u of urls) { const d = domainOf(u); if (d) domains.set(d, (domains.get(d) ?? 0) + 1); }
        if (/<@!?\d+>/.test(text) || (m.mentionsList?.length ?? 0) > 0) mentions++;
        if (m.message_reference || m.referencedAuthor) replies++;
        if ((m.attachments?.length ?? 0) > 0) attachments++;
        if ((m.stickerItems?.length ?? 0) > 0) stickers++;
        if (/```[\s\S]+```/.test(text)) codeblocks++;
        if (/\|\|[^|]+\|\|/.test(text)) spoilers++;
        for (const w of text.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/)) {
            if (w.length < 3 || STOP_WORDS.has(w)) continue;
            totalWords++;
            words.set(w, (words.get(w) ?? 0) + 1);
        }
        const d = new Date(m.timestamp);
        if (!Number.isNaN(d.getTime())) { hourHist[d.getUTCHours()]++; weekdayHist[d.getUTCDay()]++; }
        for (const ch of text) {
            const cp = ch.codePointAt(0) ?? 0;
            if (cp < 0x250) scripts.latin++;
            else if (cp >= 0x400 && cp < 0x530) scripts.cyrillic++;
            else if ((cp >= 0x4e00 && cp < 0xa000) || (cp >= 0x3040 && cp < 0x3100) || (cp >= 0xac00 && cp < 0xd800)) scripts.cjk++;
            else if (cp >= 0x600 && cp < 0x700) scripts.arabic++;
            else if (cp > 0x250) scripts.other++;
        }
    }
    const n = Math.max(1, messages.length);
    const top = <T,>(map: Map<T, number>, k: number): Array<[T, number]> =>
        [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
    return {
        total: messages.length,
        avgLength: totalLen / n,
        capsRatio: caps / n,
        emojiRate: emoji / n,
        customEmojiRate: customEmoji / n,
        questionRate: question / n,
        exclaimRate: exclaim / n,
        linkRate: links / n,
        mentionRate: mentions / n,
        replyRate: replies / n,
        attachmentRate: attachments / n,
        stickerRate: stickers / n,
        codeblockRate: codeblocks / n,
        spoilerRate: spoilers / n,
        vocabRichness: totalWords === 0 ? 0 : words.size / totalWords,
        topWords: top(words, 25),
        topEmojis: top(emojis, 10),
        topDomains: top(domains, 10),
        hourHist,
        weekdayHist,
        scripts,
    };
}

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0, y = b[i] ?? 0;
        dot += x * y; na += x * x; nb += y * y;
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function rateSim(a: number, b: number): number {
    if (a === 0 && b === 0) return 1;
    return 1 - Math.abs(a - b) / Math.max(a, b);
}

function setOverlap<T>(a: Array<[T, number]>, b: Array<[T, number]>): number {
    if (!a.length || !b.length) return 0;
    const sb = new Set(b.map(([v]) => v));
    const inter = a.filter(([v]) => sb.has(v)).length;
    return (2 * inter) / (a.length + b.length);
}

function lengthSim(a: number, b: number): number {
    if (a === 0 && b === 0) return 1;
    return 1 - Math.min(1, Math.abs(a - b) / Math.max(60, Math.max(a, b)));
}

export function compareFingerprints(a: StyleFingerprint, b: StyleFingerprint): { score: number; dimensions: DimensionScore[]; } {
    if (!a.total || !b.total) return { score: 0, dimensions: [] };
    const dimensions: DimensionScore[] = [
        { label: "Vocabulary overlap", score: setOverlap(a.topWords, b.topWords), detail: `${a.topWords.filter(([w]) => b.topWords.some(([v]) => v === w)).slice(0, 5).map(([w]) => w).join(", ") || "no shared top words"}` },
        { label: "Active hours", score: cosine(a.hourHist, b.hourHist), detail: "24h activity distribution correlation" },
        { label: "Emoji style", score: (setOverlap(a.topEmojis, b.topEmojis) + rateSim(a.emojiRate, b.emojiRate)) / 2, detail: `${a.emojiRate.toFixed(2)} vs ${b.emojiRate.toFixed(2)} emoji per message` },
        { label: "Message length", score: lengthSim(a.avgLength, b.avgLength), detail: `avg ${Math.round(a.avgLength)} vs ${Math.round(b.avgLength)} chars` },
        {
            label: "Punctuation habits", score: cosine(
                [a.questionRate, a.exclaimRate, a.capsRatio, a.codeblockRate, a.spoilerRate],
                [b.questionRate, b.exclaimRate, b.capsRatio, b.codeblockRate, b.spoilerRate]
            ), detail: `? ${(a.questionRate * 100).toFixed(0)}%/${(b.questionRate * 100).toFixed(0)}% ! ${(a.exclaimRate * 100).toFixed(0)}%/${(b.exclaimRate * 100).toFixed(0)}%`,
        },
        {
            label: "Link behavior", score: (rateSim(a.linkRate, b.linkRate) + setOverlap(a.topDomains, b.topDomains)) / 2,
            detail: a.topDomains.filter(([d]) => b.topDomains.some(([v]) => v === d)).slice(0, 4).map(([d]) => d).join(", ") || "no shared domains",
        },
        { label: "Interaction style", score: (rateSim(a.mentionRate, b.mentionRate) + rateSim(a.replyRate, b.replyRate) + rateSim(a.attachmentRate, b.attachmentRate)) / 3, detail: `mentions ${(a.mentionRate * 100).toFixed(0)}%/${(b.mentionRate * 100).toFixed(0)}%, replies ${(a.replyRate * 100).toFixed(0)}%/${(b.replyRate * 100).toFixed(0)}%` },
    ];
    const weights = [0.3, 0.2, 0.15, 0.1, 0.1, 0.1, 0.05];
    const score = dimensions.reduce((s, d, i) => s + d.score * weights[i], 0);
    return { score, dimensions };
}

function proximityScore(aMs: number, bMs: number): { score: number; detail: string; } {
    if (!aMs || !bMs) return { score: 0, detail: "Unknown creation date" };
    const days = Math.abs(aMs - bMs) / 86_400_000;
    const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    if (days < 1) return { score: 1, detail: `Created same day (${fmt(aMs)})` };
    if (days < 2) return { score: 0.9, detail: `Created 1 day apart (${fmt(aMs)} / ${fmt(bMs)})` };
    if (days < 8) return { score: 0.7, detail: `Created ${Math.round(days)} days apart` };
    if (days < 31) return { score: 0.4, detail: `Created ${Math.round(days)} days apart` };
    if (days < 365) return { score: 0.15, detail: `Created ${Math.round(days)} days apart` };
    return { score: 0, detail: `Created ${(days / 365).toFixed(1)} years apart` };
}

export function verdictFor(score: number): string {
    if (score >= 75) return "Likely same operator";
    if (score >= 50) return "Possibly linked";
    if (score >= 25) return "Weak link";
    return "Unlikely linked";
}

export function buildUserSnapshot(userId: string): UserSnapshot {
    const user = UserStore.getUser(userId);
    const profile = UserProfileStore.getUserProfile(userId);
    const guildIds: string[] = [];
    for (const guild of Object.values(GuildStore.getGuilds())) {
        try { if (GuildMemberStore.isMember(guild.id, userId)) guildIds.push(guild.id); } catch { /* noop */ }
    }
    return {
        userId,
        username: user?.username ?? userId,
        globalName: user?.globalName ?? null,
        avatarHash: user?.avatar ?? null,
        bannerHash: (user as { banner?: string; } | undefined)?.banner ?? null,
        accentColor: (user as { accentColor?: number; } | undefined)?.accentColor ?? (profile as { accentColor?: number; } | undefined)?.accentColor ?? null,
        bot: user?.bot ?? false,
        flags: decodePublicFlags(user?.publicFlags ?? 0),
        createdAt: creationDate(userId),
        bio: (profile as { bio?: string; } | undefined)?.bio ?? null,
        connections: ((profile as { connectedAccounts?: Array<{ type: string; name: string; id: string; }>; } | undefined)?.connectedAccounts ?? [])
            .map(c => ({ type: c.type, name: c.name, id: c.id })),
        guildIds,
    };
}

export async function enrichSnapshotWithProfile(snapshot: UserSnapshot, timeoutMs = 8000): Promise<UserSnapshot> {
    try {
        const profile = await Promise.race([
            fetchUserProfile(snapshot.userId),
            new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        if (!profile) return snapshot;
        const p = profile as { bio?: string; connectedAccounts?: Array<{ type: string; name: string; id: string; }>; };
        return {
            ...snapshot,
            bio: p.bio ?? snapshot.bio,
            connections: (p.connectedAccounts ?? []).map(c => ({ type: c.type, name: c.name, id: c.id })),
        };
    } catch { return snapshot; }
}

export interface SharedContact {
    userId: string;
    username: string;
    aCount: number;
    bCount: number;
}

export function sharedContacts(aMsgs: MessageData[], bMsgs: MessageData[]): SharedContact[] {
    const collect = (msgs: MessageData[]) => {
        const map = new Map<string, { username: string; count: number; }>();
        const add = (id: string, username: string) => {
            if (!id) return;
            const e = map.get(id);
            if (e) e.count++;
            else map.set(id, { username, count: 1 });
        };
        for (const m of msgs) {
            for (const u of m.mentionsList ?? []) add(u.id, u.username);
            if (m.referencedAuthor) add(m.referencedAuthor.id, m.referencedAuthor.username);
        }
        return map;
    };
    const a = collect(aMsgs), b = collect(bMsgs);
    const out: SharedContact[] = [];
    for (const [id, ea] of a) {
        const eb = b.get(id);
        if (eb) out.push({ userId: id, username: ea.username || eb.username, aCount: ea.count, bCount: eb.count });
    }
    return out.sort((x, y) => (y.aCount + y.bCount) - (x.aCount + x.bCount)).slice(0, 15);
}

export function sharedBridges(aId: string, bId: string, limit = 15): Array<{ userId: string; username: string; }> {
    let friends: string[] = [];
    try { friends = RelationshipStore.getFriendIDs?.() ?? []; } catch { return []; }
    const out: Array<{ userId: string; username: string; }> = [];
    const guildsOf = (id: string): Set<string> => {
        const s = new Set<string>();
        for (const guild of Object.values(GuildStore.getGuilds())) {
            try { if (GuildMemberStore.isMember(guild.id, id)) s.add(guild.id); } catch { /* noop */ }
        }
        return s;
    };
    const aGuilds = guildsOf(aId), bGuilds = guildsOf(bId);
    for (const fid of friends) {
        if (fid === aId || fid === bId) continue;
        let sharesA = false, sharesB = false;
        for (const guild of Object.values(GuildStore.getGuilds())) {
            try {
                if (GuildMemberStore.isMember(guild.id, fid)) {
                    if (aGuilds.has(guild.id)) sharesA = true;
                    if (bGuilds.has(guild.id)) sharesB = true;
                }
            } catch { /* noop */ }
            if (sharesA && sharesB) break;
        }
        if (sharesA && sharesB) {
            out.push({ userId: fid, username: UserStore.getUser(fid)?.username ?? fid });
            if (out.length >= limit) break;
        }
    }
    return out;
}

export function compareSnapshots(a: UserSnapshot, b: UserSnapshot, fpA?: StyleFingerprint, fpB?: StyleFingerprint, socialsA?: SocialHit[], socialsB?: SocialHit[]): LinkReport {
    const signals: LinkSignal[] = [];
    const userSim = Math.max(nameSimilarity(a.username, b.username), nameSimilarity(a.globalName ?? "", b.globalName ?? ""));
    signals.push({ label: "Username similarity", detail: `@${a.username} vs @${b.username}${a.globalName || b.globalName ? ` (${a.globalName ?? "?"} vs ${b.globalName ?? "?"})` : ""} — ${(userSim * 100).toFixed(0)}%`, score: userSim, weight: 0.2 });
    if (a.avatarHash && b.avatarHash) {
        const same = a.avatarHash === b.avatarHash;
        signals.push({ label: "Avatar", detail: same ? "Identical avatar image" : "Different avatars", score: same ? 1 : 0, weight: 0.15 });
    }
    const prox = proximityScore(a.createdAt, b.createdAt);
    signals.push({ label: "Account creation", detail: prox.detail, score: prox.score, weight: 0.15 });
    const aConns = new Map(a.connections.map(c => [`${c.type.toLowerCase()}::${c.name.toLowerCase()}`, c]));
    const sharedConns = b.connections.filter(c => aConns.has(`${c.type.toLowerCase()}::${c.name.toLowerCase()}`));
    if (a.connections.length || b.connections.length) {
        signals.push({
            label: "Linked accounts",
            detail: sharedConns.length ? `Same verified ${sharedConns.map(c => `${c.type} (${c.name})`).join(", ")}` : "No shared verified connections",
            score: sharedConns.length ? 1 : 0, weight: 0.2,
        });
    }
    const setB = new Set(b.guildIds);
    const sharedGuilds = a.guildIds.filter(g => setB.has(g));
    const union = new Set([...a.guildIds, ...b.guildIds]).size;
    if (union > 0) {
        signals.push({ label: "Shared servers", detail: `${sharedGuilds.length} of ${union} servers in common`, score: sharedGuilds.length / union, weight: 0.1 });
    }
    const sharedFlags = a.flags.filter(f => b.flags.includes(f));
    if (a.flags.length || b.flags.length) {
        signals.push({ label: "Shared badges", detail: sharedFlags.length ? sharedFlags.join(", ") : "No shared badges", score: sharedFlags.length ? Math.min(1, sharedFlags.length / 2) : 0, weight: 0.05 });
    }
    let dimensions: DimensionScore[] = [];
    if (fpA && fpB && fpA.total > 0 && fpB.total > 0) {
        const fp = compareFingerprints(fpA, fpB);
        dimensions = fp.dimensions;
        signals.push({ label: "Writing style", detail: `${(fp.score * 100).toFixed(0)}% stylometric match across ${fpA.total + fpB.total} messages`, score: fp.score, weight: 0.25 });
        const domA = new Set(fpA.topDomains.map(([d]) => d));
        const sharedDomains = fpB.topDomains.map(([d]) => d).filter(d => domA.has(d));
        if (sharedDomains.length) signals.push({ label: "Shared link domains", detail: sharedDomains.slice(0, 6).join(", "), score: Math.min(1, sharedDomains.length / 3), weight: 0.1 });
    }
    if (socialsA && socialsB) {
        const key = (s: SocialHit) => `${s.platform}::${s.handle.toLowerCase()}`;
        const setSA = new Set(socialsA.filter(s => s.platform !== "Possible handle").map(key));
        const shared = socialsB.filter(s => s.platform !== "Possible handle" && setSA.has(key(s)));
        if (shared.length) signals.push({ label: "Shared socials", detail: shared.map(s => `${s.platform} (${s.handle})`).join(", "), score: 1, weight: 0.2 });
    }
    const totalWeight = signals.reduce((s, x) => s + x.weight, 0) || 1;
    const score = (signals.reduce((s, x) => s + x.score * x.weight, 0) / totalWeight) * 100;
    return { score, verdict: verdictFor(score), signals, dimensions };
}
