/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { net } from "electron";
import { COVER_SIZE, COVER_SIZE_PLACEHOLDER } from "../constants";
import { CLIENT_NAME, CLIENT_VERSION, COVER_FETCH_TIMEOUT_MS, COVER_HOSTS, COVER_REDIRECT_STATUSES, MAX_COVER_BYTES, MAX_COVER_CACHE_BYTES, MAX_COVER_REDIRECTS } from "./constants";
import { errorMessage, log } from "./state";
const cache = new Map();
const pending = new Map();
let cachedBytes = 0;
export function clearCoverCache() {
    cache.clear();
    cachedBytes = 0;
}
function remember(key, dataUrl) {
    cache.set(key, dataUrl);
    cachedBytes += dataUrl.length;
    while (cachedBytes > MAX_COVER_CACHE_BYTES && cache.size > 1) {
        const oldest = cache.keys().next().value;
        cachedBytes -= cache.get(oldest)?.length ?? 0;
        cache.delete(oldest);
    }
}
function withCoverSize(url) {
    const href = url.href.replace(COVER_SIZE_PLACEHOLDER, COVER_SIZE);
    try {
        return new URL(href);
    }
    catch (error) {
        log(`Keeping the original cover url: ${errorMessage(error)}`);
        return url;
    }
}
function parseAllowedUrl(value, base) {
    if (!value)
        return null;
    let url;
    try {
        url = base ? new URL(value, base) : new URL(value);
    }
    catch (error) {
        log(`Ignoring an unparsable cover url: ${errorMessage(error)}`);
        return null;
    }
    if (url.protocol !== "https:" || url.username || url.password)
        return null;
    if (url.port && url.port !== "443")
        return null;
    if (!COVER_HOSTS.has(url.hostname.toLowerCase()))
        return null;
    return withCoverSize(url);
}
async function readCapped(response) {
    const reader = response.body?.getReader();
    if (!reader)
        return Buffer.from(await response.arrayBuffer()).subarray(0, MAX_COVER_BYTES);
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > MAX_COVER_BYTES) {
            await reader.cancel();
            throw new Error("Cover is too large");
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
}
async function downloadCover(url, redirectCount = 0) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COVER_FETCH_TIMEOUT_MS);
    timeout.unref();
    try {
        const response = await net.fetch(url.href, {
            redirect: "manual",
            signal: controller.signal,
            headers: {
                Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "User-Agent": `${CLIENT_NAME}/${CLIENT_VERSION}`
            }
        });
        if (COVER_REDIRECT_STATUSES.has(response.status)) {
            if (redirectCount >= MAX_COVER_REDIRECTS)
                throw new Error("Too many redirects");
            const redirected = parseAllowedUrl(response.headers.get("location"), url);
            if (!redirected)
                throw new Error("Redirected to a disallowed cover host");
            return downloadCover(redirected, redirectCount + 1);
        }
        if (!response.ok)
            throw new Error(`Remote server returned HTTP ${response.status}`);
        const contentType = (response.headers.get("content-type") ?? "")
            .split(";", 1)[0]
            .trim()
            .toLowerCase();
        if (!contentType.startsWith("image/")) {
            throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
        }
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > MAX_COVER_BYTES) {
            throw new Error("Cover is too large");
        }
        const body = await readCapped(response);
        if (body.length === 0)
            throw new Error("Cover response is empty");
        return { body, contentType };
    }
    finally {
        clearTimeout(timeout);
    }
}
export function resolveCoverDataUrl(rawUrl) {
    const url = parseAllowedUrl(String(rawUrl ?? ""));
    if (!url)
        return Promise.resolve("");
    const { href } = url;
    const cached = cache.get(href);
    if (cached) {
        cache.delete(href);
        cache.set(href, cached);
        return Promise.resolve(cached);
    }
    const inFlight = pending.get(href);
    if (inFlight)
        return inFlight;
    const download = downloadCover(url)
        .then(cover => {
        const dataUrl = `data:${cover.contentType};base64,${cover.body.toString("base64")}`;
        remember(href, dataUrl);
        return dataUrl;
    })
        .catch(error => {
        log(`Cover load failed for ${url.hostname}: ${errorMessage(error)}`);
        return "";
    })
        .finally(() => pending.delete(href));
    pending.set(href, download);
    return download;
}
