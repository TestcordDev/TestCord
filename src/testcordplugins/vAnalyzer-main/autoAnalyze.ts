/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { ChannelStore, RelationshipStore } from "@webpack/common";

import { handleAnalysis } from "./AnalysisAccesory";
import { analyzeBotProfile } from "./analyzers/BotProfile";
import { analyzeWithCertPL } from "./analyzers/CertPL";
import { analyzeDiscordInvite, isDiscordInvite } from "./analyzers/DiscordInvite";
import { analyzeWithFishFish } from "./analyzers/FishFish";
import { analyzeFileWithHybridAnalysis, analyzeUrlWithHybridAnalysis } from "./analyzers/HybridAnalysis";
import { runModularScan } from "./analyzers/ModularScan";
import { analyzeWithSucuriDetailed } from "./analyzers/Sucuri";
import { analyzeWithVirusTotal } from "./analyzers/VirusTotal";
import { analyzeWithWhereGoes } from "./analyzers/WhereGoes";
import { getModulesSync, ModularScanModule } from "./modularScanStore";
import { settings } from "./settings";
import { getBlocklistReason, isBlocklisted, isWhitelisted } from "./urlFilter";
import { type AnalysisValue, analyzerLimiter, extractCdnFileUrls, pruneMap } from "./utils";

const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b[a-z0-9][a-z0-9-]*\.[a-z]{2,}(?:\/[^\s<>"')\]]*)?\b/gi;
const MARKDOWN_LINK_REGEX = /\[[^\]]+\]\((?:<)?([^\s)<>]+)(?:>)?\)/gi;
const EPHEMERAL_MESSAGE_FLAG = 1 << 6;
const ANALYZED_MESSAGE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ANALYZED_MESSAGES = 1000;
const MAX_URLS_PER_MESSAGE = 25;
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const AUTO_ANALYZED_MESSAGE_IDS = new Map<string, number>();
const NON_SCANNABLE_ATTACHMENT_EXTENSIONS = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff",
    "mp4", "webm", "mov", "m4v", "avi", "mkv", "wmv",
    "mp3", "wav", "ogg", "flac", "aac", "m4a"
]);

let lastPrune = 0;
function pruneAnalyzedMessages(now: number) {
    if (now - lastPrune < 30_000) return;
    lastPrune = now;
    pruneMap(AUTO_ANALYZED_MESSAGE_IDS, expiresAt => expiresAt <= now, MAX_ANALYZED_MESSAGES);
}

export function extractUrls(content: string): string[] {
    const matches = content.match(URL_REGEX) ?? [];

    const splitUrls: string[] = [];
    for (const match of matches) {
        const parts = match.split(/&(?=https?:\/\/|www\.)/);
        splitUrls.push(...parts);
    }

    return [...new Set(splitUrls)]
        .map(url => normalizeUrl(url.trim()))
        .filter(u => u.length > 0);
}

export function clearAutoAnalyzeState() {
    AUTO_ANALYZED_MESSAGE_IDS.clear();
    analyzerLimiter.clear();
}

function runScan(messageId: string, url: string, task: () => Promise<AnalysisValue | null | undefined>, label: string) {
    analyzerLimiter.run(task)
        .then(r => r && handleAnalysis(messageId, r, url))
        .catch(error => console.error(`[vAnalyzer] ${label}:`, error));
}

function normalizeUrl(url: string): string {
    if (url.toLowerCase().startsWith("http")) return url;
    if (url.toLowerCase().startsWith("www.")) return `https://${url}`;
    return `https://${url}`;
}

function addUrlsFromText(urls: Set<string>, text: unknown) {
    if (typeof text !== "string" || !text) return;

    for (const url of extractUrls(text)) {
        urls.add(url);
    }

    let markdownMatch: RegExpExecArray | null;
    MARKDOWN_LINK_REGEX.lastIndex = 0;
    while ((markdownMatch = MARKDOWN_LINK_REGEX.exec(text)) !== null) {
        const candidate = markdownMatch[1];
        if (candidate) {
            urls.add(normalizeUrl(candidate));
        }
    }
}

function addUrl(urls: Set<string>, value: unknown) {
    if (typeof value !== "string" || !value) return;
    urls.add(normalizeUrl(value));
}

