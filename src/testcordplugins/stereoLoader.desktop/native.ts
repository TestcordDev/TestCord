/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 SirPhantom89
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { app } from "electron";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";

// This file runs in the Electron MAIN process when the main bundle boots,
// which happens before Discord requires its modules. Installing the loader
// hook at module scope means every later require() of the voice module is
// transparently redirected to our cached payload - the stock files on disk
// are never touched, so Discord's updater cannot wipe the patch.

const APP_NAME = "StereoLoader";
const DATA_DIR_NAME = "DiscordStereoLoader";
const VOICE_NODE_BASENAME = "discord_voice.node";
const VOICE_INDEX_BASENAME = "index.js";
const MAX_LOG_LINES = 300;

const VOICE_PLAYGROUND_RAW_BASE = "https://codeberg.org/UnpackedX/Discord-Experimental-Subsystem/raw/branch/main";
const DAC_GITHUB_CONTENTS_API = "https://api.github.com/repos/ProdHallow/Discord-Stereo-Windows-MacOS-Linux/contents/Updates%2FNodes%2FPatched%20Nodes%20%28for%20Installer%29%2FWindows";
const MAX_DOWNLOAD_BYTES = 160 * 1024 * 1024;

export type StereoSource = "voicePlayground" | "discordAudioCollective";

export interface PayloadMeta {
    source: StereoSource;
    hasIndexJs: boolean;
    electronAbi: string;
    electronVersion: string;
    arch: string;
    platform: string;
    time: number;
    nodeBytes: number;
}

export interface LoaderStatus {
    hookInstalled: boolean;
    platform: string;
    electronAbi: string;
    electronVersion: string;
    arch: string;
    appPath: string;
    buildLabel: string;
    stockVoiceDir: string;
    stockNodeExists: boolean;
    payloadNodeExists: boolean;
    payloadIndexExists: boolean;
    payloadMeta: PayloadMeta | null;
    compatible: boolean;
    enabledFlag: boolean;
    redirectCount: number;
    rendererRedirectCount: number;
    rendererRedirectTime: number;
    lastError: string;
    logPath: string;
    dataDir: string;
}

interface DacContentFile {
    type: "file";
    name: string;
    download_url: string;
}

const logs: string[] = [];
let redirectCount = 0;
let lastError = "";
let hookInstalled = false;
let cachedStockVoiceDir: string | null = null;

function dataDir(): string {
    const key = process.platform;
    if (key === "win32") {
        return join(process.env.LOCALAPPDATA || process.env.APPDATA || homedir(), DATA_DIR_NAME);
    }
    if (key === "darwin") {
        return join(homedir(), "Library", "Application Support", DATA_DIR_NAME);
    }
    const xdg = (process.env.XDG_DATA_HOME || "").trim();
    return join(xdg || join(homedir(), ".local", "share"), DATA_DIR_NAME);
}

function payloadPath(name: string): string {
    return join(dataDir(), "payload", name);
}

function metaPath(): string {
    return join(dataDir(), "payload", "meta.json");
}

function enabledPath(): string {
    return join(dataDir(), "enabled.flag");
}

function logFilePath(): string {
    return join(dataDir(), "stereoloader.log");
}

function log(line: string): void {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    logs.push(stamped);
    if (logs.length > MAX_LOG_LINES) logs.shift();
    try {
        mkdirSync(dataDir(), { recursive: true });
        appendFileSync(logFilePath(), `${stamped}\n`, "utf8");
    } catch { /* logging must never break loading */ }
}

function readMeta(): PayloadMeta | null {
    try {
        const raw = JSON.parse(readFileSync(metaPath(), "utf8")) as Partial<PayloadMeta>;
        if (raw && typeof raw.electronAbi === "string" && typeof raw.time === "number") {
            return raw as PayloadMeta;
        }
    } catch { /* no meta yet */ }
    return null;
}

function isEnabled(): boolean {
    return existsSync(enabledPath());
}

function isCompatible(meta: PayloadMeta): boolean {
    return meta.electronAbi === process.versions.modules
        && meta.arch === process.arch
        && meta.platform === process.platform;
}

/** All ancestor dirs of the given path, nearest first, up to 8 levels. */
function ancestors(path: string): string[] {
    const result: string[] = [];
    let current = path;
    for (let depth = 0; depth < 8; depth++) {
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
        result.push(current);
    }
    return result;
}

