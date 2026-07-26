/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, ipcMain, screen, Session,session, systemPreferences } from "electron";
import { existsSync,mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

// Inlined from nightcord/main/mediaPermissions.ts
function registerMediaPermissionsForSession(ses: Session) {
    ses.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, details) => {
        if (permission === "media") {
            return true;
        }
        return true;
    });

    ses.setPermissionRequestHandler(async (_webContents, permission, callback, details) => {
        if (permission === "media") {
            let granted = true;

            if (process.platform === "darwin" && "mediaTypes" in details) {
                if (details.mediaTypes?.includes("audio")) {
                    granted &&= await systemPreferences.askForMediaAccess("microphone");
                }
                if (details.mediaTypes?.includes("video")) {
                    granted &&= await systemPreferences.askForMediaAccess("camera");
                }
            }

            return callback(granted);
        }

        callback(true);
    });
}

const openWindows = new Map<string, BrowserWindow>();

// ─────────────────────────────────────────────────────────────────────────────
// Intercepts window control IPCs for a multi-instance.
//
// Native Discord uses ipcMain.handle("DISCORD_WINDOW_CLOSE" | "DISCORD_WINDOW_MINIMIZE" | ...)
// These handlers are registered GLOBALLY by Discord on ipcMain, so they
// catch all events from all windows and call injectedGetWindow(key)
// which always returns the main window.
//
// To work around this, we use webContents.ipc.handle on the webContents
// of each multi-instance window — these handlers are LOCAL to that webContents
// and take priority over global ipcMain handlers for that sender.
// ─────────────────────────────────────────────────────────────────────────────

