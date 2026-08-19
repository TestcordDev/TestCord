/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { sleep } from "@utils/misc";
import { Constants, RestAPI, UserStore } from "@webpack/common";
const LINK_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
const CACHE_PREFIX = "deepsearch-cache-";
const CACHE_MAX_AGE = 1000 * 60 * 10;
const QUERY_KEY = "deepsearch-last-query";
function buildApiQuery(filters, content, offset) {
    const query = {
        offset,
        sort_by: "timestamp",
        sort_order: "desc"
    };
    const term = content.trim() || filters.linkContains?.trim() || filters.linkDomain?.trim() || "";
    if (term)
        query.content = term;
    if (filters.authorId)
        query.author_id = filters.authorId;
    if (filters.channelId)
        query.channel_id = filters.channelId;
    if (filters.mentions)
        query.mentions = filters.mentions;
    if (filters.includeNSFW)
        query.include_nsfw = true;
    if (filters.isPinned)
        query.pinned = true;
    const hasFilters = [];
    if (filters.hasAttachments)
        hasFilters.push("file");
    if (filters.hasEmbeds)
        hasFilters.push("embed");
    if (filters.linkDomain || filters.linkContains)
        hasFilters.push("link");
    if (hasFilters.length > 0) {
        query.has = hasFilters;
    }
    return query;
}
function extractUrls(text) {
    return (text.match(LINK_REGEX) || []).map(url => url.replace(/[.,;:!?)\]]+$/, ""));
}
function parseList(value) {
    return value?.split(",").map(item => item.trim().toLowerCase()).filter(Boolean) ?? [];
}
function messagePassesLinkFilters(message, filters) {
    const urls = extractUrls(message.content || "");
    if (urls.length === 0) {
        if (filters.linkDomain || filters.linkContains)
            return false;
        return true;
    }
    if (filters.linkDomain) {
        const domain = filters.linkDomain.toLowerCase();
        const hasMatch = urls.some(url => {
            try {
                return new URL(url).hostname.toLowerCase().includes(domain);
            }
            catch {
                return url.toLowerCase().includes(domain);
            }
        });
        if (!hasMatch)
            return false;
    }
    if (filters.linkContains) {
        const term = filters.linkContains.toLowerCase();
        if (!urls.some(url => url.toLowerCase().includes(term)))
            return false;
    }
    return true;
}
function messagePassesClientFilters(message, filters) {
    if (filters.hasAttachments && (!message.attachments || message.attachments.length === 0))
        return false;
    if (filters.hasEmbeds && (!message.embeds || message.embeds.length === 0))
        return false;
    if (filters.isPinned && !message.pinned)
        return false;
    if (!messagePassesLinkFilters(message, filters))
        return false;
    const content = (message.content || "").toLowerCase();
    if (parseList(filters.excludeKeywords).some(keyword => content.includes(keyword)))
        return false;
    const excludedDomains = parseList(filters.excludeDomains);
    if (excludedDomains.length > 0) {
        const urls = extractUrls(message.content || "");
        const hasExcludedDomain = urls.some(url => {
            try {
                const hostname = new URL(url).hostname.toLowerCase();
                return excludedDomains.some(domain => hostname.includes(domain));
            }
            catch {
                const normalizedUrl = url.toLowerCase();
                return excludedDomains.some(domain => normalizedUrl.includes(domain));
            }
        });
        if (hasExcludedDomain)
            return false;
    }
    if (filters.dateFrom || filters.dateTo) {
        const msgTime = new Date(message.timestamp).getTime();
        if (isNaN(msgTime))
            return false;
        if (filters.dateFrom) {
            const from = new Date(filters.dateFrom).getTime();
            if (!isNaN(from) && msgTime < from)
                return false;
        }
        if (filters.dateTo) {
            const to = new Date(filters.dateTo).getTime();
            if (!isNaN(to) && msgTime > to)
                return false;
        }
    }
    return true;
}
function getCacheKey(targetId, content, filters) {
    const filterStr = JSON.stringify({
        a: filters.authorId,
        c: filters.channelId,
        m: filters.mentions,
        aa: filters.hasAttachments,
        ae: filters.hasEmbeds,
        ap: filters.isPinned,
        an: filters.includeNSFW,
        ld: filters.linkDomain,
        lc: filters.linkContains,
        xk: filters.excludeKeywords,
        xd: filters.excludeDomains,
        df: filters.dateFrom,
        dt: filters.dateTo
    });
    return CACHE_PREFIX + targetId + "-" + content.toLowerCase().trim() + "-" + filterStr;
}
async function getCachedResults(key) {
    try {
        const cached = await DataStore.get(key);
        if (!cached)
            return null;
        if (Date.now() - cached.timestamp > CACHE_MAX_AGE) {
            await DataStore.del(key);
            return null;
        }
        return cached.results;
    }
    catch {
        return null;
    }
}
async function setCachedResults(key, results) {
    try {
        await DataStore.set(key, { results, timestamp: Date.now() });
    }
    catch {
        // ignore cache write errors
    }
}
export async function saveLastQuery(query, filters) {
    try {
        await DataStore.set(QUERY_KEY, { query, filters });
    }
    catch {
        // ignore
    }
}
export async function loadLastQuery() {
    try {
        return await DataStore.get(QUERY_KEY);
    }
    catch {
        return null;
    }
}
export async function deepSearch(target, content, filters, limit = 100, onProgress, signal) {
    if (signal?.aborted)
        return [];
    const targetId = target.guildId || target.channelId || "global";
    const cacheKey = getCacheKey(targetId, content, filters);
    const cached = await getCachedResults(cacheKey);
    if (signal?.aborted)
        return [];
    if (cached)
        return cached;
    const endpoint = target.guildId
        ? Constants.Endpoints.SEARCH_GUILD(target.guildId)
        : target.channelId
            ? Constants.Endpoints.SEARCH_CHANNEL(target.channelId)
            : null;
    if (!endpoint)
        return [];
    const results = [];
    const seen = new Set();
    let offset = 0;
    const pageSize = 25;
    const hasClientSideFilters = filters.hasAttachments || filters.hasEmbeds || filters.isPinned || filters.linkDomain || filters.linkContains || filters.excludeKeywords || filters.excludeDomains || filters.dateFrom || filters.dateTo;
    while (results.length < limit && offset < 5000) {
        if (signal?.aborted)
            break;
        const query = buildApiQuery(filters, content, offset);
        try {
            const response = await RestAPI.get({
                url: endpoint,
                query,
                retries: 2
            });
            const { body } = response;
            if (signal?.aborted)
                break;
            if (!body?.messages || body.messages.length === 0)
                break;
            const resultCountBeforePage = results.length;
            for (const group of body.messages) {
                for (const msg of group) {
                    const msgId = msg.id;
                    if (!msgId || seen.has(msgId))
                        continue;
                    // If message group contains context messages, check hit flag if available
                    if ("hit" in msg && !msg.hit)
                        continue;
                    seen.add(msgId);
                    if (!messagePassesClientFilters(msg, filters))
                        continue;
                    const user = UserStore.getUser(msg.author?.id) ?? msg.author;
                    const channel = { id: msg.channel_id, guild_id: target.guildId ?? "@me" };
                    results.push({
                        message: msg,
                        channel,
                        user,
                        matchedUrls: extractUrls(msg.content || "")
                    });
                    if (results.length >= limit)
                        break;
                }
                if (results.length >= limit)
                    break;
            }
            if (results.length !== resultCountBeforePage)
                onProgress?.(results.slice());
            const totalResults = body.total_results ?? 0;
            if (offset + pageSize >= totalResults)
                break;
            if (body.messages.length < pageSize)
                break;
            offset += pageSize;
        }
        catch (e) {
            if (signal?.aborted)
                break;
            if (e?.status === 429) {
                await sleep(1000);
                continue;
            }
            break;
        }
    }
    if (hasClientSideFilters && results.length > 0) {
        // already filtered in the loop
    }
    if (!signal?.aborted)
        await setCachedResults(cacheKey, results);
    return results;
}
