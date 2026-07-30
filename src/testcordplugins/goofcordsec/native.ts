/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { release } from "node:os";

import { RendererSettings } from "@main/settings";
import { app, BrowserWindow, session } from "electron";

// ─────────────────────────────────────────────────────────────────── helpers

type PluginStore = {
    enabled?: boolean;
    firewall?: boolean;
    customFirewallRules?: boolean;
    blocklist?: string;
    blockedStrings?: string;
    allowedStrings?: string;
    unstrictCsp?: boolean;
    spoofChrome?: boolean;
    spoofWindows?: boolean;
    invidiousEmbeds?: boolean;
    invidiousInstance?: string;
    stripReferer?: boolean;
    sendDnt?: boolean;
    disableCrashReporter?: boolean;
};

const DEFAULT_BLOCKLIST = [
    "https://*/api/v*/science",
    "https://*/api/v*/applications/detectable",
    "https://*/api/v*/auth/location-metadata",
    "https://*/api/v*/premium-marketing",
    "https://*/api/v*/scheduled-maintenances/upcoming.json",
    "https://*/error-reporting-proxy/*",
    "https://cdn.discordapp.com/bad-domains/*",
    "https://www.youtube.com/youtubei/v*/next?*",
    "https://www.youtube.com/s/desktop/*",
    "https://www.youtube.com/youtubei/v*/log_event?*",
];
const DEFAULT_BLOCKED_STRINGS = ["sentry", "google", "tracking", "stats", "\\.spotify", "pagead", "analytics", "doubleclick"];
const DEFAULT_ALLOWED_STRINGS = ["videoplayback", "discord-attachments", "googleapis", "search", "api.spotify", "discord.com/assets/sentry.", "sentry-ipc"];

const log = (...args: unknown[]) => console.log("[GoofcordSecurity]", ...args);

function getStore(): PluginStore {
    return (RendererSettings.store.plugins as Record<string, PluginStore> | undefined)?.GoofcordSecurity ?? {};
}
function isEnabled(): boolean { return getStore().enabled === true; }
function splitList(raw: string | undefined, fallback: string[]): string[] {
    if (!raw) return fallback;
    const items = raw.split(",").map(s => s.trim()).filter(Boolean);
    return items.length ? items : fallback;
}

// ──────────────────────────────────────────────── boot-time (sync) options
// These must run BEFORE app.whenReady().
{
    const store = getStore();
    if (store.enabled && store.disableCrashReporter !== false) {
        try {
            app.commandLine.appendSwitch("disable-crash-reporter");
            app.commandLine.appendSwitch("disable-breakpad");
        } catch (e) {
            console.warn("[GoofcordSecurity] failed to set crash-reporter switches:", e);
        }
    }
}

// ─────────────────────────────────────────────────────────────────── firewall

let firewallInstalled = false;
function initFirewall() {
    if (firewallInstalled) return;
    const store = getStore();
    if (!store.firewall) return;

    const useCustom = !!store.customFirewallRules;
    const blocklist = useCustom ? splitList(store.blocklist, DEFAULT_BLOCKLIST) : DEFAULT_BLOCKLIST;
    const blockedStrings = useCustom ? splitList(store.blockedStrings, DEFAULT_BLOCKED_STRINGS) : DEFAULT_BLOCKED_STRINGS;
    const allowedStrings = useCustom ? splitList(store.allowedStrings, DEFAULT_ALLOWED_STRINGS) : DEFAULT_ALLOWED_STRINGS;

    if (blocklist.length && blocklist[0] !== "") {
        session.defaultSession.webRequest.onBeforeRequest({ urls: blocklist }, (_details, callback) => {
            callback({ cancel: true });
        });
    }

    const blockRegex = blockedStrings.length ? new RegExp(blockedStrings.join("|"), "i") : null;
    const allowRegex = allowedStrings.length ? new RegExp(allowedStrings.join("|"), "i") : null;

    // ⚠️ Electron only allows ONE listener per webRequest event.
    // We combine the firewall's substring filter with anti-tracking header
    // mutation in the same onBeforeSendHeaders call below.
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
        const headers: Record<string, string> = { ...details.requestHeaders };

        // Anti-tracking headers
        if (store.stripReferer !== false && !/\.hcaptcha\.com/i.test(details.url)) {
            delete headers.Referer;
            delete headers.referer;
        }
        if (store.sendDnt !== false) {
            headers.DNT = "1";
        }

        // Firewall (XHR-only substring filter)
        if (blockRegex && details.resourceType === "xhr") {
            if (blockRegex.test(details.url) && !(allowRegex && allowRegex.test(details.url))) {
                return callback({ cancel: true, requestHeaders: headers });
            }
        }
        callback({ cancel: false, requestHeaders: headers });
    });

    firewallInstalled = true;
    log("Firewall initialized (custom rules:", useCustom, ")");
}

