/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const IMAGE_EXTS = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "heic", "heif", "tiff", "svg"
]);

function getExt(name?: string): string {
    if (!name) return "";
    const clean = name.split("?")[0].split("#")[0];
    const idx = clean.lastIndexOf(".");
    if (idx === -1) return "";
    const ext = clean.slice(idx + 1).toLowerCase();
    if (ext.length > 5) return "";
    return ext;
}

function isImageAttachment(att: any, includeGifs: boolean): boolean {
    if (!att) return false;
    const url = String(att.url ?? att.proxy_url ?? att.proxyUrl ?? "");
    if (!url) return false;

    const ct = String(att.content_type ?? att.contentType ?? "").toLowerCase();
    if (ct.startsWith("image/")) {
        if (!includeGifs && (ct === "image/gif" || url.toLowerCase().includes(".gif"))) return false;
        return true;
    }

    if (ct.startsWith("video/") || ct.startsWith("audio/")) return false;

    const filename = String(att.filename ?? att.name ?? "");
    const ext = getExt(filename) || getExt(url);

    if (ext) {
        if (!includeGifs && ext === "gif") return false;
        if (IMAGE_EXTS.has(ext)) return true;
    }

    const hasDimensions = typeof att.width === "number" && typeof att.height === "number" && att.width > 0 && att.height > 0;
    if (hasDimensions) {
        return true;
    }

    return false;
}

function isImageUrl(url: string, includeGifs: boolean, isExplicitEmbedImage = false): boolean {
    if (!url || typeof url !== "string") return false;
    if (!/^https?:\/\//i.test(url)) return false;

    const cleanUrl = url.split("?")[0].split("#")[0];
    const ext = getExt(cleanUrl);

    if (ext === "gif") {
        return includeGifs;
    }

    if (ext && IMAGE_EXTS.has(ext)) {
        return true;
    }

    try {
        const parsed = new URL(url);
        const format = parsed.searchParams.get("format")?.toLowerCase();
        if (format) {
            if (format === "gif") return includeGifs;
            if (IMAGE_EXTS.has(format)) return true;
        }
    } catch { }

    if (isExplicitEmbedImage) {
        if (/\.(mp4|webm|mov|avi|mkv)$/i.test(cleanUrl)) return false;
        return true;
    }

    return false;
}

export type GalleryItem = {
    key: string;
    channelId: string;
    messageId: string;
    url: string;
    proxyUrl?: string;
    width?: number;
    height?: number;
    filename?: string;
    authorId?: string;
    timestamp?: string;
};

export function extractImages(messages: any[], channelId: string, opts: { includeGifs: boolean; includeEmbeds: boolean; }): GalleryItem[] {
    const items: GalleryItem[] = [];

    for (const m of messages ?? []) {
        const messageId = String(m?.id ?? "");
        if (!messageId) continue;

        const base = {
            channelId,
            messageId,
            authorId: m?.author?.id ? String(m.author.id) : undefined,
            timestamp: m?.timestamp ? String(m.timestamp) : undefined
        };

        for (const a of m?.attachments ?? []) {
            if (!isImageAttachment(a, opts.includeGifs)) continue;
            const url = String(a.url ?? a.proxy_url ?? a.proxyUrl ?? "");
            if (!url) continue;
            const proxyUrl = (a.proxy_url ?? a.proxyUrl) ? String(a.proxy_url ?? a.proxyUrl) : undefined;
            const filename = (a.filename ?? a.name) ? String(a.filename ?? a.name) : undefined;
            const width = typeof a.width === "number" ? a.width : undefined;
            const height = typeof a.height === "number" ? a.height : undefined;

            items.push({
                ...base,
                key: `${messageId}:att:${url}`,
                url,
                proxyUrl,
                filename,
                width,
                height
            });
        }

        if (opts.includeEmbeds) {
            for (const e of m?.embeds ?? []) {
                if (e?.type === "video") continue;

                const image = e?.image;
                const thumb = e?.thumbnail;

                for (const [source, sourceKind] of [[image, "img"], [thumb, "thumb"]] as const) {
                    if (!source?.url) continue;
                    const url = String(source.url);
                    if (!isImageUrl(url, opts.includeGifs, true)) continue;

                    const proxyUrl = source.proxyURL ? String(source.proxyURL) : (source.proxy_url ? String(source.proxy_url) : undefined);
                    const width = typeof source.width === "number" ? source.width : undefined;
                    const height = typeof source.height === "number" ? source.height : undefined;

                    items.push({
                        ...base,
                        key: `${messageId}:embed:${sourceKind}:${url}`,
                        url,
                        proxyUrl,
                        width,
                        height,
                        filename: undefined
                    });
                }
            }
        }
    }

    return items;
}
