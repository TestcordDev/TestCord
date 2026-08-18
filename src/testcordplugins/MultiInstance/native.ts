/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { THEMES_DIR } from "@main/utils/constants";
import { ensureSafePath } from "@main/utils/ensureSafePath";
import { app, BrowserWindow, nativeImage, net, session, shell } from "electron";
import iconData from "file://../../../browser/icon.png?base64";
import { join } from "path";
import { pathToFileURL } from "url";

export interface NativeResult {
    ok: boolean;
    error?: string;
}

export type InstanceMode = "detached" | "grouped";

export interface InstanceUser {
    id: string;
    username: string;
    globalName?: string | null;
    avatarUrl: string;
}

export interface InstanceStatus {
    id: string;
    mode: InstanceMode;
    user?: InstanceUser;
}

const DISCORD_DOMAINS = ["discord.com", "ptb.discord.com", "canary.discord.com"] as const;
const DISCORD_HOSTS = new Set<string>(DISCORD_DOMAINS);
const DISCORD_ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const EXTERNAL_HOSTS = new Set(["discord.com", "ptb.discord.com", "canary.discord.com", "support.discord.com", "discord.gg"]);
const PROFILE_ID_RE = /^[a-z0-9_-]{1,32}$/i;
const DISCORD_USER_ID_RE = /^\d{17,20}$/;
const ICON = nativeImage.createFromDataURL(`data:image/png;base64,${iconData}`);
const openWindows = new Map<string, {
    ses: Electron.Session;
    win: BrowserWindow;
    saveSession: boolean;
    mode: InstanceMode;
    user?: InstanceUser;
}>();
const configuredSessions = new Set<string>();

type LocalIpc = {
    handle(channel: string, listener: () => void): void;
    removeHandler(channel: string): void;
};

type DiscordDomain = typeof DISCORD_DOMAINS[number];

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function normalizeProfileId(value: unknown) {
    if (typeof value !== "string") return null;

    const profileId = value.trim();
    if (!PROFILE_ID_RE.test(profileId)) return null;

    return profileId.toLowerCase();
}

function normalizeDisplayName(value: unknown, fallback: string) {
    if (typeof value !== "string") return fallback;

    const displayName = value.trim().replace(/\s+/g, " ").slice(0, 64);
    return displayName || fallback;
}

function normalizeDomain(value: unknown): DiscordDomain {
    return typeof value === "string" && DISCORD_HOSTS.has(value)
        ? value as DiscordDomain
        : "discord.com";
}

function normalizeInstanceMode(value: unknown): InstanceMode {
    return value === "grouped" ? "grouped" : "detached";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function normalizeInstanceUser(value: unknown): InstanceUser | undefined {
    if (!isRecord(value)) return;

    const user = value;
    if (
        typeof user.id !== "string" ||
        !DISCORD_USER_ID_RE.test(user.id) ||
        typeof user.username !== "string" ||
        !user.username.trim() ||
        user.username.length > 64 ||
        typeof user.avatarUrl !== "string"
    ) return;

    try {
        const avatarUrl = new URL(user.avatarUrl);
        if (
            avatarUrl.protocol !== "https:" ||
            !DISCORD_ATTACHMENT_HOSTS.has(avatarUrl.hostname) ||
            !avatarUrl.pathname.startsWith("/avatars/") &&
            !avatarUrl.pathname.startsWith("/embed/avatars/")
        ) return;
    } catch {
        return;
    }

    return {
        id: user.id,
        username: user.username.trim(),
        globalName: typeof user.globalName === "string" && user.globalName.trim()
            ? user.globalName.trim().slice(0, 64)
            : undefined,
        avatarUrl: user.avatarUrl
    };
}

function getDiscordUrl(domain: DiscordDomain) {
    return `https://${domain}/channels/@me`;
}

function isDiscordUrl(url: string) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && DISCORD_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
}

function isDiscordPopoutUrl(url: string) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" &&
            parsed.pathname === "/popout" &&
            (DISCORD_HOSTS.has(parsed.hostname) || parsed.hostname === "discord.gg");
    } catch {
        return false;
    }
}

function isDiscordAttachmentUrl(url: string) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" &&
            DISCORD_ATTACHMENT_HOSTS.has(parsed.hostname) &&
            (parsed.pathname.startsWith("/attachments/") || parsed.pathname.startsWith("/ephemeral-attachments/"));
    } catch {
        return false;
    }
}

