/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Native } from "./nativeShim";
import { settings } from "./settings";
import { LoggedAttachment } from "./types";

const blobUrlCache = new Map<string, string>();

export function getAttachmentExt(filename: string): string {
    const ext = filename.split(".").pop() ?? "";
    return /^[a-z0-9]{1,10}$/i.test(ext) ? ext.toLowerCase() : "";
}

function isAllowedExtension(ext: string): boolean {
    const raw = (settings.store.attachmentFileExtensions ?? "").trim().toLowerCase();
    if (!raw || raw === "none") return false;
    return raw.split(",").map(e => e.trim()).filter(Boolean).includes(ext);
}

let defaultDirCache: string | null = null;

export function getAttachmentDir(): string {
    if (settings.store.imageCacheDir) return settings.store.imageCacheDir;
    if (defaultDirCache) return defaultDirCache;
    return "";
}

export async function ensureDefaultDir(): Promise<string> {
    if (settings.store.imageCacheDir) return settings.store.imageCacheDir;
    if (defaultDirCache) return defaultDirCache;
    try {
        const { imageCacheDir } = await Native.getDefaultDirs();
        if (imageCacheDir) defaultDirCache = imageCacheDir;
        return settings.store.imageCacheDir || defaultDirCache || "";
    } catch {
        return "";
    }
}

export async function ensureAttachmentSaved(att: LoggedAttachment): Promise<void> {
    if (!att.id || !att.url || att.path) return;
    if (!settings.store.saveImages) return;

    const ext = getAttachmentExt(att.filename ?? "");
    if (!ext || !isAllowedExtension(ext)) return;
    if ((att.size ?? 0) > settings.store.attachmentSizeLimitInMegabytes * 1024 * 1024) return;

    let dir = getAttachmentDir();
    if (!dir) dir = await ensureDefaultDir();
    if (!dir) return;

    const result = await Native.downloadAttachment({ url: att.url!, id: att.id, ext }, dir);
    if (!result.success) return;

    att.path = result.path;
}

export async function getAttachmentBlobUrl(att: LoggedAttachment): Promise<string | undefined> {
    const id = att.id!;
    const cached = blobUrlCache.get(id);
    if (cached) return cached;

    if (!att.path) await ensureAttachmentSaved(att);
    if (!att.path) return undefined;

    let dir = getAttachmentDir();
    if (!dir) dir = await ensureDefaultDir();
    if (!dir) return undefined;

    // att.path stores absolute path; extract filename for Native call which expects filename + dir
    const filename = att.path.split(/[\\/]/).pop() ?? "";
    // Try current dir first; if that fails and att.path contains a different dir, retry with the stored dir segment
    let bytes = await Native.getImageNative(filename, dir);
    if (!bytes && (att.path.includes("/") || att.path.includes("\\"))) {
        const storedDir = att.path.slice(0, -filename.length).replace(/[\\/]$/, "");
        if (storedDir && storedDir !== dir) {
            bytes = await Native.getImageNative(filename, storedDir) ?? undefined as any;
            if (bytes) dir = storedDir;
        }
    }
    if (!bytes) return undefined;

    const contentType = att.content_type || "application/octet-stream";
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: contentType }));
    blobUrlCache.set(id, url);
    att.blobUrl = url;
    // Point the CDN fields at the local copy so deleted attachments keep rendering
    if (att.deleted) {
        att.oldUrl ??= att.url;
        att.oldProxyUrl ??= att.proxy_url;
        att.url = url + "#";
        att.proxy_url = url + "#";
    }
    return url;
}

export async function restoreAttachmentBlobs(attachments: LoggedAttachment[]): Promise<void> {
    for (const att of attachments) {
        if (!att.id || !att.path || att.blobUrl) continue;
        try {
            await getAttachmentBlobUrl(att);
        } catch { /* ignore individual failures */ }
    }
}