// ─────────────────────────────────────────────────────────────── csp unstricter

let cspInstalled = false;
function initCspUnstricter() {
    if (cspInstalled) return;
    if (!getStore().unstrictCsp) return;

    session.defaultSession.webRequest.onHeadersReceived(({ responseHeaders, resourceType }, done) => {
        if (!responseHeaders) return done({});
        if (resourceType === "mainFrame" || resourceType === "subFrame") {
            responseHeaders["content-security-policy"] = [""];
        } else if (resourceType === "stylesheet") {
            // Some CDNs serve CSS with the wrong MIME (e.g. raw.githubusercontent.com) — fix it.
            responseHeaders["content-type"] = ["text/css"];
        }
        done({ responseHeaders });
    });

    cspInstalled = true;
    log("CSP unstricter installed");
}

// ─────────────────────────────────────────────────── chrome spoofer

interface Brand { brand: string; version: string; }
interface UserAgentMetadata {
    brands: Brand[];
    fullVersionList: Brand[];
    platform: string;
    platformVersion: string;
    architecture: string;
    model: string;
    mobile: boolean;
    bitness: string;
    wow64: boolean;
}
interface Profile { userAgent: string; platform: string; metadata: UserAgentMetadata; }

function generateUserAgentString(platform: "win32" | "darwin" | "linux", majorVersion: string): string {
    const engine = "AppleWebKit/537.36 (KHTML, like Gecko)";
    const browser = `Chrome/${majorVersion}.0.0.0 Safari/537.36`;
    switch (platform) {
        case "win32": return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${engine} ${browser}`;
        case "darwin": return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${engine} ${browser}`;
        case "linux": return `Mozilla/5.0 (X11; Linux x86_64) ${engine} ${browser}`;
        default: return `Mozilla/5.0 (X11; ${platform} x86_64) ${engine} ${browser}`;
    }
}

function generateClientHints(platform: "win32" | "darwin" | "linux", arch: string, osVersion: string, chromeVersion: string): UserAgentMetadata {
    const major = chromeVersion.split(".")[0];
    const brands: Brand[] = [
        { brand: "Chromium", version: major },
        { brand: "Google Chrome", version: major },
        { brand: "Not_A Brand", version: "99" },
    ];
    const fullVersionList: Brand[] = [
        { brand: "Chromium", version: chromeVersion },
        { brand: "Google Chrome", version: chromeVersion },
        { brand: "Not_A Brand", version: "99.0.0.0" },
    ];

    let pPlatform = "Unknown", pVersion = osVersion, pArch = "x86";
    const pBitness = "64";
    if (platform === "win32") { pPlatform = "Windows"; pVersion = "10.0.0"; }
    else if (platform === "darwin") { pPlatform = "macOS"; pArch = arch === "arm64" ? "arm" : "x86"; }
    else if (platform === "linux") { pPlatform = "Linux"; pVersion = ""; }

    return { brands, fullVersionList, platform: pPlatform, platformVersion: pVersion, architecture: pArch, model: "", mobile: false, bitness: pBitness, wow64: false };
}

function getProfile(): Profile {
    const store = getStore();
    const isWindowsSpoof = !!store.spoofWindows;
    const fullChromeVersion = process.versions.chrome;
    const major = fullChromeVersion.split(".")[0];
    const targetPlatform = isWindowsSpoof ? "win32" : (process.platform as "win32" | "darwin" | "linux");
    const targetArch = isWindowsSpoof ? "x64" : process.arch;

    let targetVersion = "10.0";
    if (!isWindowsSpoof) {
        if (process.platform === "darwin") targetVersion = (process as any).getSystemVersion?.() || "12.0.0";
        else targetVersion = release();
    }

    let jsPlatform = "Win32";
    if (targetPlatform === "darwin") jsPlatform = "MacIntel";
    else if (targetPlatform === "linux") jsPlatform = "Linux x86_64";

    return {
        userAgent: generateUserAgentString(targetPlatform, major),
        platform: jsPlatform,
        metadata: generateClientHints(targetPlatform, targetArch, targetVersion, fullChromeVersion),
    };
}

