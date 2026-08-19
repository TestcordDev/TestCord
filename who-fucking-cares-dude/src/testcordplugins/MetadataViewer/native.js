/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const ALLOWED_ORIGINS = [
    "https://cdn.discordapp.com",
    "https://media.discordapp.net",
    "https://images-ext-1.discordapp.net",
    "https://images-ext-2.discordapp.net"
];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB
const FETCH_TIMEOUT_MS = 15000;
export async function fetchAttachment(_event, url) {
    let timeoutId;
    try {
        if (typeof url !== "string") {
            return { success: false, error: "Invalid URL parameter" };
        }
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        }
        catch {
            return { success: false, error: "Invalid URL format" };
        }
        if (!ALLOWED_ORIGINS.some(allowed => parsedUrl.origin === allowed || url.startsWith(allowed))) {
            return { success: false, error: "Domain not allowed" };
        }
        if (parsedUrl.protocol !== "https:") {
            return { success: false, error: "Only HTTPS protocol is supported" };
        }
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            clearTimeout(timeoutId);
            return { success: false, error: `HTTP status ${res.status}` };
        }
        const contentLength = res.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_SIZE) {
            clearTimeout(timeoutId);
            return { success: false, error: "File exceeds size limit (50MB)" };
        }
        const reader = res.body?.getReader();
        if (!reader) {
            clearTimeout(timeoutId);
            return { success: false, error: "Failed to read response body" };
        }
        const chunks = [];
        let totalSize = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (totalSize + value.length > MAX_SIZE) {
                await reader.cancel();
                clearTimeout(timeoutId);
                return { success: false, error: "File size limit exceeded during download" };
            }
            chunks.push(value);
            totalSize += value.length;
        }
        const buffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.length;
        }
        clearTimeout(timeoutId);
        return { success: true, data: buffer };
    }
    catch (err) {
        if (timeoutId)
            clearTimeout(timeoutId);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
