/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const CORS_PROXIES = [
    "https://corsproxy.io/?url=",
];
const DISCORD_MEDIA_SUFFIXES = [
    "discordapp.com",
    "discordapp.net",
];
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
function withProxy(base, url) {
    return base + encodeURIComponent(url);
}
function normalizeBuffer(data) {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
        return data.buffer;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
function normalizeUrl(url) {
    return url.startsWith("//") ? `https:${url}` : url;
}
function isDiscordMediaHost(host) {
    return DISCORD_MEDIA_SUFFIXES.some(suffix => host.endsWith(suffix));
}
function isRecord(value) {
    return !!value && typeof value === "object";
}
function getNativeModule(value) {
    if (!isRecord(value))
        return null;
    const { fetchMedia } = value;
    if (typeof fetchMedia !== "function")
        return null;
    return value;
}
async function tryFetch(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok)
            return null;
        const length = Number(response.headers.get("content-length"));
        if (length > MAX_MEDIA_BYTES)
            return null;
        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength)
            return null;
        if (buffer.byteLength > MAX_MEDIA_BYTES)
            return null;
        return {
            buffer,
            contentType: response.headers.get("content-type") ?? ""
        };
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timeout);
    }
}
function getNative() {
    if (IS_WEB || !VencordNative?.pluginHelpers)
        return null;
    const helpers = VencordNative.pluginHelpers;
    const direct = getNativeModule(helpers.GifCaptioner);
    if (direct)
        return direct;
    for (const candidate of Object.values(helpers)) {
        const native = getNativeModule(candidate);
        if (native)
            return native;
    }
    return null;
}
async function fetchNative(url) {
    const native = getNative();
    if (!native?.fetchMedia)
        return null;
    try {
        const result = await native.fetchMedia(url);
        if (!result?.data?.length)
            return null;
        return {
            buffer: normalizeBuffer(result.data),
            contentType: result.contentType ?? ""
        };
    }
    catch {
        return null;
    }
}
async function fetchSingle(url) {
    const normalizedUrl = normalizeUrl(url);
    const native = await fetchNative(normalizedUrl);
    if (native)
        return native;
    let host = "";
    try {
        host = new URL(normalizedUrl).host;
    }
    catch { }
    const shouldProxyFirst = !!host && !isDiscordMediaHost(host);
    const tryDirect = () => tryFetch(normalizedUrl);
    const tryProxies = async () => {
        for (const proxy of CORS_PROXIES) {
            const proxied = await tryFetch(withProxy(proxy, normalizedUrl));
            if (proxied)
                return proxied;
        }
        return null;
    };
    if (shouldProxyFirst) {
        const proxied = await tryProxies();
        if (proxied)
            return proxied;
    }
    const direct = await tryDirect();
    if (direct)
        return direct;
    return await tryProxies();
}
export async function fetchMedia(url, validate) {
    const urls = Array.isArray(url) ? url : [url];
    for (const entry of urls) {
        if (!entry)
            continue;
        const result = await fetchSingle(entry);
        if (!result)
            continue;
        if (validate && !validate(result))
            continue;
        return result;
    }
    return null;
}