function isAllowedExternalUrl(url: string) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && EXTERNAL_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
}

const CORS_PASSTHROUGH_DOMAINS = [
    "api.groq.com",
    "api.openai.com",
    "badges.equicord.org",
    "spotify-lyrics-api-pi.vercel.app",
    "api.cord.cat",
];

function removeBlockingHeaders(
    responseHeaders: Record<string, string[]> | undefined,
    resourceType?: string,
    url?: string
) {
    const headers = { ...(responseHeaders ?? {}) };

    for (const key of Object.keys(headers)) {
        const normalized = key.toLowerCase();

        if (
            normalized === "content-security-policy" ||
            normalized === "content-security-policy-report-only" ||
            normalized === "permissions-policy" ||
            normalized === "feature-policy"
        ) {
            delete headers[key];
        }
    }

    if (resourceType === "stylesheet") {
        let found = false;
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === "content-type") {
                headers[key] = ["text/css"];
                found = true;
            }
        }
        if (!found) {
            headers["content-type"] = ["text/css"];
        }
    }

    if (url && CORS_PASSTHROUGH_DOMAINS.some(d => url.startsWith(`https://${d}/`))) {
        const hasOrigin = Object.keys(headers).some(k => k.toLowerCase() === "access-control-allow-origin");
        if (!hasOrigin) {
            headers["access-control-allow-origin"] = ["*"];
            headers["access-control-allow-headers"] = ["*"];
            headers["access-control-allow-methods"] = ["GET, POST, PUT, DELETE, OPTIONS"];
        }
    }

    return headers;
}

function handleCustomProtocol(request: { url: string; }, scheme: string) {
    let url = decodeURI(request.url).slice(`${scheme}://`.length).replace(/\?v=\d+$/, "");

    if (url.endsWith("/")) url = url.slice(0, -1);

    if (url.startsWith("/themes/")) {
        const theme = url.slice("/themes/".length);

        const safeUrl = ensureSafePath(THEMES_DIR, theme);
        if (!safeUrl) {
            return new Response(null, {
                status: 404
            });
        }

        return net.fetch(pathToFileURL(safeUrl).toString());
    }

    switch (url) {
        case "renderer.js.map":
        case "preload.js.map":
        case "patcher.js.map":
        case "main.js.map":
            return net.fetch(pathToFileURL(join(__dirname, url)).toString());
        default:
            return new Response(null, {
                status: 404
            });
    }
}

function registerProtocols(ses: Electron.Session) {
    if (!ses.protocol.isProtocolHandled("vencord")) {
        ses.protocol.handle("vencord", req => handleCustomProtocol(req, "vencord"));
    }
    if (!ses.protocol.isProtocolHandled("equicord")) {
        ses.protocol.handle("equicord", req => handleCustomProtocol(req, "equicord"));
    }
}

function configureSession(partition: string, ses: Electron.Session) {
    registerProtocols(ses);

    if (configuredSessions.has(partition)) return;
    configuredSessions.add(partition);

    ses.webRequest.onHeadersReceived((details, callback) => {
        callback({ responseHeaders: removeBlockingHeaders(details.responseHeaders, details.resourceType, details.url) });
    });

    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const requestingUrl = details.requestingUrl || webContents.getURL();

        if (!isDiscordUrl(requestingUrl)) {
            callback(false);
            return;
        }

        callback(["clipboard-read", "display-capture", "fullscreen", "media", "notifications"].includes(permission));
    });
}

