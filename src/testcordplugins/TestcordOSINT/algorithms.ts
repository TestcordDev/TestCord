/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface MessageData {
    id: string;
    content: string;
    timestamp: string;
    author: {
        id: string;
        username: string;
        globalName?: string;
        discriminator?: string;
        avatar?: string;
        banner?: string;
        accentColor?: number;
        publicFlags?: number;
        bot?: boolean;
    };
    attachments: Array<{
        filename: string;
        url: string;
        content_type?: string;
        size: number;
        width?: number;
        height?: number;
    }>;
    embeds: any[];
    reactions?: any[];
    stickerItems?: any[];
    message_reference?: any;
    type: number;
    flags: number;
    tts: boolean;
    pinned: boolean;
    editedTimestamp?: string | null;
    interaction?: { name?: string; applicationId?: string; };
    mentionsList?: Array<{ id: string; username: string; }>;
    referencedAuthor?: { id: string; username: string; };
    channelId?: string;
    channelName?: string;
    guildId?: string;
    guildName?: string;
}

export interface AlgorithmResult {
    summary: string;
    sections: ResultSection[];
}

export interface ResultSection {
    title: string;
    content: string;
}

// eslint-disable-next-line no-misleading-character-class
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{200D}\u{20E3}\u{FE0F}\u{E0020}-\u{E007F}\u{1F000}-\u{1FFFF}]/gu;
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const MENTION_REGEX = /<@!?\d+>/g;
const CHANNEL_REGEX = /<#\d+>/g;
const SPOILER_REGEX = /\|\|[^|]+\|\|/;
const CUSTOM_EMOJI_REGEX = /<a?:\w+:\d+>/g;

const STOP_WORDS = new Set([
    "the", "a", "an", "is", "it", "to", "in", "of", "and", "or", "for",
    "on", "at", "by", "with", "from", "this", "that", "i", "you", "he",
    "she", "we", "they", "me", "him", "her", "us", "them", "my", "your",
    "his", "its", "our", "their", "what", "which", "who", "whom", "how",
    "when", "where", "why", "not", "no", "do", "does", "did", "have",
    "has", "had", "be", "am", "are", "was", "were", "been", "will",
    "would", "could", "should", "may", "might", "shall", "can", "but",
    "if", "then", "so", "than", "too", "very", "just", "about", "up",
    "out", "all", "also", "as", "into", "some", "any", "more", "other",
    "only", "even", "back", "there", "here", "now", "new", "like",
]);

