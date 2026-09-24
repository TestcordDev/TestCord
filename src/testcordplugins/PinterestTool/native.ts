/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const BASE_URL = "https://www.pinterest.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36";
const MEDIA_HOSTS = new Set(["i.pinimg.com", "s.pinimg.com"]);

interface PinterestGuide {
    label: string;
    query: string;
}

interface PinterestImageResult {
    id: string;
    title: string;
    description: string;
    url: string;
    width: number;
    height: number;
    dominantColor: string | null;
    pinterestUrl: string | null;
    isGif: boolean;
}

interface PinterestSearchPayload {
    query: string;
    guides: PinterestGuide[];
    results: PinterestImageResult[];
    bookmark: string[] | null;
}

type MediaFilter = "ALL" | "GIFS" | "STATIC";
type SearchTarget = "IMAGE" | "AVATAR" | "BANNER";

interface PinterestSearchImage {
    width?: number;
    height?: number;
    url?: string;
}

interface PinterestSearchPin {
    id?: string;
    type?: string;
    title?: string;
    grid_title?: string;
    description?: string;
    dominant_color?: string;
    link?: string | null;
    images?: Record<string, PinterestSearchImage>;
    videos?: unknown;
    video_list?: unknown;
}

interface PinterestGuideEntry {
    type?: string;
    action?: {
        search_query?: string;
    };
    display?: {
        display_text?: string;
    };
}

interface PinterestSearchJson {
    resource_response?: {
        bookmark?: string[];
        data?: {
            results?: PinterestSearchPin[];
            guides?: PinterestGuideEntry[];
        };
    };
}

function getSetCookie(response: Response) {
    const headers = response.headers as Headers & {
        getSetCookie?: () => string[];
    };

    const values = headers.getSetCookie?.() ?? [];
    if (values.length) return values;

    const merged = response.headers.get("set-cookie");
    if (!merged) return [];

    return merged.split(/,(?=[^;,]+=)/g);
}