function collectEmbedUrls(embed: any, urls: Set<string>) {
    if (!embed || typeof embed !== "object") return;

    addUrl(urls, embed.url);
    addUrl(urls, embed.author?.url);
    addUrl(urls, embed.provider?.url);
    addUrl(urls, embed.video?.url);

    addUrlsFromText(urls, embed.rawTitle);
    addUrlsFromText(urls, embed.rawDescription);
    addUrlsFromText(urls, embed.title);
    addUrlsFromText(urls, embed.description);

    if (Array.isArray(embed.fields)) {
        for (const field of embed.fields) {
            addUrlsFromText(urls, field?.name);
            addUrlsFromText(urls, field?.value);
        }
    }
}

function collectComponentUrls(component: any, urls: Set<string>) {
    if (!component || typeof component !== "object") return;

    addUrl(urls, component.url);
    addUrlsFromText(urls, component.label);
    addUrlsFromText(urls, component.text);
    addUrlsFromText(urls, component.content);
    addUrlsFromText(urls, component.value);

    for (const nested of Object.values(component)) {
        if (Array.isArray(nested)) {
            for (const item of nested) {
                collectComponentUrls(item, urls);
            }
        } else if (nested && typeof nested === "object") {
            collectComponentUrls(nested, urls);
        }
    }
}

function walkMessageValue(value: unknown, urls: Set<string>, seen: WeakSet<object>) {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            walkMessageValue(item, urls, seen);
        }
        return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
        // skip CDN URLs
        if (/^(image|thumbnail|cdn|media)/.test(key)) continue;

        if (typeof nestedValue === "string" && /url|href|link/i.test(key)) {
            urls.add(normalizeUrl(nestedValue));
            continue;
        }

        if ((key === "rawDescription" || key === "rawTitle" || key === "description" || key === "title" || key === "value" || key === "name" || key === "text" || key === "content") && typeof nestedValue === "string") {
            addUrlsFromText(urls, nestedValue);
            continue;
        }

        walkMessageValue(nestedValue, urls, seen);
    }
}

const urlExtractCache = new Map<string, string[]>();
const MAX_URL_CACHE = 2000;

export function extractUrlsFromMessage(message: Message): string[] {
    const cached = urlExtractCache.get(message.id);
    if (cached) return cached;

    const urls = new Set<string>(extractUrls(message.content ?? ""));

    if (settings.store.checkEmbeds) {
        for (const embed of message.embeds ?? []) {
            collectEmbedUrls(embed, urls);
            walkMessageValue(embed, urls, new WeakSet<object>());
        }
    }

    for (const component of message.components ?? []) {
        collectComponentUrls(component, urls);
        walkMessageValue(component, urls, new WeakSet<object>());
    }

    const result = [...urls].slice(0, MAX_URLS_PER_MESSAGE);
    urlExtractCache.set(message.id, result);
    if (urlExtractCache.size > MAX_URL_CACHE) {
        const first = urlExtractCache.keys().next().value;
        if (first) urlExtractCache.delete(first);
    }
    return result;
}

export function clearUrlExtractCache() {
    urlExtractCache.clear();
}

export function extractUrlsFromEmbeds(message: Message): string[] {
    if (!settings.store.checkEmbeds) return [];

    const urls = new Set<string>();

    for (const embed of message.embeds ?? []) {
        collectEmbedUrls(embed, urls);
        walkMessageValue(embed, urls, new WeakSet<object>());
    }

    return [...urls].slice(0, MAX_URLS_PER_MESSAGE);
}

