/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const ALLOWED_HOSTS = new Set([
    "cdn.discordapp.com",
    "media.discordapp.net",
]);
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
const FETCH_TIMEOUT_MS = 30000;
function checkUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:")
        throw new Error("Not an https URL");
    if (!ALLOWED_HOSTS.has(url.hostname))
        throw new Error("Not a Discord CDN host");
    const path = decodeURIComponent(url.pathname).toLowerCase();
    if (!path.startsWith("/attachments/") && !path.startsWith("/ephemeral-attachments/"))
        throw new Error("Not an attachment path");
    if (!path.endsWith(".pdf"))
        throw new Error("Not a PDF");
    return url;
}
export async function fetchPdf(_, rawUrl, maxBytes) {
    const url = checkUrl(rawUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            redirect: "manual",
            signal: controller.signal,
            headers: { Accept: "application/pdf,*/*;q=0.1" },
        });
        if (res.status >= 300 && res.status < 400)
            throw new Error("CDN tried to redirect, refusing");
        if (!res.ok)
            throw new Error(`CDN returned ${res.status}`);
        const declared = Number(res.headers.get("content-length"));
        if (declared > maxBytes)
            throw new Error(`PDF is ${(declared / 1024 / 1024).toFixed(1)} MB which exceeds the limit`);
        const reader = res.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            total += value.byteLength;
            if (total > maxBytes) {
                reader.cancel();
                throw new Error("PDF exceeded the size limit mid-download");
            }
            chunks.push(value);
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
        }
        for (let i = 0; i < PDF_MAGIC.length; i++) {
            if (out[i] !== PDF_MAGIC[i])
                throw new Error("Downloaded data is not a valid PDF");
        }
        return out;
    }
    finally {
        clearTimeout(timeout);
    }
}