function registerWindowControlIpc(win: BrowserWindow): () => void {
    const wc = win.webContents as any; // webContents.ipc existe depuis Electron 20

    // Native Discord channels (discovered in _core_extracted/bundle.js)
    const CLOSE = "DISCORD_WINDOW_CLOSE";
    const MINIMIZE = "DISCORD_WINDOW_MINIMIZE";
    const MAXIMIZE = "DISCORD_WINDOW_MAXIMIZE";
    const RESTORE = "DISCORD_WINDOW_RESTORE";
    const FULLSCREEN = "DISCORD_WINDOW_TOGGLE_FULLSCREEN";

    // webContents.ipc.handle takes priority over ipcMain.handle for this sender
    const handleClose = () => { if (!win.isDestroyed()) win.close(); };
    const handleMinimize = () => { if (!win.isDestroyed()) win.minimize(); };
    const handleMaximize = () => {
        if (win.isDestroyed()) return;
        if (win.isMaximized()) win.unmaximize(); else win.maximize();
    };
    const handleRestore = () => { if (!win.isDestroyed()) win.restore(); };
    const handleFullscreen = () => { if (!win.isDestroyed()) win.setFullScreen(!win.isFullScreen()); };

    try {
        // webContents.ipc.handle (Electron 20+)
        wc.ipc.handle(CLOSE, handleClose);
        wc.ipc.handle(MINIMIZE, handleMinimize);
        wc.ipc.handle(MAXIMIZE, handleMaximize);
        wc.ipc.handle(RESTORE, handleRestore);
        wc.ipc.handle(FULLSCREEN, handleFullscreen);
    } catch {
        // Fallback: global ipcMain.handle with sender filter
        // (less clean but works on Electron < 20)
        //
        // IMPORTANT: DISCORD_WINDOW_TOGGLE_FULLSCREEN is already registered globally
        // by the main patcher. We do NOT re-register it here to avoid
        // "Attempted to register a second handler" which crashes Discord on startup.
        const guardedHandle = (fn: () => void) => (event: Electron.IpcMainInvokeEvent) => {
            if (BrowserWindow.fromWebContents(event.sender) !== win) return;
            fn();
        };
        // removeHandler first to avoid crash in case of double call
        ipcMain.removeHandler(CLOSE);
        ipcMain.removeHandler(MINIMIZE);
        ipcMain.removeHandler(MAXIMIZE);
        ipcMain.removeHandler(RESTORE);
        // DO NOT register FULLSCREEN - handled globally by the patcher
        ipcMain.handle(CLOSE, guardedHandle(handleClose));
        ipcMain.handle(MINIMIZE, guardedHandle(handleMinimize));
        ipcMain.handle(MAXIMIZE, guardedHandle(handleMaximize));
        ipcMain.handle(RESTORE, guardedHandle(handleRestore));
        return () => {
            ipcMain.removeHandler(CLOSE);
            ipcMain.removeHandler(MINIMIZE);
            ipcMain.removeHandler(MAXIMIZE);
            ipcMain.removeHandler(RESTORE);
        };
    }

    // Returns the cleanup for webContents.ipc
    return () => {
        try {
            wc.ipc.removeHandler(CLOSE);
            wc.ipc.removeHandler(MINIMIZE);
            wc.ipc.removeHandler(MAXIMIZE);
            wc.ipc.removeHandler(RESTORE);
            wc.ipc.removeHandler(FULLSCREEN);
        } catch { }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Creates the preload script that injects the token
// ─────────────────────────────────────────────────────────────────────────────

function preloadDir() {
    return join(app.getPath("userData"), "nightcord-mi-preloads");
}

// The preload embeds the account's token in plaintext and the session re-reads it from disk
// on every frame, so it has to outlive the window. One file per account, deleted on close,
// instead of a new timestamped file left behind on every open.
function deleteTokenPreload(userId: string) {
    rmSync(join(preloadDir(), `token-preload-${userId}.js`), { force: true });
}

function createTokenPreload(token: string, userId: string): string {
    const dir = preloadDir();
    mkdirSync(dir, { recursive: true });

    const safeToken = JSON.stringify(token); // properly escapes the token

    const script = `
// Nightcord MultiInstance — token preload
// Runs in the main world BEFORE Discord
(function() {
    const TOKEN = ${safeToken};
    try {
        // Sets the token in localStorage
        Object.defineProperty(window, '__nightcord_token', { value: TOKEN, writable: false });

        // Patch localStorage.getItem to always return the token if requested
        const _origGetItem = Storage.prototype.getItem;
        const _origSetItem = Storage.prototype.setItem;

        Storage.prototype.getItem = function(key) {
            if (this === localStorage && key === "token") {
                return JSON.stringify(TOKEN);
            }
            return _origGetItem.call(this, key);
        };

        // Pre-fill as well
        try { localStorage.setItem("token", JSON.stringify(TOKEN)); } catch(_) {}

        console.log("[NightcordMI] Token preload active ✓");
    } catch(e) {
        console.warn("[NightcordMI] Preload error:", e);
    }
})();
`;

    const filePath = join(dir, `token-preload-${userId}.js`);
    writeFileSync(filePath, script, { encoding: "utf-8", mode: 0o600 });
    return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opens a new isolated Discord window
// ─────────────────────────────────────────────────────────────────────────────

// Detached icon counter: rotates from 1 to 5
let iconCounter = 1;

// Path to the detached icons folder (multi-instance-icons/ in dist)
function getDetachedIconDir(): string {
    // In production: {app_dir}/multi-instance-icons/
    // In dev: Desktop/lolll/
    const exeDir = join(process.execPath, "..");
    const prodDir = join(exeDir, "multi-instance-icons");
    if (existsSync(prodDir)) return prodDir;
    // Fallback dev : Desktop/lolll
    const desktopDir = join(app.getPath("desktop"), "lolll");
    if (existsSync(desktopDir)) return desktopDir;
    return prodDir;
}

export async function openInstanceWindow(
    _: any,
    token: string,
    userId: string,
    detached = false,
    username = ""
): Promise<{ ok: boolean; error?: string; }> {
    try {
        // Window already open -> focus
        const existing = openWindows.get(userId);
        if (existing && !existing.isDestroyed()) {
            existing.show();
            existing.focus();
            return { ok: true };
        }

        // Unique ID per instance - Windows groups windows by AppUserModelId
        // By giving a different ID to each window, they don't get grouped
        const uniqueAppId = `nightcord.instance.${userId}.${Date.now()}`;

        // Icon: rotation 1→2→3→4→5→1→... from multi-instance-icons/
        let currentIconPath = "";
        const iconDir = getDetachedIconDir();
        currentIconPath = join(iconDir, `${iconCounter}.ico`);
        if (!existsSync(currentIconPath)) currentIconPath = "";
        iconCounter = iconCounter >= 5 ? 1 : iconCounter + 1;

        // Isolated Electron session per userId
        const partition = `persist:nightcord-mi-${userId}`;
        const ses = session.fromPartition(partition, { cache: true });

        ses.webRequest.onHeadersReceived((details, callback) => {
            const headers = { ...details.responseHeaders };
            for (const key of Object.keys(headers)) {
                const low = key.toLowerCase();
                if (low === "content-security-policy" || low === "permissions-policy" || low === "feature-policy") {
                    delete headers[key];
                }
            }
            callback({ responseHeaders: headers });
        });

        registerMediaPermissionsForSession(ses);

        const preloadPath = createTokenPreload(token, userId);
        ses.setPreloads([preloadPath]);

        const win = new BrowserWindow({
            width: 1280,
            height: 800,
            minWidth: 940,
            minHeight: 500,
            parent: undefined,
            skipTaskbar: false,
            frame: false,
            transparent: false,
            titleBarStyle: "hidden",
            autoHideMenuBar: true,
            darkTheme: true,
            backgroundColor: "#313338",
            title: `Nightcord [${username || userId}]`,
            icon: currentIconPath || undefined,
            webPreferences: {
                preload: join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                session: ses,
                webSecurity: false,
            },
        });

        // CRITICAL: setAppDetails MUST be called immediately after new BrowserWindow,
        // before the window is shown. This is what prevents Windows from grouping
        // the windows together in the taskbar.
        if (process.platform === "win32") {
            try {
                win.setAppDetails({
                    appId: uniqueAppId,
                    appIconPath: currentIconPath || undefined,
                    relaunchDisplayName: `Nightcord [${username || userId}]`,
                });
            } catch (err) {
                console.warn("[NightcordMI] setAppDetails failed:", err);
            }
        }

        openWindows.set(userId, win);

        win.on("enter-html-full-screen", () => {
            win.setFullScreen(true);
        });
        win.on("leave-html-full-screen", () => {
            win.setFullScreen(false);
        });

        // Before close: unregister service workers and cut the gateway
        // to stop all push notifications
        win.on("close", () => {
            wc.executeJavaScript(`
                (async () => {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const r of regs) await r.unregister();
                    } catch(e) {}
                    try {
                        // Cut the Discord gateway connection
                        const ws = window.__NIGHTCORD_GW_WS__;
                        if (ws && ws.readyState <= 1) ws.close(4000, 'window_close');
                    } catch(e) {}
                })();
            `).catch(() => {});
        });

        // Register window control IPC handlers (DISCORD_WINDOW_*) on this webContents
        // Must be done BEFORE Discord loads its JS (dom-ready)
        const wc = win.webContents;
        const cleanupIpc = registerWindowControlIpc(win);

        win.once("closed", () => {
            cleanupIpc();
            deleteTokenPreload(userId);
            openWindows.delete(userId);
            // Clean up the session's service workers to permanently cut notifications
            ses.clearStorageData({ storages: ["serviceworkers"] }).catch(() => {});
        });

        // Flash when there are notifications
        wc.on("page-title-updated", (e, title) => {
            if (process.platform === "win32") {
                if (/^\(\d+\)/.test(title)) win.flashFrame(true);
                else win.flashFrame(false);
            }
        });

        // Token injection
        const safeToken = JSON.stringify(token);
        const injectJs = `(function(){ try { localStorage.setItem("token", ${safeToken}); } catch(e) {} })();`;
        wc.on("dom-ready", () => wc.executeJavaScript(injectJs).catch(() => { }));
        wc.on("did-finish-load", () => wc.executeJavaScript(injectJs).catch(() => { }));
        wc.on("did-navigate", () => wc.executeJavaScript(injectJs).catch(() => { }));

        // Window title
        wc.on("page-title-updated", (e, title) => {
            const cleanTitle = title.replace(/^\(\d+\)\s*/, "").replace(/\s*\[.*\]$/, "");
            win.setTitle(`${cleanTitle} [${username || userId}]`);
            e.preventDefault();
        });

        wc.on("will-navigate", (e, url) => {
            if (!/^https:\/\/(ptb\.|canary\.)?discord\.com/.test(url)) e.preventDefault();
        });

        wc.setWindowOpenHandler(({ url }) => {
            if (url.startsWith("http")) require("electron").shell.openExternal(url);
            return { action: "deny" };
        });

        await win.loadURL("https://discord.com/channels/@me");
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// "Grouped" windows — same group as Nightcord in the taskbar
// Principle: we do NOT touch setAppDetails => the window inherits the AppId
// of the main process (com.nightcord.app), Windows groups it automatically
// ─────────────────────────────────────────────────────────────────────────────

const openGroupedWindows = new Map<string, BrowserWindow>();

export async function openInstanceWindowGrouped(
    _: any,
    token: string,
    userId: string,
    username = ""
): Promise<{ ok: boolean; error?: string; }> {
    try {
        // Focus if already open
        const existing = openGroupedWindows.get(userId);
        if (existing && !existing.isDestroyed()) {
            existing.show();
            existing.focus();
            return { ok: true };
        }

        // Isolated session per userId
        const partition = `persist:nightcord-mi-${userId}`;
        const ses = session.fromPartition(partition, { cache: true });

        ses.webRequest.onHeadersReceived((details, callback) => {
            const headers = { ...details.responseHeaders };
            for (const key of Object.keys(headers)) {
                const low = key.toLowerCase();
                if (low === "content-security-policy" || low === "permissions-policy" || low === "feature-policy") {
                    delete headers[key];
                }
            }
            callback({ responseHeaders: headers });
        });

        registerMediaPermissionsForSession(ses);

        const preloadPath = createTokenPreload(token, userId);
        ses.setPreloads([preloadPath]);

        const win = new BrowserWindow({
            width: 1280,
            height: 800,
            minWidth: 940,
            minHeight: 500,
            parent: undefined,
            skipTaskbar: false,
            frame: false,
            transparent: false,
            titleBarStyle: "hidden",
            autoHideMenuBar: true,
            darkTheme: true,
            backgroundColor: "#313338",
            title: `Nightcord [${username || userId}]`,
            webPreferences: {
                preload: join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                session: ses,
                webSecurity: false,
            },
        });

        openGroupedWindows.set(userId, win);

        win.on("enter-html-full-screen", () => {
            win.setFullScreen(true);
        });
        win.on("leave-html-full-screen", () => {
            win.setFullScreen(false);
        });

        // Before close: unregister service workers and cut the gateway
        win.on("close", () => {
            wc.executeJavaScript(`
                (async () => {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const r of regs) await r.unregister();
                    } catch(e) {}
                    try {
                        const ws = window.__NIGHTCORD_GW_WS__;
                        if (ws && ws.readyState <= 1) ws.close(4000, 'window_close');
                    } catch(e) {}
                })();
            `).catch(() => {});
        });

        // Register window control IPC handlers for this grouped instance
        const wc = win.webContents;
        const cleanupIpc = registerWindowControlIpc(win);

        win.once("closed", () => {
            cleanupIpc();
            deleteTokenPreload(userId);
            openGroupedWindows.delete(userId);
            ses.clearStorageData({ storages: ["serviceworkers"] }).catch(() => {});
        });

        wc.on("page-title-updated", (e, title) => {
            if (process.platform === "win32") {
                if (/^\(\d+\)/.test(title)) win.flashFrame(true);
                else win.flashFrame(false);
            }
        });

        const safeToken = JSON.stringify(token);
        const injectJs = `(function(){ try { localStorage.setItem("token", ${safeToken}); } catch(e) {} })();`;
        wc.on("dom-ready", () => wc.executeJavaScript(injectJs).catch(() => {}));
        wc.on("did-finish-load", () => wc.executeJavaScript(injectJs).catch(() => {}));
        wc.on("did-navigate", () => wc.executeJavaScript(injectJs).catch(() => {}));

        wc.on("page-title-updated", (e, title) => {
            const cleanTitle = title.replace(/^\(\d+\)\s*/, "").replace(/\s*\[.*\]$/, "");
            win.setTitle(`${cleanTitle} [${username || userId}]`);
            e.preventDefault();
        });

        wc.on("will-navigate", (e, url) => {
            if (!/^https:\/\/(ptb\.|canary\.)?discord\.com/.test(url)) e.preventDefault();
        });

        wc.setWindowOpenHandler(({ url }) => {
            if (url.startsWith("http")) require("electron").shell.openExternal(url);
            return { action: "deny" };
        });

        await win.loadURL("https://discord.com/channels/@me");
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Split screen: positions the two windows side by side
// ─────────────────────────────────────────────────────────────────────────────

export async function arrangeSplit(_: any, userId: string): Promise<void> {
    try {
        const secondWin = openWindows.get(userId);
        if (!secondWin || secondWin.isDestroyed()) return;

        const allWins = BrowserWindow.getAllWindows();
        const mainWin = allWins.find(w => w !== secondWin && !w.isDestroyed());
        if (!mainWin) return;

        const display = screen.getDisplayMatching(mainWin.getBounds());
        const { x, y, width, height } = display.workArea;
        const half = Math.floor(width / 2);

        mainWin.setBounds({ x, y, width: half, height }, true);
        secondWin.setBounds({ x: x + half, y, width: width - half, height }, true);
        secondWin.show();
        secondWin.focus();
    } catch (e) {
        console.error("[NightcordMI] arrangeSplit error:", e);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// List / close instances
// ─────────────────────────────────────────────────────────────────────────────

export async function getOpenInstances(_: any): Promise<string[]> {
    return [...openWindows.entries()]
        .filter(([, w]) => !w.isDestroyed())
        .map(([id]) => id);
}

export async function closeInstance(_: any, userId: string): Promise<void> {
    const win = openWindows.get(userId);
    if (win && !win.isDestroyed()) win.close();
}