function formatHour(h: number, use24h: boolean): string {
    if (use24h) return `${String(h).padStart(2, "0")}:00`;
    const ampm = h < 12 ? "am" : "pm";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}${ampm}`;
}

function getHour(timestamp: string): number {
    try { return new Date(timestamp).getUTCHours(); } catch { return -1; }
}

function getDayOfWeek(timestamp: string): number {
    try { return new Date(timestamp).getUTCDay(); } catch { return -1; }
}

function extractWords(text: string): string[] {
    return text
        .toLowerCase()
        .replace(EMOJI_REGEX, " ")
        .replace(URL_REGEX, " ")
        .replace(CUSTOM_EMOJI_REGEX, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/[^a-z0-9\s'-]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function topN<T>(map: Map<T, number>, n: number): Array<[T, number]> {
    return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}

function estimateTimezone(hourCounts: Map<number, number>): { offset: number; label: string; confidence: string; } {
    const totalMsgs = [...hourCounts.values()].reduce((s, c) => s + c, 0);
    if (totalMsgs === 0) return { offset: 0, label: "UTC+0", confidence: "N/A" };

    const activeHours = [...hourCounts.entries()]
        .filter(([, c]) => c > totalMsgs * 0.03)
        .map(([h]) => h)
        .sort((a, b) => a - b);

    const centerHour = activeHours.length > 0
        ? Math.round(activeHours.reduce((s, h) => s + h, 0) / activeHours.length)
        : topN(hourCounts, 1)[0]?.[0] ?? 12;

    const typicalActiveCenter = 14;
    const offset = ((centerHour - typicalActiveCenter) + 24) % 24;
    const adjustedOffset = offset > 12 ? offset - 24 : offset;

    let confidence = "low";
    if (activeHours.length >= 8) confidence = "medium";
    if (activeHours.length >= 12) confidence = "high";

    const sign = adjustedOffset >= 0 ? "+" : "-";
    return { offset: adjustedOffset, label: `UTC${sign}${Math.abs(adjustedOffset)}`, confidence };
}

function estimateSleepSchedule(hourCounts: Map<number, number>): { start: string; end: string; hours: number; } {
    const totalMsgs = [...hourCounts.values()].reduce((s, c) => s + c, 0);
    if (totalMsgs === 0) return { start: "N/A", end: "N/A", hours: 0 };

    const threshold = totalMsgs * 0.01;
    const quietHours: number[] = [];
    for (let h = 0; h < 24; h++) {
        if ((hourCounts.get(h) ?? 0) < threshold) quietHours.push(h);
    }
    if (quietHours.length === 0) return { start: "N/A", end: "N/A", hours: 0 };

    let bestStart = quietHours[0], bestLen = 1, curStart = quietHours[0], curLen = 1;
    for (let i = 1; i < quietHours.length; i++) {
        if (quietHours[i] === quietHours[i - 1] + 1) {
            curLen++;
        } else {
            if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
            curStart = quietHours[i]; curLen = 1;
        }
    }
    if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }

    const sleepEnd = (bestStart + bestLen) % 24;
    return { start: `${String(bestStart).padStart(2, "0")}:00`, end: `${String(sleepEnd).padStart(2, "0")}:00`, hours: bestLen };
}

function findActiveWindows(hourCounts: Map<number, number>, use24h: boolean): string[] {
    const totalMsgs = [...hourCounts.values()].reduce((s, c) => s + c, 0);
    if (totalMsgs === 0) return [];

    const windows: Array<{ start: number; end: number; msgs: number; }> = [];
    let inWindow = false, winStart = 0, winMsgs = 0;
    const threshold = totalMsgs * 0.03;

    for (let h = 0; h < 48; h++) {
        const hMod = h % 24;
        const count = hourCounts.get(hMod) ?? 0;
        if (count >= threshold) {
            if (!inWindow) { winStart = hMod; winMsgs = 0; inWindow = true; }
            winMsgs += count;
        } else if (inWindow) {
            windows.push({ start: winStart, end: hMod, msgs: winMsgs });
            inWindow = false;
        }
    }
    if (inWindow) windows.push({ start: winStart, end: (winStart + 24) % 24, msgs: winMsgs });

    windows.sort((a, b) => b.msgs - a.msgs);
    return windows.slice(0, 3).map(w => `${formatHour(w.start, use24h)}-${formatHour(w.end, use24h)}`);
}

function detectLanguagePatterns(messages: MessageData[]): string[] {
    const patterns: string[] = [];
    const msgTexts = messages.map(m => m.content.toLowerCase());

    const questions = msgTexts.filter(t => t.includes("?")).length;
    if (questions / messages.length > 0.15) patterns.push("Asks many questions (inquisitive)");

    const exclamations = msgTexts.filter(t => t.includes("!")).length;
    if (exclamations / messages.length > 0.1) patterns.push("Uses exclamation marks frequently (expressive)");

    const allCaps = msgTexts.filter(t => {
        const letters = t.replace(/[^a-zA-Z]/g, "");
        return letters.length > 3 && t === t.toUpperCase();
    }).length;
    if (allCaps / messages.length > 0.02) patterns.push("Types in ALL CAPS sometimes (emphatic)");

    const ellipsis = msgTexts.filter(t => t.includes("...")).length;
    if (ellipsis / messages.length > 0.03) patterns.push("Uses ellipsis frequently (trailing off)");

    const dashes = msgTexts.filter(t => /\s-\s|—/.test(t)).length;
    if (dashes / messages.length > 0.05) patterns.push("Uses dashes/em-dashes (structured)");

    const oneWordReplies = messages.filter(m => extractWords(m.content).length === 1 && m.content.length < 10).length;
    if (oneWordReplies / messages.length > 0.15) patterns.push("Frequent one-word replies (terse)");

    return patterns;
}

// ── Account intelligence ──

const DISCORD_EPOCH = 1420070400000n;

export function snowflakeToDate(id: string): Date | null {
    try {
        const asBig = BigInt(id);
        if (asBig <= 0n) return null;
        return new Date(Number(asBig >> 22n) + Number(DISCORD_EPOCH));
    } catch {
        return null;
    }
}

const USER_FLAG_LABELS: Array<[number, string]> = [
    [1 << 0, "Discord Staff"],
    [1 << 1, "Partnered Server Owner"],
    [1 << 2, "HypeSquad Events"],
    [1 << 3, "Bug Hunter Level 1"],
    [1 << 6, "HypeSquad Bravery"],
    [1 << 7, "HypeSquad Brilliance"],
    [1 << 8, "HypeSquad Balance"],
    [1 << 9, "Early Supporter"],
    [1 << 14, "Bug Hunter Level 2"],
    [1 << 16, "Verified Bot"],
    [1 << 17, "Early Verified Bot Developer"],
    [1 << 18, "Moderator Programs Alumni"],
    [1 << 19, "System User"],
    [1 << 22, "Active Developer"]
];

export function decodeUserFlags(flags?: number): string[] {
    if (!flags) return [];
    return USER_FLAG_LABELS.filter(([bit]) => (flags & bit) === bit).map(([, label]) => label);
}

function buildAccountSection(messages: MessageData[]): ResultSection | null {
    const { author } = messages[0];
    const createdAt = snowflakeToDate(author.id);
    const badges = decodeUserFlags(author.publicFlags);
    const lines: string[] = [];

    if (createdAt && !Number.isNaN(createdAt.getTime())) {
        const ageDays = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
        const ageText = ageDays >= 365
            ? `${(ageDays / 365.25).toFixed(1)} years`
            : ageDays >= 30 ? `${Math.floor(ageDays / 30.44)} months` : `${ageDays} days`;
        lines.push(`Account created: ${createdAt.toLocaleDateString()} ${createdAt.toLocaleTimeString()}`);
        lines.push(`Account age: ${ageText} (${ageDays.toLocaleString()} days)`);
    } else {
        lines.push("Account created: Unknown (could not parse user ID)");
    }

    lines.push(`Bot account: ${author.bot ? "Yes" : "No"}`);
    lines.push(`Badges (from flags): ${badges.length > 0 ? badges.join(", ") : "None visible"}`);
    lines.push(`Display name: ${(author.globalName && author.globalName !== author.username) ? `"${author.globalName}" over "${author.username}" (customised)` : "identical to username"}`);

    return { title: "Account Intelligence", content: lines.join("\n") };
}

function estimateAccountAge(messages: MessageData[]): string {
    if (messages.length < 2) return "Unknown";
    const timestamps = messages.map(m => new Date(m.timestamp).getTime()).sort((a, b) => a - b);
    const spanMs = timestamps[timestamps.length - 1] - timestamps[0];
    const spanDays = Math.round(spanMs / 86400000);
    if (spanDays < 1) return "Same day";
    if (spanDays < 7) return `${spanDays} days`;
    if (spanDays < 30) return `${Math.round(spanDays / 7)} weeks`;
    if (spanDays < 365) return `${Math.round(spanDays / 30)} months`;
    return `${(spanDays / 365).toFixed(1)} years`;
}

// ── Personality archetypes ──

interface Archetype {
    name: string;
    phrases: string[];
    emojis: string[];
    weightPhrase: number;
    weightEmoji: number;
}

const ARCHETYPES: Archetype[] = [
    {
        name: "Com / Drill",
        phrases: ["on god", "no cap", "gang", "opp", "deadass", "wallahi", "fr fr", "smoke", "drill", "tweakin", "ot", "glizzy"],
        emojis: ["🔱", "😈", "🔫", "🅿️"],
        weightPhrase: 3,
        weightEmoji: 2
    },
    {
        name: "Preppy / Aesthetic",
        phrases: ["slay", "bestie", "obsessed", "so cute", "vibes", "girlie", "aesthetic", "iconic", "ate that", "so real", "mother is mothering", "period"],
        emojis: ["✨", "💖", "🩷", "🌸", "🫶", "💅", "🎀", "🤍"],
        weightPhrase: 3,
        weightEmoji: 2
    },
    {
        name: "Gangster / Hood",
        phrases: ["bruh", "ain't", "aint", "onb", "fym", "ts pmo", "stfu", "wsp", "hbu", "lmk", "ykw"],
        emojis: ["💀", "😭", "🗿", "🤦"],
        weightPhrase: 2,
        weightEmoji: 1
    },
    {
        name: "Gamer",
        phrases: ["gg", "ez", "ranked", "lobby", "clutch", "lfg", "nerf", "buff", "loadout", "spawn", "noob", "1v1", "sweat", "fps"],
        emojis: ["🎮", "🕹️", "🎯"],
        weightPhrase: 3,
        weightEmoji: 2
    },
    {
        name: "Techie / Nerd",
        phrases: ["api", "linux", "python", "javascript", "typescript", "deploy", "repo", "commit", "docker", "regex", "kernel", "compile", "server"],
        emojis: ["💻", "⌨️", "🖥️"],
        weightPhrase: 3,
        weightEmoji: 1
    },
    {
        name: "Edgy / Ironic",
        phrases: ["ratio", "cope", "seethe", "skill issue", "fell off", "rent free", "touch grass", "L +", "mad?"],
        emojis: ["🗿", "😬", "🥶"],
        weightPhrase: 3,
        weightEmoji: 1
    },
    {
        name: "Soft / Romantic",
        phrases: ["i love you", "miss you", "so proud", "my heart", "cutest", "love u", "ily", "hug"],
        emojis: ["🥺", "💗", "🫂", "🌷", "☁️", "🧸"],
        weightPhrase: 3,
        weightEmoji: 2
    },
    {
        name: "Formal / Professional",
        phrases: ["however", "therefore", "regarding", "kindly", "please find", "as discussed", "furthermore", "in conclusion", "per my last"],
        emojis: [],
        weightPhrase: 4,
        weightEmoji: 0
    }
];

interface PersonalityScore {
    name: string;
    score: number;
    signals: string[];
}

function analyzePersonality(messages: MessageData[]): PersonalityScore[] {
    const total = messages.length || 1;

    let lowerCount = 0, punctuatedCount = 0;
    for (const msg of messages) {
        const text = msg.content.trim();
        const letters = text.replace(/[^a-zA-Z]/g, "");
        if (letters.length > 6) {
            if (letters === letters.toLowerCase()) lowerCount++;
            if (/[.!?]$/.test(text)) punctuatedCount++;
        }
    }

    return ARCHETYPES.map(archetype => {
        let rawScore = 0;
        for (const msg of messages) {
            const text = msg.content.toLowerCase();
            for (const phrase of archetype.phrases) {
                if (text.includes(phrase)) rawScore += archetype.weightPhrase;
            }
            for (const emoji of archetype.emojis) {
                if (msg.content.includes(emoji)) rawScore += archetype.weightEmoji;
            }
        }

        if (archetype.name === "Formal / Professional") {
            rawScore += ((punctuatedCount / total) * 40) + ((1 - lowerCount / total) * 20);
        } else if (archetype.name === "Gangster / Hood") {
            rawScore += (lowerCount / total) * 15;
        }

        const signals: string[] = [];
        if (rawScore > 0) {
            const matchedPhrases = archetype.phrases.filter(p => messages.some(m => m.content.toLowerCase().includes(p))).slice(0, 3);
            if (matchedPhrases.length > 0) signals.push(`says "${matchedPhrases.join('", "')}"`);
            if (archetype.emojis.length > 0) {
                const matchedEmojis = archetype.emojis.filter(e => messages.some(m => m.content.includes(e)));
                if (matchedEmojis.length > 0) signals.push(`uses ${matchedEmojis.join(" ")}`);
            }
            if (archetype.name === "Formal / Professional" && punctuatedCount / total > 0.5)
                signals.push(`${Math.round(punctuatedCount / total * 100)}% of messages end with punctuation`);
            if (archetype.name === "Gangster / Hood" && lowerCount / total > 0.5)
                signals.push(`${Math.round(lowerCount / total * 100)}% of messages fully lowercase`);
        }

        // Normalise to a 0-100 affinity per archetype
        const score = Math.min(100, Math.round((rawScore / total) * 25));
        return { name: archetype.name, score, signals };
    }).sort((a, b) => b.score - a.score);
}

function buildPersonalitySection(messages: MessageData[]): ResultSection | null {
    const scores = analyzePersonality(messages);
    const meaningful = scores.filter(s => s.score >= 8).slice(0, 4);
    if (meaningful.length === 0) return null;

    const lines = meaningful.map(s =>
        `${s.name}: ${s.score}%${s.signals.length ? ` — ${s.signals.join("; ")}` : ""}`
    );

    return { title: "Personality Profile", content: lines.join("\n") };
}

// ── Danger assessment ──

const IP_LOGGER_DOMAINS = [
    "grabify.link", "iplogger.org", "iplogger.com", "iplogger.ru", "2no.co",
    "yip.su", "ipgrab.org", "ipinfo.info", "blip.net", "ps3cfw.com", "urlx.one",
    "readreceipts.com", "tracker.ie", "shorte.st"
];

const SHORTENER_DOMAINS = [
    "bit.ly", "tinyurl.com", "goo.gl", "is.gd", "t.co", "cutt.ly", "rb.gy",
    "rebrand.ly", "shorturl.at", "ow.ly", "buff.ly", "shorte.st", "adf.ly"
];

const SCAM_PHRASES = [
    "free nitro", "nitro giveaway", "free gift", "claim your nitro",
    "steam gift", "airdrop", "double your", "giveaway winner",
    "verify your account", "login to discord", "confirm your password",
    "seed phrase", "wallet connect", "crypto giveaway", "investment opportunity",
    "make money fast", "work from home", "cashapp me", "first to dm"
];

const PHISHY_DOMAIN_PATTERNS = [
    /steamcom[a-z4-9]*unity/i, // steamcomrnunity etc
    /d[i1l][s5]c[o0]rd[^a-z]/i, // discorcl, d1scord lookalikes with suffix
    /d[i1]scorcl/i,
    /[n m]itro[-.]?(gift|free|claim)/i,
    /gift-?nitro/i,
    /discord-?nitro[-.]?gift/i
];

const HOSTILE_PATTERNS = [
    /\bkys\b/i, /kill (?:you|u|urself|yourself)/i, /\bdox(?:z|g)?\b/i,
    /\bddos\b/i, /\bswat\b/i, /i(?:'| a)?m going to (?:find|hurt|kill)/i,
    /\br@pe\b/i, /watch your (?:back|door)/i
];

export interface FlaggedLink {
    url: string;
    domain: string;
    reason: string;
    risk: "high" | "medium" | "low";
}

function analyzeDanger(messages: MessageData[]): {
    score: number;
    level: string;
    factors: string[];
    flaggedLinks: FlaggedLink[];
} {
    let score = 0;
    const factors: string[] = [];
    const flaggedLinks: FlaggedLink[] = [];
    const seenFlagged = new Set<string>();

    const allUrls: string[] = [];
    for (const msg of messages) allUrls.push(...(msg.content.match(URL_REGEX) ?? []));

    for (const url of allUrls) {
        let domain = "";
        try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { continue; }

        const flag = (reason: string, risk: FlaggedLink["risk"]) => {
            const key = `${domain}:${reason}`;
            if (seenFlagged.has(key)) return;
            seenFlagged.add(key);
            flaggedLinks.push({ url, domain, reason, risk });
        };

        if (IP_LOGGER_DOMAINS.includes(domain)) {
            flag("Known IP logger / grabber", "high");
            score += 25;
        }

        if (SHORTENER_DOMAINS.includes(domain)) {
            flag("Link shortener (destination hidden)", "medium");
            score += 4;
        }

        if (PHISHY_DOMAIN_PATTERNS.some(re => re.test(domain)) && !/^(?:steamcommunity\.com|discord\.com|discord\.gg)$/.test(domain)) {
            flag("Domain mimics a known brand (likely phishing)", "high");
            score += 20;
        }
    }

    const scamHits = new Map<string, number>();
    for (const msg of messages) {
        const text = msg.content.toLowerCase();
        for (const phrase of SCAM_PHRASES) {
            if (text.includes(phrase)) scamHits.set(phrase, (scamHits.get(phrase) ?? 0) + 1);
        }
    }
    if (scamHits.size > 0) {
        score += Math.min(25, scamHits.size * 8);
        factors.push(`Scam-style phrases used: ${[...scamHits.keys()].slice(0, 5).map(p => `"${p}"`).join(", ")}`);
    }

    const hostileMsgs = messages.filter(m => HOSTILE_PATTERNS.some(re => re.test(m.content)));
    if (hostileMsgs.length > 0) {
        score += Math.min(20, hostileMsgs.length * 10);
        factors.push(`Hostile/threatening language in ${hostileMsgs.length} message${hostileMsgs.length === 1 ? "" : "s"}`);
    }

    const totalMentions = messages.reduce((sum, m) => sum + (m.mentionsList?.length ?? 0), 0);
    const mentionRate = totalMentions / messages.length;
    if (mentionRate > 2) {
        score += 10;
        factors.push(`Mass-mention behaviour (${mentionRate.toFixed(1)} mentions per message on average)`);
    }

    const inviteCount = messages.filter(m => /discord\.gg\/|discord\.com\/invite\//i.test(m.content)).length;
    const inviteRate = inviteCount / messages.length;
    if (inviteRate > 0.2) {
        score += 12;
        factors.push(`Server invite spam (${Math.round(inviteRate * 100)}% of messages contain invites)`);
    }

    score = Math.min(100, Math.round(score));

    let level = "Minimal";
    if (score >= 80) level = "Critical";
    else if (score >= 60) level = "High";
    else if (score >= 40) level = "Moderate";
    else if (score >= 20) level = "Low";

    for (const factor of factors) {
        if (!factors.includes(factor)) continue;
    }

    return { score, level, factors, flaggedLinks };
}

const SCRIPT_RANGES: Array<{ name: string; regex: RegExp; }> = [
    { name: "Latin (English/European)", regex: /[a-zA-ZÀ-ÿ]/ },
    { name: "Cyrillic (Russian/Ukrainian/etc)", regex: /[\u0400-\u04FF]/ },
    { name: "Greek", regex: /[\u0370-\u03FF]/ },
    { name: "Arabic", regex: /[\u0600-\u06FF]/ },
    { name: "Hebrew", regex: /[\u0590-\u05FF]/ },
    { name: "CJK (Chinese/Japanese Kanji)", regex: /[\u4E00-\u9FFF]/ },
    { name: "Japanese Kana", regex: /[\u3040-\u30FF]/ },
    { name: "Korean Hangul", regex: /[\uAC00-\uD7AF]/ },
    { name: "Thai", regex: /[\u0E00-\u0E7F]/ },
    { name: "Devanagari (Hindi)", regex: /[\u0900-\u097F]/ }
];

// ── Social network / channels / habits / commands / languages / platforms ──

function buildSocialSection(messages: MessageData[]): ResultSection | null {
    const mentionCounts = new Map<string, { count: number; username: string; }>();
    const replyCounts = new Map<string, { count: number; username: string; }>();

    for (const msg of messages) {
        for (const mention of msg.mentionsList ?? []) {
            const entry = mentionCounts.get(mention.id) ?? { count: 0, username: mention.username };
            entry.count++;
            entry.username = mention.username || entry.username;
            mentionCounts.set(mention.id, entry);
        }
        const ref = msg.referencedAuthor;
        if (ref && ref.id !== msg.author.id) {
            const entry = replyCounts.get(ref.id) ?? { count: 0, username: ref.username };
            entry.count++;
            entry.username = ref.username || entry.username;
            replyCounts.set(ref.id, entry);
        }
    }

    const totalMentions = [...mentionCounts.values()].reduce((s, e) => s + e.count, 0);
    if (totalMentions === 0 && replyCounts.size === 0) return null;

    const topMentions = topN(new Map([...mentionCounts].map(([id, e]) => [id, e.count])), 5)
        .map(([id]) => `@${mentionCounts.get(id)!.username} (${mentionCounts.get(id)!.count})`)
        .join(", ");
    const topReplies = topN(new Map([...replyCounts].map(([id, e]) => [id, e.count])), 5)
        .map(([id]) => `${replyCounts.get(id)!.username || id} (${replyCounts.get(id)!.count})`)
        .join(", ");

    const lines = [
        totalMentions > 0 ? `Mentions sent: ${totalMentions}` : null,
        topMentions ? `Most mentioned users: ${topMentions}` : null,
        replyCounts.size > 0 ? `Most replied-to users: ${topReplies}` : null,
        `Distinct people interacted with: ${new Set([...mentionCounts.keys(), ...replyCounts.keys()]).size}`
    ].filter(Boolean);

    return { title: "Social Network", content: lines.join("\n") };
}

function buildChannelSection(messages: MessageData[]): ResultSection | null {
    const channelCounts = new Map<string, number>();
    const guildCounts = new Map<string, number>();

    for (const msg of messages) {
        const chanLabel = msg.channelName ? `#${msg.channelName}` : (msg.channelId ?? "unknown");
        channelCounts.set(chanLabel, (channelCounts.get(chanLabel) ?? 0) + 1);
        const guildLabel = msg.guildName ?? "Direct messages";
        guildCounts.set(guildLabel, (guildCounts.get(guildLabel) ?? 0) + 1);
    }

    const topChannels = topN(channelCounts, 8).map(([c, n]) => `${c} (${n})`).join(", ");
    const topGuilds = topN(guildCounts, 6).map(([g, n]) => `${g} (${n})`).join(", ");

    return {
        title: "Channel & Server Presence",
        content: [
            `Servers observed in: ${guildCounts.size}`,
            `Top servers: ${topGuilds}`,
            `Channels seen in: ${channelCounts.size}`,
            `Most active channels: ${topChannels}`
        ].join("\n")
    };
}

