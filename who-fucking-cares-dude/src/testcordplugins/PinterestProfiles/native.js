/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const BASE_URL = "https://www.pinterest.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36";
const MEDIA_HOSTS = new Set(["i.pinimg.com", "s.pinimg.com"]);
function getSetCookie(response) {
    const headers = response.headers;
    const values = headers.getSetCookie?.() ?? [];
    if (values.length)
        return values;
    const merged = response.headers.get("set-cookie");
    if (!merged)
        return [];
    return merged.split(/,(?=[^;,]+=)/g);
}
function buildSearchUrl(query, pageSize, bookmarks = []) {
    const endpoint = new URL("/resource/BaseSearchResource/get/", BASE_URL);
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
    const data = {
        options: {
            appliedProductFilters: "---",
            auto_correction_disabled: false,
            bookmarks,
            page_size: pageSize,
            query,
            redux_normalize_feed: true,
            rs: "typed",
            scope: "pins",
            source_url: sourceUrl
        },
        context: {}
    };
    endpoint.searchParams.set("source_url", sourceUrl);
    endpoint.searchParams.set("data", JSON.stringify(data));
    endpoint.searchParams.set("_", `${Date.now()}`);
    return endpoint.toString();
}
function normalizeGuide(entry) {
    const label = entry.display?.display_text?.trim();
    const query = entry.action?.search_query?.trim();
    if (!label || !query)
        return null;
    return { label, query };
}
function normalizePin(entry) {
    if (entry.type !== "pin" || entry.videos || entry.video_list)
        return null;
    const image = entry.images?.orig ?? entry.images?.["736x"] ?? entry.images?.["474x"] ?? entry.images?.["236x"];
    if (!image?.url || !image.width || !image.height || !entry.id)
        return null;
    return {
        id: entry.id,
        title: entry.title?.trim() || entry.grid_title?.trim() || "",
        description: entry.description?.trim() || "",
        url: image.url,
        width: image.width,
        height: image.height,
        dominantColor: entry.dominant_color ?? null,
        pinterestUrl: entry.link ?? null,
        isGif: image.url.endsWith(".gif")
    };
}
function isSearchPayload(value) {
    return typeof value === "object" && value !== null;
}
function getSearchQuery(query, mediaFilter, target) {
    let finalQuery = query.trim();
    if (target === "AVATAR" && !/\b(avatar|icon|pfp)\b/i.test(finalQuery)) {
        finalQuery = `${finalQuery} avatar icon`;
    }
    else if (target === "BANNER" && !/\bbanner\b/i.test(finalQuery)) {
        finalQuery = `${finalQuery} banner`;
    }
    if (mediaFilter === "GIFS" && !/\bgif\b/i.test(finalQuery)) {
        finalQuery = `${finalQuery} gif`;
    }
    return finalQuery;
}
function getTargetRank(pin, target) {
    if (target === "IMAGE")
        return 0;
    const ratio = pin.width / pin.height;
    if (target === "BANNER") {
        if (ratio >= 1.6)
            return 0;
        if (ratio >= 1.3)
            return 1;
        if (ratio >= 1)
            return 2;
        return 3;
    }
    if (target === "AVATAR") {
        if (ratio >= 0.8 && ratio <= 1.2)
            return 0;
        if (ratio >= 0.65 && ratio <= 1.35)
            return 1;
        if (ratio > 1.35)
            return 2;
        return 3;
    }
    return 0;
}
export async function search(_, rawQuery, rawLimit = 30, mediaFilter = "ALL", bookmarks = [], target = "IMAGE") {
    const query = getSearchQuery(rawQuery.trim(), mediaFilter, target);
    const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 30));
    if (!query)
        throw new Error("Search query is required.");
    const homeResponse = await fetch(BASE_URL, {
        headers: {
            "User-Agent": USER_AGENT
        }
    });
    if (!homeResponse.ok)
        throw new Error("Could not initialize Pinterest search.");
    const cookieHeader = getSetCookie(homeResponse)
        .map(cookie => cookie.split(";", 1)[0])
        .join("; ");
    if (!cookieHeader)
        throw new Error("Could not initialize Pinterest cookies.");
    const response = await fetch(buildSearchUrl(query, limit, bookmarks), {
        headers: {
            "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
            "x-pinterest-pws-handler": "www/pin/[id].js",
            Cookie: cookieHeader
        }
    });
    if (!response.ok)
        throw new Error(`Pinterest search failed with HTTP ${response.status}.`);
    const json = await response.json();
    if (!isSearchPayload(json))
        throw new Error("Pinterest returned an invalid response.");
    const results = json.resource_response?.data?.results ?? [];
    const guides = (json.resource_response?.data?.guides ?? [])
        .map(normalizeGuide)
        .filter((guide) => guide !== null)
        .slice(0, 8);
    return {
        query,
        guides,
        results: results
            .map(normalizePin)
            .filter((pin) => pin !== null)
            .filter(pin => mediaFilter !== "STATIC" || !pin.isGif)
            .filter(pin => mediaFilter !== "GIFS" || pin.isGif)
            .sort((a, b) => getTargetRank(a, target) - getTargetRank(b, target))
            .slice(0, limit),
        bookmark: json.resource_response?.bookmark?.length ? json.resource_response.bookmark : null
    };
}
export async function fetchMedia(_, rawUrl) {
    const url = URL.parse(rawUrl);
    if (!url || !MEDIA_HOSTS.has(url.hostname))
        throw new Error("Invalid Pinterest media URL.");
    const response = await fetch(url, {
        headers: {
            Accept: "*/*",
            "User-Agent": USER_AGENT
        }
    });
    if (!response.ok)
        throw new Error(`Failed to fetch Pinterest media with HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const pathname = url.pathname.split("/").pop() || "pinterest-image";
    const filename = pathname.includes(".") ? pathname : `${pathname}.${contentType.includes("gif") ? "gif" : "jpg"}`;
    const data = await response.arrayBuffer();
    const dataUrl = `data:${contentType};base64,${Buffer.from(data).toString("base64")}`;
    return {
        data,
        dataUrl,
        type: contentType,
        filename
    };
}