function voiceDirUnderRoot(root: string): string | null {
    const direct = join(root, "modules", "discord_voice-1", "discord_voice");
    if (existsSync(join(direct, VOICE_NODE_BASENAME))) return direct;

    const modulesDir = join(root, "modules");
    if (!existsSync(modulesDir)) return null;
    try {
        for (const entry of readdirSync(modulesDir)) {
            if (!entry.toLowerCase().startsWith("discord_voice")) continue;
            for (const nested of [join(modulesDir, entry, "discord_voice"), join(modulesDir, entry)]) {
                if (existsSync(join(nested, VOICE_NODE_BASENAME))) return nested;
            }
        }
    } catch { /* keep scanning */ }

    return null;
}

function defaultInstallRoots(): string[] {
    const key = process.platform;
    if (key === "win32") {
        const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA || "";
        return ["Discord", "DiscordCanary", "DiscordPTB", "DiscordDevelopment"]
            .map(name => join(localAppData, name));
    }
    if (key === "darwin") {
        const home = homedir();
        return [
            join(home, "Library", "Application Support", "discord"),
            join(home, "Library", "Application Support", "discordcanary"),
            join(home, "Library", "Application Support", "discordptb")
        ];
    }
    const home = homedir();
    return [
        join(home, ".config", "discord"),
        join(home, ".config", "discordcanary"),
        join(home, ".config", "discordptb")
    ];
}

/** The real discord_voice module directory of this very install (memoized). */
function stockVoiceDir(): string {
    if (cachedStockVoiceDir !== null) return cachedStockVoiceDir;

    // Newer Discord builds boot from resources/_app.asar, so getAppPath()
    // sits well below the app-<version> folder that owns modules/. Walk
    // every ancestor and look for a discord_voice module under each.
    for (const candidate of [app.getAppPath(), ...ancestors(app.getAppPath())]) {
        const found = voiceDirUnderRoot(candidate);
        if (found) {
            cachedStockVoiceDir = found;
            return found;
        }
    }

    // Last resort: any default install location on this machine.
    for (const root of defaultInstallRoots()) {
        if (!existsSync(root)) continue;
        try {
            for (const entry of readdirSync(root)) {
                if (!/^app-/i.test(entry)) continue;
                const found = voiceDirUnderRoot(join(root, entry));
                if (found) {
                    cachedStockVoiceDir = found;
                    return found;
                }
            }
        } catch { /* next root */ }
    }

    cachedStockVoiceDir = "";
    return "";
}

/**
 * Returns the cached payload path if this specific file load should be
 * redirected, or null to load the stock file untouched.
 */
function resolveRedirect(filename: string): string | null {
    if (!isEnabled()) return null;

    const base = basename(filename);
    if (base !== VOICE_NODE_BASENAME && base !== VOICE_INDEX_BASENAME) return null;

    // The patched index.js must only ever shadow the voice module's own
    // index.js - every other index.js in Discord loads untouched.
    const voiceDir = stockVoiceDir();
    if (!voiceDir) return null;

    const canonical = process.platform === "win32"
        ? filename.toLowerCase()
        : filename;
    const canonicalVoiceDir = process.platform === "win32"
        ? voiceDir.toLowerCase()
        : voiceDir;

    if (!canonical.startsWith(canonicalVoiceDir)) return null;

    if (!existsSync(payloadPath(VOICE_NODE_BASENAME))) return null;

    const meta = readMeta();
    if (!meta) {
        lastError = "Payload present but meta.json is unreadable; loading stock.";
        log(`WARN: ${lastError}`);
        return null;
    }

    if (!isCompatible(meta)) {
        lastError = `Cached payload was built for ABI ${meta.electronAbi}/${meta.arch}/${meta.platform} but this client is ${process.versions.modules}/${process.arch}/${process.platform}. Redownload needed; loading stock.`;
        log(`WARN: ${lastError}`);
        return null;
    }

    if (base === VOICE_INDEX_BASENAME && !meta.hasIndexJs) return null;

    return payloadPath(base);
}

/**
 * Fork entries may point at the voice module directory (resolved through its
 * package.json main) or directly at index.js. Normalize to index.js before
 * checking for a redirect.
 */
function redirectForkEntry(modulePath: string): string | null {
    const candidate = modulePath.toLowerCase().endsWith(".js")
        ? modulePath
        : join(modulePath, VOICE_INDEX_BASENAME);
    return resolveRedirect(candidate);
}