function buildHabitsSection(messages: MessageData[], totalMessages: number): ResultSection | null {
    const sorted = messages.map(m => new Date(m.timestamp).getTime()).sort((a, b) => a - b);
    let burstCount = 0, maxBurst = 0, currentBurst = 1;
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] <= 30_000) currentBurst++;
        else { if (currentBurst > 1) burstCount++; maxBurst = Math.max(maxBurst, currentBurst); currentBurst = 1; }
    }
    if (currentBurst > 1) { burstCount++; maxBurst = Math.max(maxBurst, currentBurst); }

    const editedCount = messages.filter(m => m.editedTimestamp != null).length;
    const longest = messages.reduce((best, m) => m.content.length > best.content.length ? m : best, messages[0]);
    const mostReacted = messages.reduce((best, m) => {
        const score = (m.reactions ?? []).reduce((s, r: any) => s + (r?.count ?? 0), 0);
        const bestScore = (best.reactions ?? []).reduce((s, r: any) => s + (r?.count ?? 0), 0);
        return score > bestScore ? m : best;
    }, messages[0]);
    const bestReactionTotal = (mostReacted.reactions ?? []).reduce((s: number, r: any) => s + (r?.count ?? 0), 0);

    const lines = [
        `Message bursts (<30s apart): ${burstCount}, longest burst ${maxBurst} messages`,
        editedCount > 0 ? `Edited messages: ${editedCount} (${Math.round(editedCount / totalMessages * 100)}% of all sent)` : "No edits observed",
        `Longest message: ${longest.content.length.toLocaleString()} chars — "${longest.content.slice(0, 80).replace(/\n/g, " ")}${longest.content.length > 80 ? "..." : ""}"`,
        bestReactionTotal > 0 ? `Most reacted message: ${bestReactionTotal} reactions — "${mostReacted.content.slice(0, 60).replace(/\n/g, " ") || "(no text)"}"` : null,
        `Deleted-then-resent duplicates: ${((): number => {
            const seen = new Set<string>();
            let dupes = 0;
            for (const m of messages) {
                const key = m.content.trim().toLowerCase();
                if (!key) continue;
                if (seen.has(key)) dupes++;
                else seen.add(key);
            }
            return dupes;
        })()}`
    ].filter(Boolean);

    return { title: "Messaging Habits", content: lines.join("\n") };
}

