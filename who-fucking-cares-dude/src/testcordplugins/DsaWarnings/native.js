/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { RendererSettings } from "@main/settings";
import { BrowserWindow, net, session, shell } from "electron";
const CORS_PROXY = "https://cors.keiran0.workers.dev";
const PARTITION = "persist:dsa-warnings";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const WINDOW_WIDTH = 1120;
const WINDOW_HEIGHT = 860;
let captchaWindow = null;
function getPluginSettings() {
    return RendererSettings.store.plugins?.DsaWarnings;
}
function getBaseUrl() {
    return getPluginSettings()?.dsaBrowseBaseUrl || "https://dsa.discord.food";
}
function getCordBaseUrl() {
    return getPluginSettings()?.cordCatApiBaseUrl || "https://api.cord.cat";
}
function getSession() {
    return session.fromPartition(PARTITION, { cache: true });
}
function getMainWindow() {
    return BrowserWindow.getAllWindows().find(window => !window.isDestroyed()) ?? null;
}
function isSafeExternalUrl(url) {
    try {
        return new URL(url).protocol === "https:";
    }
    catch {
        return false;
    }
}
function getSafeCordQueryUrl(parsedId) {
    const url = new URL(`/api/v2/query/${encodeURIComponent(parsedId)}`, getCordBaseUrl());
    if (url.protocol !== "https:")
        throw new Error("CordCat API URL must use https.");
    return url.toString();
}
async function readCappedText(response) {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)
        throw new Error("Response was too large.");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
        throw new Error("Response was too large.");
    return text;
}
function buildBrowseUrl(parsedId) {
    const url = new URL("/browse", getBaseUrl());
    if (parsedId)
        url.searchParams.set("parsedId", parsedId);
    url.searchParams.set("sort", "applicationDate");
    url.searchParams.set("order", "desc");
    return url.toString();
}
function focusWindow(window) {
    if (window.isMinimized())
        window.restore();
    window.show();
    window.focus();
}
export async function openCaptchaWindow(_, parsedId) {
    if (captchaWindow && !captchaWindow.isDestroyed()) {
        focusWindow(captchaWindow);
        if (parsedId) {
            await captchaWindow.loadURL(buildBrowseUrl(parsedId));
        }
        return { ok: true };
    }
    const parent = getMainWindow();
    const win = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        minWidth: 900,
        minHeight: 680,
        title: "DSA Lookup Verification",
        parent: parent ?? undefined,
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            partition: PARTITION,
            sandbox: false,
            contextIsolation: true
        }
    });
    captchaWindow = win;
    win.on("closed", () => {
        if (captchaWindow === win)
            captchaWindow = null;
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isSafeExternalUrl(url))
            void shell.openExternal(url);
        return { action: "deny" };
    });
    await win.loadURL(buildBrowseUrl(parsedId));
    win.once("ready-to-show", () => focusWindow(win));
    return await new Promise(resolve => {
        win.once("closed", () => resolve({ ok: true }));
    });
}
async function tryDirectFetch(url, headers) {
    const response = await net.fetch(url, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        session: getSession()
    });
    return {
        ok: true,
        status: response.status,
        body: await readCappedText(response)
    };
}
async function tryNodeFetch(url, headers) {
    const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    return {
        ok: true,
        status: response.status,
        body: await readCappedText(response)
    };
}
async function tryProxiedFetch(targetUrl, headers) {
    const proxiedUrl = `${CORS_PROXY}?url=${encodeURIComponent(targetUrl)}`;
    const response = await fetch(proxiedUrl, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    return {
        ok: true,
        status: response.status,
        body: await readCappedText(response)
    };
}
function isUsableResponse(result) {
    return result.ok && result.status >= 200 && result.status < 400;
}
export async function fetchCordCatQuery(_, parsedId) {
    const url = getSafeCordQueryUrl(parsedId);
    const apiKey = getPluginSettings()?.cordCatApiKey;
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
        return {
            ok: false,
            error: "No CordCat API key configured. Open plugin settings and add your API key (get one at https://api.cord.cat)."
        };
    }
    const headers = {
        "Accept": "application/json",
        "X-API-Key": apiKey.trim()
    };
    let lastAuthStatus = null;
    const directResult = await tryDirectFetch(url, headers).catch(() => null);
    if (directResult) {
        if (isUsableResponse(directResult))
            return directResult;
        if (directResult.status === 401 || directResult.status === 403)
            lastAuthStatus = directResult.status;
    }
    const nodeResult = await tryNodeFetch(url, headers).catch(() => null);
    if (nodeResult) {
        if (isUsableResponse(nodeResult))
            return nodeResult;
        if (nodeResult.status === 401 || nodeResult.status === 403)
            lastAuthStatus = nodeResult.status;
    }
    const proxiedResult = await tryProxiedFetch(url, headers).catch(() => null);
    if (proxiedResult) {
        if (isUsableResponse(proxiedResult))
            return proxiedResult;
        if (proxiedResult.status === 401 || proxiedResult.status === 403)
            lastAuthStatus = proxiedResult.status;
    }
    if (lastAuthStatus != null) {
        return {
            ok: false,
            error: `CordCat API key was rejected (HTTP ${lastAuthStatus}). The key may be invalid or expired. Get a new one at https://api.cord.cat`
        };
    }
    return {
        ok: false,
        error: `All fetch methods failed for ${url}`
    };
}