/** Trace every native module load so we can see how voice actually loads. */
function logNodeLoad(filename: string): void {
    if (/voice|media|utils|krisp|dispatch|modules/i.test(filename)) {
        log(`TRACE: node load: ${filename}`);
    }
}

function installForkHook(): void {
    // Modern Discord runs the voice engine in a separate utility process
    // instead of requiring it from the main process, so the module loader
    // hook alone never sees it. Intercept the fork itself and point it at
    // our self-contained cached copy of the module.
    function logFork(kind: string, modulePath: string): void {
        if (/voice|media|utils|krisp/i.test(modulePath)) {
            log(`TRACE: ${kind} fork: ${modulePath}`);
        }
    }

    try {
        const electron = require("electron") as {
            utilityProcess?: { fork: (modulePath: string, args?: unknown, options?: unknown) => unknown; };
        };
        if (electron.utilityProcess?.fork && !(electron.utilityProcess.fork as unknown as { __stereoPatched?: boolean; }).__stereoPatched) {
            const original = electron.utilityProcess.fork.bind(electron.utilityProcess);
            const patched = function (modulePath: string, args?: unknown, options?: unknown) {
                logFork("utility", String(modulePath));
                const redirected = redirectForkEntry(String(modulePath));
                if (!redirected) return original(modulePath, args, options);

                log(`Redirecting utility fork ${modulePath} -> ${redirected}`);
                try {
                    const child = original(redirected, args, options);
                    redirectCount++;
                    return child;
                } catch (error) {
                    lastError = `Redirected fork failed (${String(error)}); falling back to stock.`;
                    log(`FAIL: ${lastError}`);
                    return original(modulePath, args, options);
                }
            };
            (patched as unknown as { __stereoPatched: boolean; }).__stereoPatched = true;
            electron.utilityProcess.fork = patched;
            log("Utility fork hook installed.");
        }
    } catch (error) {
        log(`WARN: Could not hook utilityProcess.fork: ${String(error)}`);
    }

    // Some builds spawn voice via child_process.fork with an embedded node.
    try {
        const childProcess = require("node:child_process") as {
            fork: (modulePath: string, args?: unknown, options?: unknown) => unknown;
        };
        if (childProcess.fork && !(childProcess.fork as unknown as { __stereoPatched?: boolean; }).__stereoPatched) {
            const original = childProcess.fork.bind(childProcess);
            const patched = function (modulePath: string, args?: unknown, options?: unknown) {
                logFork("child", String(modulePath));
                const redirected = redirectForkEntry(String(modulePath));
                if (!redirected) return original(modulePath, args, options);

                log(`Redirecting child fork ${modulePath} -> ${redirected}`);
                try {
                    const child = original(redirected, args, options);
                    redirectCount++;
                    return child;
                } catch (error) {
                    lastError = `Redirected fork failed (${String(error)}); falling back to stock.`;
                    log(`FAIL: ${lastError}`);
                    return original(modulePath, args, options);
                }
            };
            (patched as unknown as { __stereoPatched: boolean; }).__stereoPatched = true;
            childProcess.fork = patched;
            log("Child process fork hook installed.");
        }
    } catch (error) {
        log(`WARN: Could not hook child_process.fork: ${String(error)}`);
    }
}

function installHook(): void {
    if (hookInstalled) return;
    hookInstalled = true;

    // Lazy-require keeps this out of the renderer bundle and avoids touching
    // Module before Node's module system is fully initialized.
    const Module = require("node:module") as unknown as {
        _extensions: Record<string, (this: unknown, module: unknown, filename: string) => void>;
    };
    const originalNode = Module._extensions[".node"];
    const originalJs = Module._extensions[".js"];

    function tryLoad(load: () => void, fallback: () => void, redirectedPath: string, originalPath: string): void {
        log(`Redirecting ${originalPath} -> ${redirectedPath}`);
        try {
            load();
            redirectCount++;
        } catch (error) {
            lastError = `Patched payload failed to load (${String(error)}); falling back to stock.`;
            log(`FAIL: ${lastError}`);
            fallback();
        }
    }

    Module._extensions[".node"] = function (module, filename) {
        const redirected = resolveRedirect(String(filename));
        if (!redirected) {
            logNodeLoad(String(filename));
            return originalNode.call(this, module, filename);
        }
        tryLoad(
            () => originalNode.call(this, module, redirected),
            () => originalNode.call(this, module, filename),
            redirected,
            String(filename)
        );
    };

    Module._extensions[".js"] = function (module, filename) {
        const redirected = resolveRedirect(String(filename));
        if (!redirected) return originalJs.call(this, module, filename);
        tryLoad(
            () => originalJs.call(this, module, redirected),
            () => originalJs.call(this, module, filename),
            redirected,
            String(filename)
        );
    };

    log(`Hook installed. abi=${process.versions.modules} arch=${process.arch} electron=${process.versions.electron}`);

    // The renderer writes its redirect count here; since it persists on
    // disk, clear it on every boot so the panel never shows last
    // session's numbers as if they were current.
    try {
        rmSync(join(dataDir(), "renderer_redirects.json"), { force: true });
    } catch { /* non-fatal */ }

    installForkHook();
}