function buildCommandSection(messages: MessageData[]): ResultSection | null {
    const commandCounts = new Map<string, number>();
    for (const msg of messages) {
        const name = msg.interaction?.name;
        if (name) commandCounts.set(name, (commandCounts.get(name) ?? 0) + 1);
    }
    if (commandCounts.size === 0) return null;

    const totalUses = [...commandCounts.values()].reduce((s, c) => s + c, 0);
    const topCommands = topN(commandCounts, 10).map(([cmd, c]) => `/${cmd} (${c})`).join(", ");

    return {
        title: "Bot Command Usage",
        content: [
            `Slash command uses observed: ${totalUses}`,
            `Commands: ${topCommands}`
        ].join("\n")
    };
}

function buildLanguageSection(messages: MessageData[]): ResultSection | null {
    const scriptCounts = new Map<string, number>();
    let msgsWriting = 0;

    for (const msg of messages) {
        const text = msg.content.replace(URL_REGEX, "").trim();
        if (!text) continue;
        msgsWriting++;
        for (const script of SCRIPT_RANGES) {
            if (script.regex.test(text)) {
                scriptCounts.set(script.name, (scriptCounts.get(script.name) ?? 0) + 1);
            }
        }
    }

    if (msgsWriting === 0) return null;
    const detected = topN(scriptCounts, scriptCounts.size)
        .filter(([, c]) => c / msgsWriting >= 0.05)
        .map(([name, c]) => `${name}: ${Math.round(c / msgsWriting * 100)}% of messages`);

    if (detected.length <= 1) return null;

    return { title: "Languages Detected", content: ["Script usage in messages:", ...detected.map(d => `  - ${d}`)].join("\n") };
}

