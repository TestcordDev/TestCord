/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
export async function fetchMedia(_event, url) {
    let timeout;
    try {
        if (!url)
            return null;
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok)
            return null;
        const length = Number(response.headers.get("content-length"));
        if (length > MAX_MEDIA_BYTES)
            return null;
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_MEDIA_BYTES)
            return null;
        const data = new Uint8Array(arrayBuffer);
        if (!data.length)
            return null;
        return {
            data,
            contentType: response.headers.get("content-type") ?? ""
        };
    }
    catch {
        return null;
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
export function gifCaptionerUniqueIdThingyIdkMan() { }
