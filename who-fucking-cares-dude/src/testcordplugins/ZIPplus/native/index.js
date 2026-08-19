/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;
export async function fetchAttachment(_event, url) {
    let timeout;
    try {
        if (!url)
            return null;
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok)
            return null;
        const length = Number(res.headers.get("content-length"));
        if (length > MAX_ATTACHMENT_BYTES)
            return null;
        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_ATTACHMENT_BYTES)
            return null;
        return new Uint8Array(arrayBuffer);
    }
    catch {
        return null;
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
export function zipPreviewUniqueIdThingyIdkMan() { }