const PLATFORM_LABELS: Array<[RegExp, string]> = [
    [/youtube\.com|youtu\.be/, "YouTube"],
    [/twitter\.com|^x\.com/, "Twitter/X"],
    [/tiktok\.com/, "TikTok"],
    [/instagram\.com/, "Instagram"],
    [/reddit\.com|redd\.it/, "Reddit"],
    [/github\.com|gist\.github/, "GitHub"],
    [/twitch\.tv/, "Twitch"],
    [/spotify\.com|spotify\.link/, "Spotify"],
    [/steampowered\.com|steamcommunity\.com/, "Steam"],
    [/soundcloud\.com/, "SoundCloud"],
    [/t\.me\/|telegram\.me/, "Telegram"],
    [/kick\.com/, "Kick"]
];

function buildPlatformSection(messages: MessageData[]): ResultSection | null {
    const platformCounts = new Map<string, number>();
    for (const msg of messages) {
        const urls = msg.content.match(URL_REGEX) ?? [];
        const seen = new Set<string>();
        for (const url of urls) {
            for (const [regex, label] of PLATFORM_LABELS) {
                if (regex.test(url) && !seen.has(label)) {
                    seen.add(label);
                    platformCounts.set(label, (platformCounts.get(label) ?? 0) + 1);
                }
            }
        }
        // Spotify presence embeds count as listening signals
        if (msg.embeds?.some((e: any) => e?.provider?.name === "Spotify" || e?.author?.name === "Spotify")) {
            platformCounts.set("Spotify", (platformCounts.get("Spotify") ?? 0) + 1);
        }
    }

    if (platformCounts.size === 0) return null;
    const breakdown = topN(platformCounts, 10).map(([p, c]) => `${p}: ${c} message${c === 1 ? "" : "s"}`).join("\n  ");

    return { title: "Platform Footprint", content: ["Platforms linked or referenced:", `  ${breakdown}`].join("\n") };
}