function analyzeUrlsAndInvites(
    message: Message,
    urls: string[],
    options: {
        respectDirectMessageOnly: boolean;
        requireAutoScanToggle: boolean;
    }
) {
    const s = settings.store;
    const inviteUrls = urls.filter(isDiscordInvite);
    const normalUrls = urls.filter(u => !isDiscordInvite(u) && !isWhitelisted(u));

    const shouldScanInvites = options.requireAutoScanToggle ? s.autoScanInvites : true;
    if (shouldScanInvites && inviteUrls.length > 0) {
        const skipInvites = options.respectDirectMessageOnly && s.autoScanInvitesDirectMessageOnly && !isDM(message.channel_id);
        if (!skipInvites) {
            for (const url of inviteUrls) {
                analyzeDiscordInvite(url, true).then(r => r && handleAnalysis(message.id, r));
            }
        }
    }

    const shouldScanUrls = options.requireAutoScanToggle ? s.autoScanUrls : true;
    if (shouldScanUrls && normalUrls.length > 0) {
        const skipUrls = options.respectDirectMessageOnly && s.autoScanUrlsDirectMessageOnly && !isDM(message.channel_id);
        if (!skipUrls) {
            for (const url of normalUrls) {
                void (async () => {
                    try {
                        // if domain cannot be resolved, skip all checks and dont show any analysis
                        if (s.autoScanUrlsSucuri) {
                            const sucuriResult = await analyzeWithSucuriDetailed(url, true, true);
                            if (sucuriResult.domainResolved === false) return;
                            if (sucuriResult.analysis) {
                                handleAnalysis(message.id, sucuriResult.analysis, url);
                            }
                        }

                        const blockReason = getBlocklistReason(url);
                        if (isBlocklisted(url) && blockReason) {
                            handleAnalysis(message.id, {
                                details: [{ message: `[Blocklist] ${url} is on ${blockReason}`, type: "malicious" }],
                                timestamp: Date.now()
                            }, url);
                        }

                        if (url.startsWith("http://")) {
                            handleAnalysis(message.id, {
                                details: [{ message: `[Security] Insecure protocol (HTTP): ${url}`, type: "suspicious" }],
                                timestamp: Date.now()
                            }, url);
                        }

                        if (s.autoScanUrlsCertPL) runScan(message.id, url, () => analyzeWithCertPL(url, true), "URL scan error");
                        if (s.autoScanUrlsFishFish) runScan(message.id, url, () => analyzeWithFishFish(url, true), "URL scan error");
                        if (s.autoScanUrlsWhereGoes) runScan(message.id, url, () => analyzeWithWhereGoes(url, true), "URL scan error");
                        if (s.autoScanUrlsHybridAnalysis) runScan(message.id, url, () => analyzeUrlWithHybridAnalysis(url, true), "URL scan error");
                    } catch (error) {
                        console.error("[vAnalyzer] Auto URL scan failed:", error);
                    }
                })();
            }
        }
    }

    return normalUrls;
}

export function manualAnalyzeMessageUrls(message: Message) {
    if (!message?.id) return;

    const urls = extractUrlsFromMessage(message);
    if (urls.length === 0) return;

    manualAnalyzeUrls(message, urls);
}

export function manualAnalyzeUrls(message: Message, urls: string[]) {
    if (!message?.id || urls.length === 0) return;

    const normalUrls = analyzeUrlsAndInvites(message, urls, {
        respectDirectMessageOnly: false,
        requireAutoScanToggle: false
    });

    runAutoModularScans(message.id, normalUrls, []);
}

function isEphemeralMessage(message: Message): boolean {
    try {
        if (typeof message.hasFlag === "function" && message.hasFlag(EPHEMERAL_MESSAGE_FLAG as any)) {
            return true;
        }
    } catch {
        // ignore
    }

    const rawFlags = (message as any).flags;
    if (typeof rawFlags === "number") {
        return (rawFlags & EPHEMERAL_MESSAGE_FLAG) !== 0;
    }

    return false;
}

function isDM(channelId: string): boolean {
    const channel = ChannelStore.getChannel(channelId);
    return !channel?.guild_id;
}

function isScannableFileName(name: string): boolean {
    const lower = name.toLowerCase();
    const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
    return !NON_SCANNABLE_ATTACHMENT_EXTENSIONS.has(ext);
}

function isScannableAttachment(attachment: Message["attachments"][number]): boolean {
    if (!settings.store.ignoreMediaFiles) return true;

    const contentType = attachment.content_type?.toLowerCase() ?? "";
    if (contentType.startsWith("image/") || contentType.startsWith("video/") || contentType.startsWith("audio/")) {
        return false;
    }

    return isScannableFileName(attachment.filename ?? "");
}

function matchesFilter(module: ModularScanModule, target: string): boolean {
    const { filter } = module;
    if (!filter || filter.type === "none") return true;

    if (filter.type === "contains") {
        return target.toLowerCase().includes(filter.pattern.toLowerCase());
    }

    if (filter.type === "regex") {
        try {
            const regex = new RegExp(filter.pattern, "i");
            return regex.test(target);
        } catch {
            return false;
        }
    }

    return true;
}