let cachedProfile: Profile | null = null;
async function spoofChrome(win: BrowserWindow) {
    if (!getStore().spoofChrome) return;
    cachedProfile ??= getProfile();
    const profile = cachedProfile;

    win.webContents.userAgent = profile.userAgent;

    const apply = async () => {
        try {
            if (!win.webContents.debugger.isAttached()) {
                try { win.webContents.debugger.attach("1.3"); }
                catch (err) { console.warn("[GoofcordSecurity] Debugger attach warning:", err); }
            }
            await win.webContents.debugger.sendCommand("Emulation.setUserAgentOverride", {
                userAgent: profile.userAgent,
                platform: profile.platform,
                userAgentMetadata: profile.metadata,
            });
        } catch (err) {
            console.error("[GoofcordSecurity] Failed to apply UA override:", err);
        }
    };

    win.webContents.on("did-navigate", () => void apply());
    await apply();
}

// ─────────────────────────────────────────────────────────── chrome spoofer

// ─────────────────────────────────────────────────────────────── JS-level request interceptor
// Silently drops analytics/sentry requests at the XHR/fetch level before they reach the network,
// eliminating ERR_BLOCKED_BY_CLIENT console noise from onBeforeRequest cancellation.

const REQUEST_INTERCEPTOR_SCRIPT = `
(() => {
    if (window.__gcSecRequestIntercepted) return;
    window.__gcSecRequestIntercepted = true;

    const blockedPatterns = [
        /\\/api\\/v\\d\\/science/,
        /\\/api\\/v\\d\\/applications\\/detectable/,
        /\\/api\\/v\\d\\/auth\\/location-metadata/,
        /\\/api\\/v\\d\\/premium-marketing/,
        /sentry/,
        /\\/bad-domains/,
        /analytics/,
        /tracking/,
        /stats/,
        /pagead/,
        /doubleclick/,
        /youtubei\\/v\\d\\/log_event/,
    ];

    const shouldBlock = (url) => {
        if (typeof url !== "string") return false;
        return blockedPatterns.some(p => p.test(url));
    };

    // Intercept XMLHttpRequest
    const _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (shouldBlock(url)) {
            this._gcBlocked = true;
            return;
        }
        return _xhrOpen.call(this, method, url, ...rest);
    };
    const _xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(...args) {
        if (this._gcBlocked) return;
        return _xhrSend.call(this, ...args);
    };
    const _xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(...args) {
        if (this._gcBlocked) return;
        return _xhrSetHeader.call(this, ...args);
    };

    // Intercept fetch
    const _fetch = window.fetch;
    window.fetch = function(input, init) {
        const url = typeof input === "string" ? input : input?.url;
        if (url && shouldBlock(url)) return Promise.resolve(new Response(null, { status: 204 }));
        return _fetch.call(this, input, init);
    };
})();`;

function injectInvidiousReplacer(win: BrowserWindow) {
    const store = getStore();
    if (!store.invidiousEmbeds) return;
    const instance = (store.invidiousInstance || "https://invidious.nerdvpn.de").replace(/\/+$/, "");

    const script = `
        (() => {
            if (window.__gcsInvidiousPatched) return;
            window.__gcsInvidiousPatched = true;
            const INSTANCE = ${JSON.stringify(instance)};
            const swap = (url) => {
                if (typeof url !== "string") return url;
                return url.replace("https://www.youtube.com/embed/", INSTANCE + "/embed/");
            };
            const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
            if (desc && desc.set) {
                Object.defineProperty(HTMLIFrameElement.prototype, "src", {
                    set(v) { return desc.set.call(this, swap(v)); },
                    get() { return desc.get.call(this); },
                    configurable: true,
                });
            }
        })();
    `;
    win.webContents.on("dom-ready", () => {
        void win.webContents.executeJavaScript(script).catch(() => { /* noop */ });
    });
}

// ────────────────────────────────────────────────────────── request interceptor injection

function injectRequestInterceptor(win: BrowserWindow) {
    void win.webContents.once("dom-ready", () => {
        void win.webContents.executeJavaScript(REQUEST_INTERCEPTOR_SCRIPT).catch(() => { /* noop */ });
    });
}

// ───────────────────────────────────────────────────────────────── bootstrap

let bootstrapped = false;
function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;
    if (!isEnabled()) { log("Plugin disabled — skipping init"); return; }

    initFirewall();
    initCspUnstricter();

    app.on("browser-window-created", (_e, win) => {
        if (!isEnabled()) return;
        void spoofChrome(win);
        injectInvidiousReplacer(win);
        injectRequestInterceptor(win);
    });

    log("Initialized");
}

if (app.isReady()) bootstrap();
else app.whenReady().then(bootstrap);