function buildSearchUrl(query: string, pageSize: number, bookmarks: string[] = []) {
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

function normalizeGuide(entry: PinterestGuideEntry): PinterestGuide | null {
    const label = entry.display?.display_text?.trim();
    const query = entry.action?.search_query?.trim();

    if (!label || !query) return null;
    return { label, query };
}

function isGifUrl(rawUrl: string) {
    try {
        return new URL(rawUrl).pathname.toLowerCase().endsWith(".gif");
    } catch {
        return /\.gif(?:$|\?)/i.test(rawUrl);
    }
}

function normalizePin(entry: PinterestSearchPin): PinterestImageResult | null {
    if (entry.type !== "pin") return null;

    const image = entry.images?.orig ?? entry.images?.["736x"] ?? entry.images?.["474x"] ?? entry.images?.["236x"];
    if (!image?.url || !image.width || !image.height || !entry.id) return null;

    return {
        id: entry.id,
        title: entry.title?.trim() || entry.grid_title?.trim() || "",
        description: entry.description?.trim() || "",
        url: image.url,
        width: image.width,
        height: image.height,
        dominantColor: entry.dominant_color ?? null,
        pinterestUrl: `${BASE_URL}/pin/${entry.id}/`,
        isGif: isGifUrl(image.url)
    };
}

function isSearchPayload(value: unknown): value is PinterestSearchJson {
    return typeof value === "object" && value !== null;
}

function getSearchQuery(query: string, mediaFilter: MediaFilter, target: SearchTarget) {
    let finalQuery = query.trim();

    if (target === "AVATAR" && !/\b(avatar|icon|pfp|profile picture)\b/i.test(finalQuery)) {
        finalQuery = `${finalQuery} pfp icon`;
    } else if (target === "BANNER" && !/\b(banner|header|wallpaper)\b/i.test(finalQuery)) {
        // Keep banner searches broad now that Discord's native Edit Image flow can
        // crop/zoom the selected media. A light "wallpaper" hint improves landscape
        // relevance without forcing exact Discord dimensions or panoramic-only pins.
        finalQuery = `${finalQuery} wallpaper`;
    }

    if (mediaFilter === "GIFS" && !/\b(gif|animated)\b/i.test(finalQuery)) {
        finalQuery = `${finalQuery} animated gif`;
    }

    return finalQuery;
}

function addSearchVariation(query: string, target: SearchTarget, mediaFilter: MediaFilter) {
    const imageVariants = mediaFilter === "GIFS"
        ? ["loop", "animation", "animated art", "motion", "edit", "reaction"]
        : ["aesthetic", "fanart", "art", "edit", "illustration", "photography"];

    const avatarVariants = mediaFilter === "GIFS"
        ? ["loop", "animated icon", "anime edit", "motion", "reaction", "scene", "edit"]
        : ["aesthetic", "fanart", "icon edit", "dark aesthetic", "portrait art", "minimal", "anime icon"];

    const bannerVariants = mediaFilter === "GIFS"
        ? ["loop", "animated wallpaper", "cinematic loop", "anime scene", "motion background", "scenery loop", "animated art"]
        : ["wallpaper", "aesthetic", "fanart", "dark aesthetic", "cinematic", "scenery", "anime art", "landscape art"];

    const variants = target === "BANNER"
        ? bannerVariants
        : target === "AVATAR"
            ? avatarVariants
            : imageVariants;

    return `${query} ${variants[Math.floor(Math.random() * variants.length)]}`;
}

function getTargetRank(pin: PinterestImageResult, target: SearchTarget) {
    if (target === "IMAGE") return 0;

    const ratio = pin.width / pin.height;

    if (target === "BANNER") {
        // Prefer genuinely wide panoramas for banners, not only near-5:2 crops.
        if (ratio < 1.65) return 100 + (1.65 - ratio) * 12;
        if (ratio > 4.6) return 10 + (ratio - 4.6);
        return Math.abs(ratio - 3.0);
    }

    if (target === "AVATAR") {
        if (ratio >= 0.8 && ratio <= 1.2) return 0;
        if (ratio >= 0.65 && ratio <= 1.35) return 1;
        if (ratio > 1.35) return 2;
        return 3;
    }
    return 0;
}

export async function search(
    _: unknown,
    rawQuery: string,
    rawLimit = 30,
    mediaFilter: MediaFilter = "ALL",
    bookmarks: string[] = [],
    target: SearchTarget = "IMAGE"
): Promise<PinterestSearchPayload> {
    const baseQuery = getSearchQuery(rawQuery.trim(), mediaFilter, target);
    // Fresh searches keep the original Pinterest Tool behaviour: add one small
    // random relevance/style variation so repeating the same subject can surface
    // a different useful set. Pagination never re-randomizes; it keeps the exact
    // query returned by the first request so Next/Previous stay on the same feed.
    const query = bookmarks.length ? baseQuery : addSearchVariation(baseQuery, target, mediaFilter);
    const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 30));

    if (!query) throw new Error("Search query is required.");

    const homeResponse = await fetch(BASE_URL, {
        headers: {
            "User-Agent": USER_AGENT
        }
    });

    if (!homeResponse.ok) throw new Error("Could not initialize Pinterest search.");

    const cookieHeader = getSetCookie(homeResponse)
        .map(cookie => cookie.split(";", 1)[0])
        .join("; ");

    if (!cookieHeader) throw new Error("Could not initialize Pinterest cookies.");

    // Pinterest frequently represents animated pins as video previews instead of
    // direct .gif media. For GIF mode, walk a few Pinterest result pages inside a
    // single UI request so one sparse backend page does not look like the search
    // randomly failed. Static image searches stay single-request and fast.
    const desiredResultCount = mediaFilter === "GIFS"
        // Return as soon as one visible plugin page is filled. v15.3 tried to
        // pre-fill several future pages (24 avatars / 16 banners), which made GIF
        // searches look frozen while Pinterest was still being scanned. Next loads
        // the following page on demand, so one page is the right latency/coverage balance.
        ? Math.min(limit, target === "BANNER" ? 4 : 8)
        : limit;
    // Direct .gif pins are sparse, so scan multiple Pinterest cursors, but do not
    // make the user wait through an excessive prefetch loop before showing results.
    const maxRequests = mediaFilter === "GIFS" ? 6 : 1;

    const collected: PinterestImageResult[] = [];
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    let guides: PinterestGuide[] = [];
    let nextBookmarks = bookmarks;
    let returnedBookmark: string[] | null = bookmarks.length ? bookmarks : null;
    let previousBookmarkKey = "";

    for (let requestIndex = 0; requestIndex < maxRequests; requestIndex++) {
        const response = await fetch(buildSearchUrl(query, limit, nextBookmarks), {
            headers: {
                "User-Agent": USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "x-pinterest-pws-handler": "www/pin/[id].js",
                Cookie: cookieHeader
            }
        });

        if (!response.ok) throw new Error(`Pinterest search failed with HTTP ${response.status}.`);

        const json = await response.json() as unknown;
        if (!isSearchPayload(json)) throw new Error("Pinterest returned an invalid response.");

        if (!guides.length) {
            guides = (json.resource_response?.data?.guides ?? [])
                .map(normalizeGuide)
                .filter((guide): guide is PinterestGuide => guide !== null)
                .slice(0, 8);
        }

        const normalized = (json.resource_response?.data?.results ?? [])
            .map(normalizePin)
            .filter((pin): pin is PinterestImageResult => pin !== null)
            .filter(pin => mediaFilter !== "STATIC" || !pin.isGif)
            .filter(pin => mediaFilter !== "GIFS" || pin.isGif);

        for (const pin of normalized) {
            if (seenIds.has(pin.id) || seenUrls.has(pin.url)) continue;
            seenIds.add(pin.id);
            seenUrls.add(pin.url);
            collected.push(pin);
        }

        returnedBookmark = json.resource_response?.bookmark?.length
            ? json.resource_response.bookmark
            : null;

        if (collected.length >= desiredResultCount || !returnedBookmark?.length) break;

        const bookmarkKey = JSON.stringify(returnedBookmark);
        if (bookmarkKey === previousBookmarkKey) {
            // Defensive stop for a Pinterest cursor that does not advance.
            returnedBookmark = null;
            break;
        }

        previousBookmarkKey = bookmarkKey;
        nextBookmarks = returnedBookmark;
    }

    return {
        query,
        guides,
        results: collected
            // Do not hard-reject narrow banner candidates. Wide media is still ranked
            // first by getTargetRank(), while Edit Image handles the final crop/zoom.
            // This intentionally applies to both Images and GIFs in Banner mode.
            .sort((a, b) => getTargetRank(a, target) - getTargetRank(b, target))
            .slice(0, limit),
        bookmark: returnedBookmark
    };
}

export async function fetchMedia(_: unknown, rawUrl: string) {
    const url = URL.parse(rawUrl);
    if (!url || !MEDIA_HOSTS.has(url.hostname)) throw new Error("Invalid Pinterest media URL.");

    const response = await fetch(url, {
        headers: {
            Accept: "*/*",
            "User-Agent": USER_AGENT
        }
    });

    if (!response.ok) throw new Error(`Failed to fetch Pinterest media with HTTP ${response.status}.`);

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
