/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sleep } from "@utils/misc";
import { PluginNative } from "@utils/types";
import { saveFile } from "@utils/web";

import type { GalleryItem } from "./extractImages";

const Native = VencordNative?.pluginHelpers?.ChannelGallery as PluginNative<typeof import("../native")> | undefined;

function extFromName(name: string): string {
    const idx = name.lastIndexOf(".");
    if (idx <= 0 || idx === name.length - 1) return "";
    const ext = name.slice(idx + 1).toLowerCase();
    return /^[a-z0-9]{1,5}$/.test(ext) ? ext : "";
}

function extFromUrl(url: string): string {
    try {
        const path = url.split("?")[0].split("#")[0];
        return extFromName(path.slice(path.lastIndexOf("/") + 1));
    } catch {
        return "";
    }
}

function sanitizeStem(stem: string): string {
    const clean = stem.replace(/[\\/:*?"<>|]+/g, "_").trim();
    return clean.slice(0, 80);
}

function buildFilename(item: GalleryItem, index: number): string {
    const raw = item.filename ?? "";
    const dot = raw.lastIndexOf(".");
    const stemSource = dot > 0 ? raw.slice(0, dot) : "";
    const ext = extFromName(raw) || extFromUrl(item.proxyUrl ?? item.url) || "png";
    const stem = sanitizeStem(stemSource) || `image_${index + 1}`;
    return `${item.messageId}_${stem}.${ext}`;
}

export type DownloadResult = { saved: number; failed: number };

export async function downloadItemsToFolder(items: GalleryItem[], onProgress?: (done: number, total: number) => void): Promise<DownloadResult> {
    const total = items.length;
    if (!total) return { saved: 0, failed: 0 };

    if (Native) {
        let folder: string | null;
        try {
            folder = await Native.pickFolder();
        } catch {
            return { saved: 0, failed: 0 };
        }
        if (!folder) return { saved: 0, failed: 0 };

        let saved = 0;
        let failed = 0;
        for (let i = 0; i < total; i++) {
            try {
                await Native.downloadToFolder(folder, buildFilename(items[i], i), items[i].url);
                saved++;
            } catch {
                failed++;
            }
            onProgress?.(i + 1, total);
        }
        return { saved, failed };
    }

    let saved = 0;
    let failed = 0;
    for (let i = 0; i < total; i++) {
        try {
            const res = await fetch(items[i].url);
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const blob = await res.blob();
            saveFile(new File([blob], buildFilename(items[i], i), { type: blob.type || "application/octet-stream" }));
            saved++;
        } catch {
            failed++;
        }
        onProgress?.(i + 1, total);
        await sleep(300);
    }
    return { saved, failed };
}