function registerWindowControls(win: BrowserWindow) {
    const localIpc = (win.webContents as { ipc?: LocalIpc; }).ipc;
    if (!localIpc) return () => undefined;

    const handlers = {
        DISCORD_WINDOW_CLOSE: () => {
            if (!win.isDestroyed()) win.close();
        },
        DISCORD_WINDOW_MINIMIZE: () => {
            if (!win.isDestroyed()) win.minimize();
        },
        DISCORD_WINDOW_MAXIMIZE: () => {
            if (win.isDestroyed()) return;
            if (win.isMaximized()) win.unmaximize();
            else win.maximize();
        },
        DISCORD_WINDOW_RESTORE: () => {
            if (!win.isDestroyed()) win.restore();
        },
        DISCORD_WINDOW_TOGGLE_FULLSCREEN: () => {
            if (!win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
        }
    };

    for (const [channel, handler] of Object.entries(handlers)) {
        localIpc.handle(channel, handler);
    }

    return () => {
        for (const channel of Object.keys(handlers)) {
            localIpc.removeHandler(channel);
        }
    };
}

function focusWindow(win: BrowserWindow) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

export async function openInstance(
    _event: Electron.IpcMainInvokeEvent,
    rawProfileId: unknown,
    rawDisplayName: unknown,
    rawSaveSession: unknown = true,
    rawDomain: unknown = "discord.com",
    rawBlockExternalTokenAccess: unknown = false,
    rawPerformanceMode: unknown = false,
    rawMode: unknown = "detached",
    rawToken: unknown = null
): Promise<NativeResult> {
    const profileId = normalizeProfileId(rawProfileId);
    if (!profileId) return { ok: false, error: "Invalid instance profile." };

    const displayName = normalizeDisplayName(rawDisplayName, "Secondary Discord");
    const blockExternalTokenAccess = rawBlockExternalTokenAccess === true;
    const performanceMode = rawPerformanceMode === true;
    const saveSession = !blockExternalTokenAccess && rawSaveSession !== false;
    const domain = normalizeDomain(rawDomain);
    const mode = normalizeInstanceMode(rawMode);
    const token = typeof rawToken === "string" && rawToken.trim() ? rawToken.trim() : null;
    const existing = openWindows.get(profileId);

    if (existing && !existing.win.isDestroyed()) {
        if (existing.mode !== mode) {
            return { ok: false, error: `Close this instance before reopening it as ${mode}.` };
        }

        if (blockExternalTokenAccess && existing.saveSession) {
            return { ok: false, error: "Close this instance before opening it with token protection." };
        }

        focusWindow(existing.win);
        return { ok: true };
    }

    try {
        const savedPartition = `persist:testcord-mi-${profileId}`;
        if (blockExternalTokenAccess) {
            const savedSes = session.fromPartition(savedPartition, { cache: true });
            await savedSes.clearStorageData();
            await savedSes.clearCache();
            configuredSessions.delete(savedPartition);
        }

        const partition = saveSession
            ? savedPartition
            : `testcord-mi-${profileId}-${Date.now()}`;
        const ses = session.fromPartition(partition, { cache: !blockExternalTokenAccess });
        configureSession(partition, ses);

        const win = new BrowserWindow({
            width: 1280,
            height: 800,
            minWidth: 940,
            minHeight: 500,
            title: displayName,
            autoHideMenuBar: true,
            backgroundColor: "#313338",
            darkTheme: true,
            icon: mode === "detached" ? ICON : undefined,
            show: false,
            webPreferences: {
                preload: join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                backgroundThrottling: performanceMode,
                partition,
                session: ses
            }
        });

        const cleanupWindowControls = registerWindowControls(win);
        const { webContents } = win;

        openWindows.set(profileId, { ses, win, saveSession, mode });

        if (process.platform === "win32" && mode === "detached") {
            win.setAppDetails({
                appId: `${app.name}.multiInstance.${profileId}`,
                relaunchDisplayName: displayName
            });
        }

        win.once("ready-to-show", () => focusWindow(win));
        win.once("closed", () => {
            cleanupWindowControls();
            openWindows.delete(profileId);
            configuredSessions.delete(partition);

            if (!saveSession) {
                void ses.clearStorageData();
                void ses.clearCache();
            }
        });
        win.on("enter-html-full-screen", () => win.setFullScreen(true));
        win.on("leave-html-full-screen", () => win.setFullScreen(false));

        if (token && !blockExternalTokenAccess) {
            const cleanToken = token.replace(/^["'\s]+|["'\s]+$/g, "");
            if (cleanToken) {
                // Discord reads localStorage.token only at boot to open the gateway,
                // and it neuters window.localStorage on its own pages. The reliable way
                // to log in with a token is therefore: write the (single) JSON-encoded
                // token through a throwaway iframe's localStorage, then reload so the
                // client boots with it. Run once per window to avoid a reload loop.
                const injectTokenScript = `
                    (function() {
                        try {
                            const token = ${JSON.stringify(cleanToken)};
                            const stored = JSON.stringify(token);

                            function writeToken() {
                                try {
                                    const f = document.createElement("iframe");
                                    f.style.display = "none";
                                    document.body.appendChild(f);
                                    if (f.contentWindow) {
                                        f.contentWindow.localStorage.setItem("token", stored);
                                        f.contentWindow.localStorage.token = stored;
                                    }
                                    f.remove();
                                } catch(e) {}
                            }

                            function trySetToken() {
                                try {
                                    const wp = window.Vencord?.Webpack;
                                    const store = wp?.findByProps?.("getToken", "setToken");
                                    if (store && typeof store.setToken === "function") {
                                        store.setToken(token);
                                        return true;
                                    }
                                } catch(e) {}
                                return false;
                            }

                            writeToken();
                            let ticks = 0;
                            const interval = setInterval(() => {
                                writeToken();
                                trySetToken();
                                if (++ticks >= 20) clearInterval(interval);
                            }, 50);

                            setTimeout(() => {
                                clearInterval(interval);
                                window.location.reload();
                            }, 1200);
                        } catch(e) {}
                    })();
                `;

                let tokenInjected = false;
                webContents.on("dom-ready", () => {
                    if (tokenInjected) return;
                    tokenInjected = true;
                    webContents.executeJavaScript(injectTokenScript).catch(() => { });
                });
            }
        }

        webContents.on("will-navigate", (event, url) => {
            if (isDiscordAttachmentUrl(url)) {
                event.preventDefault();
                webContents.downloadURL(url);
                return;
            }

            if (!isDiscordUrl(url)) event.preventDefault();
        });

        webContents.setWindowOpenHandler(({ url }) => {
            if (isDiscordPopoutUrl(url)) {
                return { action: isDiscordUrl(url) ? "allow" : "deny" };
            }

            if (isDiscordAttachmentUrl(url)) {
                webContents.downloadURL(url);
                return { action: "deny" };
            }

            if (isAllowedExternalUrl(url)) {
                void shell.openExternal(url);
            }

            return { action: "deny" };
        });

        webContents.on("page-title-updated", (event, title) => {
            const cleanTitle = title.replace(/^\(\d+\)\s*/, "").trim();
            win.setTitle(cleanTitle ? `${cleanTitle} (${displayName})` : displayName);
            event.preventDefault();
        });

        await win.loadURL(getDiscordUrl(domain));
        return { ok: true };
    } catch (error) {
        return { ok: false, error: getErrorMessage(error) };
    }
}

export async function getOpenInstances(_event: Electron.IpcMainInvokeEvent): Promise<InstanceStatus[]> {
    return [...openWindows.entries()]
        .filter(([, { win }]) => !win.isDestroyed())
        .map(([id, { mode, user }]) => ({ id, mode, user }));
}

export async function reportInstanceUser(
    event: Electron.IpcMainInvokeEvent,
    rawUser: unknown
): Promise<NativeResult> {
    const entry = [...openWindows.values()].find(({ win }) => !win.isDestroyed() && win.webContents.id === event.sender.id);
    if (!entry) return { ok: true };

    entry.user = normalizeInstanceUser(rawUser);
    return { ok: true };
}

export async function closeInstance(
    _event: Electron.IpcMainInvokeEvent,
    rawProfileId: unknown
): Promise<NativeResult> {
    const profileId = normalizeProfileId(rawProfileId);
    if (!profileId) return { ok: false, error: "Invalid instance profile." };

    const entry = openWindows.get(profileId);
    if (!entry || entry.win.isDestroyed()) return { ok: true };

    entry.win.close();
    return { ok: true };
}

export async function closeAllInstances(_event: Electron.IpcMainInvokeEvent): Promise<NativeResult> {
    for (const { win } of openWindows.values()) {
        if (!win.isDestroyed()) win.close();
    }

    return { ok: true };
}

export async function clearSavedSession(
    _event: Electron.IpcMainInvokeEvent,
    rawProfileId: unknown
): Promise<NativeResult> {
    const profileId = normalizeProfileId(rawProfileId);
    if (!profileId) return { ok: false, error: "Invalid instance profile." };

    const entry = openWindows.get(profileId);
    if (entry && !entry.win.isDestroyed()) {
        return { ok: false, error: "Close this instance before clearing its saved session." };
    }

    try {
        const partition = `persist:testcord-mi-${profileId}`;
        const ses = session.fromPartition(partition, { cache: true });

        await ses.clearStorageData();
        await ses.clearCache();
        configuredSessions.delete(partition);

        return { ok: true };
    } catch (error) {
        return { ok: false, error: getErrorMessage(error) };
    }
}