function buildFormattingSection(messages: MessageData[]): ResultSection | null {
    let bold = 0, italic = 0, inlineCode = 0, blockquote = 0, underline = 0, headingLines = 0, listLines = 0;

    for (const msg of messages) {
        if (/\*\*[^*]+\*\*/.test(msg.content)) bold++;
        if (/(?:^|\W)\*[^*\n]+\*(?:\W|$)|__[^_]+__/.test(msg.content)) italic++;
        if (/`[^`\n]+`/.test(msg.content) && !msg.content.includes("```")) inlineCode++;
        if (/^> /m.test(msg.content)) blockquote++;
        if (/__/.test(msg.content)) underline++;
        if (/^#{1,3} \S/m.test(msg.content)) headingLines++;
        if (/^[-*] \S/m.test(msg.content)) listLines++;
    }

    const total = messages.length || 1;
    const lines = [
        bold > 0 ? `Bold text: ${bold} msgs (${Math.round(bold / total * 100)}%)` : null,
        italic > 0 ? `Italic text: ${italic} msgs (${Math.round(italic / total * 100)}%)` : null,
        underline > 0 ? `Underlined: ${underline} msgs` : null,
        inlineCode > 0 ? `Inline code: ${inlineCode} msgs` : null,
        blockquote > 0 ? `Quote blocks: ${blockquote} msgs` : null,
        headingLines > 0 ? `Markdown headings: ${headingLines} msgs` : null,
        listLines > 0 ? `Bullet lists: ${listLines} msgs` : null
    ].filter(Boolean);

    if (lines.length === 0) return null;
    return { title: "Formatting Style", content: lines.join("\n") };
}

export function analyzeMessages(messages: MessageData[], use24h = false): AlgorithmResult {
    if (messages.length === 0) {
        return { summary: "No messages found for this user.", sections: [] };
    }

    const sections: ResultSection[] = [];
    const { author } = messages[0];

    const totalMessages = messages.length;
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const avgLength = Math.round(totalChars / totalMessages);
    const totalAttachments = messages.reduce((sum, m) => sum + m.attachments.length, 0);
    const totalEmbeds = messages.reduce((sum, m) => sum + m.embeds.length, 0);
    const totalReactions = messages.reduce((sum, m) => sum + (m.reactions?.length ?? 0), 0);

    sections.push({
        title: "Basic Statistics",
        content: [
            `Messages analyzed: ${totalMessages}`,
            `Total characters: ${totalChars.toLocaleString()}`,
            `Average message length: ${avgLength} chars`,
            `Attachments sent: ${totalAttachments}`,
            `Embeds: ${totalEmbeds}`,
            `Reactions: ${totalReactions}`,
        ].join("\n"),
    });

    const hourCounts = new Map<number, number>();
    const dayCounts = new Map<number, number>();
    const hourCountsByDay = new Map<number, Map<number, number>>();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (const msg of messages) {
        const hour = getHour(msg.timestamp);
        if (hour >= 0) hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
        const day = getDayOfWeek(msg.timestamp);
        if (day >= 0) {
            dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
            if (!hourCountsByDay.has(day)) hourCountsByDay.set(day, new Map());
            const dayMap = hourCountsByDay.get(day)!;
            dayMap.set(hour, (dayMap.get(hour) ?? 0) + 1);
        }
    }

    const peakHours = topN(hourCounts, 3).map(([h, c]) => `${formatHour(h, use24h)} (${c})`).join(", ");
    const peakDays = topN(dayCounts, 3).map(([d, c]) => `${dayNames[d]} (${c})`).join(", ");

    const sortedHours = [...hourCounts.keys()].sort((a, b) => a - b);
    let activeStart = "?", activeEnd = "?";
    if (sortedHours.length > 0) {
        activeStart = formatHour(sortedHours[0], use24h);
        activeEnd = formatHour(sortedHours[sortedHours.length - 1], use24h);
    }

    const nightMsgs = (hourCounts.get(0) ?? 0) + (hourCounts.get(1) ?? 0) + (hourCounts.get(2) ?? 0) + (hourCounts.get(3) ?? 0) + (hourCounts.get(4) ?? 0) + (hourCounts.get(5) ?? 0);
    const dayMsgs = (hourCounts.get(6) ?? 0) + (hourCounts.get(7) ?? 0) + (hourCounts.get(8) ?? 0) + (hourCounts.get(9) ?? 0) + (hourCounts.get(10) ?? 0) + (hourCounts.get(11) ?? 0) + (hourCounts.get(12) ?? 0) + (hourCounts.get(13) ?? 0) + (hourCounts.get(14) ?? 0) + (hourCounts.get(15) ?? 0) + (hourCounts.get(16) ?? 0) + (hourCounts.get(17) ?? 0);

    sections.push({
        title: "Activity Pattern",
        content: [
            `Most active hours: ${peakHours || "N/A"}`,
            `Most active days: ${peakDays || "N/A"}`,
            `Typical active window: ${activeStart} - ${activeEnd} UTC`,
            nightMsgs > dayMsgs ? "Likely a night owl (more messages between 12am-5am)" : null,
        ].filter(Boolean).join("\n"),
    });

    const tz = estimateTimezone(hourCounts);
    const sleep = estimateSleepSchedule(hourCounts);
    const activeWindows = findActiveWindows(hourCounts, use24h);

    sections.push({
        title: "Timezone & Schedule",
        content: [
            `Estimated timezone: ${tz.label} (confidence: ${tz.confidence})`,
            `Most active time: ${activeWindows[0] || "N/A"}`,
            activeWindows.length > 1 ? `Secondary active: ${activeWindows[1]}` : null,
            `Likely sleep hours: ${sleep.start} - ${sleep.end} UTC (~${sleep.hours}h)`,
            `Wake time (estimated): ${formatHour(parseInt(sleep.end) || 8, use24h)} local`,
            `Bedtime (estimated): ${formatHour(parseInt(sleep.start) || 23, use24h)} local`,
        ].filter(Boolean).join("\n"),
    });

    const heatmapLines: string[] = [];
    for (let d = 0; d < 7; d++) {
        const dayMap = hourCountsByDay.get(d) ?? new Map();
        const maxForDay = Math.max(...dayMap.values(), 1);
        const bar = Array.from({ length: 24 }, (_, h) => {
            const count = dayMap.get(h) ?? 0;
            if (count === 0) return "\u2591";
            const ratio = count / maxForDay;
            if (ratio > 0.75) return "\u2588";
            if (ratio > 0.5) return "\u2593";
            if (ratio > 0.25) return "\u2592";
            return "\u2591";
        }).join("");
        heatmapLines.push(`${dayNames[d].slice(0, 3)} ${bar}`);
    }

    sections.push({
        title: "Weekly Heatmap",
        content: ["Hours: 00                        23", ...heatmapLines].join("\n"),
    });

    const wordCounts = new Map<string, number>();
    for (const msg of messages) {
        for (const w of extractWords(msg.content)) {
            wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
        }
    }

    const topWords = topN(wordCounts, 15).map(([w, c]) => `${w} (${c})`).join(", ");
    const uniqueWords = wordCounts.size;

    sections.push({
        title: "Language & Vocabulary",
        content: [
            `Unique words used: ${uniqueWords}`,
            `Top words: ${topWords || "N/A"}`,
            `Avg words per message: ${Math.round(messages.reduce((s, m) => s + extractWords(m.content).length, 0) / totalMessages)}`,
            `Vocabulary richness: ${(uniqueWords / Math.max(totalChars, 1) * 100).toFixed(2)}%`,
        ].join("\n"),
    });

    const langPatterns = detectLanguagePatterns(messages);
    if (langPatterns.length > 0) {
        sections.push({ title: "Communication Style", content: langPatterns.join("\n") });
    }

    const emojiCounts = new Map<string, number>();
    let customEmojiCount = 0;
    for (const msg of messages) {
        for (const e of msg.content.match(EMOJI_REGEX) ?? []) {
            emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);
        }
        customEmojiCount += (msg.content.match(CUSTOM_EMOJI_REGEX) ?? []).length;
    }

    const totalEmojis = [...emojiCounts.values()].reduce((s, c) => s + c, 0);
    const topEmojis = topN(emojiCounts, 10).map(([e, c]) => `${e} (${c})`).join(", ");

    sections.push({
        title: "Emoji Usage",
        content: [
            `Total emojis used: ${totalEmojis}`,
            `Custom Discord emojis: ${customEmojiCount}`,
            `Unique native emojis: ${emojiCounts.size}`,
            `Top emojis: ${topEmojis || "None"}`,
            `Emoji density: ${(totalEmojis / totalChars * 100).toFixed(2)}% of characters`,
        ].join("\n"),
    });

    let totalLinks = 0, totalMentions = 0, totalChannels = 0;
    const linkDomains = new Map<string, number>();
    for (const msg of messages) {
        const links = msg.content.match(URL_REGEX) ?? [];
        totalLinks += links.length;
        for (const link of links) {
            try {
                const domain = new URL(link).hostname.replace("www.", "");
                linkDomains.set(domain, (linkDomains.get(domain) ?? 0) + 1);
            } catch { }
        }
        totalMentions += (msg.content.match(MENTION_REGEX) ?? []).length;
        totalChannels += (msg.content.match(CHANNEL_REGEX) ?? []).length;
    }

    const topDomains = topN(linkDomains, 5).map(([d, c]) => `${d} (${c})`).join(", ");

    sections.push({
        title: "Links & Mentions",
        content: [
            `Total links shared: ${totalLinks}`,
            `Top domains: ${topDomains || "None"}`,
            `Mentions sent: ${totalMentions}`,
            `Channel references: ${totalChannels}`,
            `Avg links per message: ${(totalLinks / totalMessages).toFixed(2)}`,
        ].join("\n"),
    });

    const attachTypes = new Map<string, number>();
    let totalAttachSize = 0;
    for (const msg of messages) {
        for (const att of msg.attachments) {
            const ext = att.filename.split(".").pop()?.toLowerCase() ?? "unknown";
            attachTypes.set(ext, (attachTypes.get(ext) ?? 0) + 1);
            totalAttachSize += att.size;
        }
    }

    const attachBreakdown = topN(attachTypes, 5).map(([t, c]) => `${t} (${c})`).join(", ");

    sections.push({
        title: "Attachments",
        content: [
            `Total attachments: ${totalAttachments}`,
            `Total size: ${(totalAttachSize / 1024 / 1024).toFixed(2)} MB`,
            `Types: ${attachBreakdown || "None"}`,
            `Avg attachment size: ${totalAttachments > 0 ? (totalAttachSize / totalAttachments / 1024).toFixed(1) : 0} KB`,
        ].join("\n"),
    });

    const messagesWithSpoilers = messages.filter(m => SPOILER_REGEX.test(m.content)).length;
    const messagesWithCode = messages.filter(m => m.content.includes("```")).length;
    const messagesWithStickers = messages.filter(m => (m.stickerItems?.length ?? 0) > 0).length;
    const replyCount = messages.filter(m => m.message_reference).length;
    const ttsMessages = messages.filter(m => m.tts).length;
    const pinnedMessages = messages.filter(m => m.pinned).length;

    sections.push({
        title: "Message Patterns",
        content: [
            `Replies: ${replyCount} (${(replyCount / totalMessages * 100).toFixed(1)}%)`,
            `Messages with spoilers: ${messagesWithSpoilers}`,
            `Messages with code blocks: ${messagesWithCode}`,
            `Messages with stickers: ${messagesWithStickers}`,
            `TTS messages: ${ttsMessages}`,
            `Pinned messages: ${pinnedMessages}`,
        ].join("\n"),
    });

    const timestamps = messages.map(m => new Date(m.timestamp).getTime()).sort((a, b) => a - b);
    const firstMsg = new Date(timestamps[0]).toLocaleDateString();
    const lastMsg = new Date(timestamps[timestamps.length - 1]).toLocaleDateString();
    const spanDays = Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 86400000);
    const uniqueDays = new Set(messages.map(m => new Date(m.timestamp).toDateString())).size;

    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
        gaps.push(timestamps[i] - timestamps[i - 1]);
    }
    const avgGap = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
    const avgGapMinutes = Math.round(avgGap / 60000);

    const longestStreak = (() => {
        let best = 0, cur = 1;
        const sortedDays = [...new Set(messages.map(m => new Date(m.timestamp).toDateString()))].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        for (let i = 1; i < sortedDays.length; i++) {
            const diff = (new Date(sortedDays[i]).getTime() - new Date(sortedDays[i - 1]).getTime()) / 86400000;
            if (diff <= 1) { cur++; } else { best = Math.max(best, cur); cur = 1; }
        }
        return Math.max(best, cur);
    })();

    sections.push({
        title: "Account & Activity Insights",
        content: [
            `Observation period: ${firstMsg} to ${lastMsg} (${spanDays} days)`,
            `Active on ${uniqueDays} unique days`,
            `Avg daily messages: ${(totalMessages / Math.max(uniqueDays, 1)).toFixed(1)}`,
            `Avg time between messages: ${avgGapMinutes > 60 ? `${Math.round(avgGapMinutes / 60)}h ${avgGapMinutes % 60}m` : `${avgGapMinutes}m`}`,
            `Longest active streak: ${longestStreak} day${longestStreak !== 1 ? "s" : ""}`,
            `Account age (observed): ${estimateAccountAge(messages)}`,
        ].join("\n"),
    });

    const extraSections: Array<ResultSection | null> = [
        buildAccountSection(messages),
        buildPersonalitySection(messages),
        buildSocialSection(messages),
        buildChannelSection(messages),
        buildHabitsSection(messages, totalMessages),
        buildCommandSection(messages),
        buildLanguageSection(messages),
        buildPlatformSection(messages),
        buildFormattingSection(messages)
    ];
    for (const section of extraSections) {
        if (section) sections.push(section);
    }

    // Danger assessment goes last so it reads as the verdict
    const danger = analyzeDanger(messages);
    sections.push({
        title: `Danger Assessment — ${danger.score}/100 (${danger.level})`,
        content: danger.factors.length > 0
            ? ["Risk factors:", ...danger.factors.map(f => `  - ${f}`)].join("\n")
            : "No significant risk indicators found in scanned messages."
    });

    if (danger.flaggedLinks.length > 0) {
        sections.push({
            title: "Suspicious Links",
            content: danger.flaggedLinks.slice(0, 15).map(l =>
                `[${l.risk.toUpperCase()}] ${l.domain} — ${l.reason}\n      ${l.url}`
            ).join("\n") + (danger.flaggedLinks.length > 15 ? `\n... and ${danger.flaggedLinks.length - 15} more` : "")
        });
    }

    const personalityScores = analyzePersonality(messages).filter(s => s.score >= 8);
    const topPersonality = personalityScores[0]
        ? `${personalityScores[0].name} (${personalityScores[0].score}%)`
        : null;

    const behaviors: string[] = [];
    if (totalLinks / totalMessages > 0.5) behaviors.push("Frequent link sharer");
    if (totalEmojis / totalMessages > 3) behaviors.push("Heavy emoji user");
    if (avgLength > 200) behaviors.push("Long-form communicator");
    if (avgLength < 20) behaviors.push("Brief/succinct communicator");
    if (totalAttachments / totalMessages > 0.3) behaviors.push("Frequent file sender");
    if (totalMentions / totalMessages > 1) behaviors.push("Frequent @mention user");
    if (nightMsgs > dayMsgs) behaviors.push("Nocturnal activity pattern");
    if (messagesWithCode > totalMessages * 0.1) behaviors.push("Shares code frequently");
    if (replyCount / totalMessages > 0.5) behaviors.push("Frequently replies to others");
    if (pinnedMessages > 0) behaviors.push("Has pinned messages (selective curator)");
    if (ttsMessages > 0) behaviors.push("Uses text-to-speech");
    if (uniqueDays > 30) behaviors.push("Long-term active user");
    else if (uniqueDays < 3) behaviors.push("Sporadic/short burst user");
    if (totalReactions > totalMessages * 2) behaviors.push("Heavy reaction user");
    if (customEmojiCount > totalMessages * 0.5) behaviors.push("Uses many custom Discord emojis");

    sections.push({
        title: "Behavioral Profile",
        content: [
            behaviors.length > 0 ? "Detected behaviors:" : "No strong behavioral patterns detected.",
            ...behaviors.map(b => `  - ${b}`),
        ].join("\n"),
    });

    const summary = [
        `OSINT analysis of **${author.globalName || author.username}** (${author.username})`,
        `Analyzed ${totalMessages} messages over ${spanDays} days.`,
        `Estimated timezone: ${tz.label}.`,
        `Primarily active ${peakHours || "N/A"} on ${peakDays || "N/A"}.`,
        `Sleep schedule: ~${sleep.start}-${sleep.end} UTC.`,
        behaviors.length > 0 ? `Key traits: ${behaviors.slice(0, 3).join(", ")}.` : "",
        topPersonality ? `Comes across as: ${topPersonality}.` : "",
        `Danger score: ${danger.score}/100 (${danger.level}).`,
    ].filter(Boolean).join(" ");

    return { summary, sections };
}