installHook();

async function downloadBytes(url: string, timeoutMs: number, accept?: string): Promise<Buffer> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Download URL must use HTTPS.");
    if (!["api.github.com", "raw.githubusercontent.com", "codeberg.org"].includes(parsed.hostname)) {
        throw new Error(`Download host is not allowed: ${parsed.hostname}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {
        "User-Agent": VENCORD_USER_AGENT || APP_NAME,
        "Cache-Control": "no-cache"
    };
    if (accept) headers.Accept = accept;

    try {
        const res = await fetch(parsed, { headers, signal: controller.signal });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        const data = Buffer.from(await res.arrayBuffer());
        if (!data.byteLength) throw new Error("Empty download.");
        if (data.byteLength > MAX_DOWNLOAD_BYTES) throw new Error("Download too large.");

        const head = data.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
        if (head.startsWith("<!doctype html") || head.startsWith("<html")) throw new Error("Download looks like an HTML error page.");

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

function buildLabelFromAppPath(appPath: string): string {
    // Prefer the owning app-<version> folder; newer builds report
    // resources/_app.asar as the app path.
    for (const candidate of [basename(appPath), ...ancestors(appPath).map(p => basename(p))]) {
        const match = /^(?:app-)?([\d.]+)$/i.exec(candidate);
        if (match) return match[1];
    }
    return basename(appPath);
}

export async function getStatus(_: unknown): Promise<LoaderStatus> {
    const voiceDir = stockVoiceDir();
    const meta = readMeta();

    let rendererRedirectCount = 0;
    let rendererRedirectTime = 0;
    try {
        const raw = JSON.parse(readFileSync(join(dataDir(), "renderer_redirects.json"), "utf8")) as { count?: number; time?: number; };
        rendererRedirectCount = typeof raw?.count === "number" ? raw.count : 0;
        rendererRedirectTime = typeof raw?.time === "number" ? raw.time : 0;
    } catch { /* no redirects yet */ }

    return {
        hookInstalled,
        platform: process.platform,
        electronAbi: process.versions.modules,
        electronVersion: process.versions.electron || "",
        arch: process.arch,
        appPath: app.getAppPath(),
        buildLabel: buildLabelFromAppPath(app.getAppPath()),
        stockVoiceDir: voiceDir,
        stockNodeExists: !!voiceDir && existsSync(join(voiceDir, VOICE_NODE_BASENAME)),
        payloadNodeExists: existsSync(payloadPath(VOICE_NODE_BASENAME)),
        payloadIndexExists: existsSync(payloadPath(VOICE_INDEX_BASENAME)),
        payloadMeta: meta,
        compatible: !!meta && isCompatible(meta),
        enabledFlag: isEnabled(),
        redirectCount,
        rendererRedirectCount,
        rendererRedirectTime,
        lastError,
        logPath: logFilePath(),
        dataDir: dataDir()
    };
}

/** Downloads a patched voice module into the persistent cache and enables it. */
export async function downloadPayload(_: unknown, source: StereoSource): Promise<PayloadMeta> {
    let nodeData: Buffer;
    let indexData: Buffer | null = null;

    if (source === "voicePlayground") {
        if (process.platform !== "win32") {
            throw new Error("Voice Playground payloads are Windows-only. Use Discord Audio Collective instead.");
        }
        log("Downloading Voice Playground payload...");
        nodeData = await downloadBytes(`${VOICE_PLAYGROUND_RAW_BASE}/discord_voice.node`, 120_000);
        try {
            indexData = await downloadBytes(`${VOICE_PLAYGROUND_RAW_BASE}/index.js`, 60_000);
        } catch (error) {
            log(`WARN: index.js download failed (${String(error)}); caching node only.`);
        }
    } else {
        log("Downloading Discord Audio Collective payload...");
        const listingRaw = await downloadBytes(DAC_GITHUB_CONTENTS_API, 60_000, "application/vnd.github.v3+json");
        const listing = JSON.parse(listingRaw.toString("utf8")) as DacContentFile[];
        const pick = (name: string) => Array.isArray(listing)
            ? listing.find(file => file?.type === "file" && file.name === name && !!file.download_url)
            : undefined;

        const nodeEntry = pick(VOICE_NODE_BASENAME);
        const indexEntry = pick(VOICE_INDEX_BASENAME);
        if (!nodeEntry) throw new Error("discord_voice.node not found in the upstream folder listing.");

        nodeData = await downloadBytes(nodeEntry.download_url, 120_000);
        if (indexEntry) {
            try {
                indexData = await downloadBytes(indexEntry.download_url, 60_000);
            } catch (error) {
                log(`WARN: index.js download failed (${String(error)}); caching node only.`);
            }
        }
    }

    if (nodeData.byteLength < 1024) throw new Error("Downloaded binary is suspiciously small; aborting.");

    // Build a fully self-contained copy of the voice module: the patched
    // node/index plus every support file (phonon.dll, mediapipe.dll, helper
    // exes, tflite models) copied from the stock dir. The native engine
    // resolves those siblings relative to its own location, so a lone
    // discord_voice.node in an empty folder would fail to load.
    const payloadDir = join(dataDir(), "payload");
    rmSync(payloadDir, { recursive: true, force: true });
    mkdirSync(payloadDir, { recursive: true });

    const voiceDir = stockVoiceDir();
    let supportFiles = 0;
    if (voiceDir) {
        for (const entry of readdirSync(voiceDir)) {
            if (entry === VOICE_NODE_BASENAME || entry === VOICE_INDEX_BASENAME || entry === "package.json") continue;
            const source = join(voiceDir, entry);
            try {
                if (existsSync(source) && statSync(source).isFile()) {
                    copyFileSync(source, join(payloadDir, entry));
                    supportFiles++;
                }
            } catch (error) {
                log(`WARN: Could not copy support file ${entry}: ${String(error)}`);
            }
        }
    }
    if (!supportFiles) log("WARN: No support files copied from the stock module dir.");

    writeFileSync(payloadPath(VOICE_NODE_BASENAME), nodeData);
    if (indexData) writeFileSync(payloadPath(VOICE_INDEX_BASENAME), indexData);

    const meta: PayloadMeta = {
        source,
        hasIndexJs: !!indexData,
        electronAbi: process.versions.modules,
        electronVersion: process.versions.electron || "",
        arch: process.arch,
        platform: process.platform,
        time: Date.now(),
        nodeBytes: nodeData.byteLength
    };
    writeFileSync(metaPath(), JSON.stringify(meta, null, 4), "utf8");

    if (!isEnabled()) writeFileSync(enabledPath(), "1", "utf8");

    log(`OK: Payload cached (${Math.round(nodeData.byteLength / 1024 / 1024)} MB${indexData ? " + index.js" : ""}, ${supportFiles} support files). Redirect active for the next voice module load.`);
    return meta;
}

export async function clearPayload(_: unknown): Promise<boolean> {
    try {
        rmSync(join(dataDir(), "payload"), { recursive: true, force: true });
        rmSync(enabledPath(), { force: true });
        log("Payload cache cleared. Stock voice module will load from now on.");
        return true;
    } catch (error) {
        lastError = String(error);
        log(`FAIL: Could not clear cache: ${lastError}`);
        return false;
    }
}

export async function setEnabled(_: unknown, enabled: boolean): Promise<boolean> {
    try {
        if (enabled) {
            mkdirSync(dataDir(), { recursive: true });
            writeFileSync(enabledPath(), "1", "utf8");
        } else {
            rmSync(enabledPath(), { force: true });
        }
        log(enabled ? "Redirect enabled." : "Redirect disabled.");
        return true;
    } catch (error) {
        lastError = String(error);
        return false;
    }
}

/** Relaunches Discord so a toggled redirect takes effect. */
export async function relaunchApp(_: unknown): Promise<boolean> {
    log("Relaunch requested.");
    app.relaunch();
    app.exit(0);
    return true;
}

export async function readLogs(_: unknown): Promise<string[]> {
    try {
        const lines = readFileSync(logFilePath(), "utf8").split(/\r?\n/).filter(Boolean);
        return lines.slice(-MAX_LOG_LINES);
    } catch {
        return [...logs];
    }
}