function runAutoModularScans(messageId: string, urls: string[], attachments: Message["attachments"]) {
    const modules = getModulesSync();

    for (const module of modules) {
        if (!module.autoScan) continue;

        if (module.type === "url" && urls.length > 0) {
            for (const url of urls) {
                if (!matchesFilter(module, url)) continue;
                runScan(messageId, url, () => runModularScan(module, url, "", true), "Modular scan error");
            }
        }

        if (module.type === "file" && attachments?.length) {
            for (const attachment of attachments) {
                if (!matchesFilter(module, attachment.filename)) continue;
                runScan(messageId, attachment.url, () => runModularScan(module, attachment.url, attachment.filename, true), "Modular scan error");
            }
        }
    }
}

export function autoAnalyzeMessage(message: Message) {
    if (!message?.id) return;
    const now = Date.now();
    pruneAnalyzedMessages(now);

    const expiresAt = AUTO_ANALYZED_MESSAGE_IDS.get(message.id);
    if (expiresAt && expiresAt > now) return;
    AUTO_ANALYZED_MESSAGE_IDS.set(message.id, now + ANALYZED_MESSAGE_TTL_MS);

    const s = settings.store;
    const ephemeralMessage = isEphemeralMessage(message);

    if (s.messageAgeFilter && s.messageAgeFilter > 0) {
        const messageAge = now - (message.timestamp?.valueOf?.() ?? 0);
        const maxAge = s.messageAgeFilter * 24 * 60 * 60 * 1000;
        if (messageAge > maxAge) return;
    }

    if (s.skipFriends && RelationshipStore.isFriend(message.author.id)) return;

    if (!ephemeralMessage && s.analyzeBotsProfile && message.author.bot) {
        const botAnalysis = analyzeBotProfile(message.author);
        if (botAnalysis) {
            handleAnalysis(message.id, botAnalysis);
        }
    }

    const urls = ephemeralMessage ? extractUrlsFromEmbeds(message) : extractUrlsFromMessage(message);
    const canScanFiles = !ephemeralMessage;
    const scannableAttachments = (message.attachments ?? []).filter(isScannableAttachment).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    if (urls.length === 0 && (!canScanFiles || scannableAttachments.length === 0)) return;

    const normalUrls = analyzeUrlsAndInvites(message, urls, {
        respectDirectMessageOnly: true,
        requireAutoScanToggle: true
    });

    // autoanalyze files
    if (canScanFiles && s.autoScanFiles && scannableAttachments.length) {
        const skipFiles = s.autoScanFilesDirectMessageOnly && !isDM(message.channel_id);
        if (!skipFiles) {

            // virustotal
            if (s.autoScanFilesVirusTotal) {
                for (const attachment of scannableAttachments) {
                    runScan(message.id, attachment.url, () => analyzeWithVirusTotal(message.id, attachment.url, true), "Auto file scan error");
                }
            }

            // hybrid analysis
            if (s.autoScanFilesHybridAnalysis) {
                for (const attachment of scannableAttachments) {
                    runScan(message.id, attachment.url, () => analyzeFileWithHybridAnalysis(attachment.url, attachment.filename, true), "Auto file scan error");
                }
            }
        }
    }

    // auto-scan CDN file URLs
    if (s.autoScanFiles) {
        const skipFiles = s.autoScanFilesDirectMessageOnly && !isDM(message.channel_id);
        if (!skipFiles) {
            const cdnFiles = extractCdnFileUrls(urls)
                .filter(f => !settings.store.ignoreMediaFiles || isScannableFileName(f.fileName));

            if (cdnFiles.length > 0) {
                if (s.autoScanFilesVirusTotal) {
                    for (const file of cdnFiles) {
                        runScan(message.id, file.url, () => analyzeWithVirusTotal(message.id, file.url, true), "CDN file scan error");
                    }
                }
                if (s.autoScanFilesHybridAnalysis) {
                    for (const file of cdnFiles) {
                        runScan(message.id, file.url, () => analyzeFileWithHybridAnalysis(file.url, file.fileName, true), "CDN file scan error");
                    }
                }
            }
        }
    }

    // autorun modular scans that have autoScan enabled
    runAutoModularScans(message.id, normalUrls, canScanFiles ? scannableAttachments : []);
}
