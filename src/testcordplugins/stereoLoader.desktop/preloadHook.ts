/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 SirPhantom89
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";

// Modern Discord loads its voice engine inside the RENDERER process's
// preload context (sandbox:false), not in the main process. This module is
// imported by src/preload.ts so the redirect hook is installed in that
// context BEFORE Discord's own preload chains in and requires the voice
// module. It mirrors the decision logic of the plugin's native.ts but is
// fully self-contained - no Electron main APIs are touched here.

const DATA_DIR_NAME = "DiscordStereoLoader";
const VOICE_NODE_BASENAME = "discord_voice.node";
const VOICE_INDEX_BASENAME = "index.js";

interface PayloadMeta {
    electronAbi: string;
    arch: string;
    platform: string;
}

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

function enabledPath(): string {
    return join(dataDir(), "enabled.flag");
}

function log(line: string): void {
    try {
        mkdirSync(dataDir(), { recursive: true });
        appendFileSync(join(dataDir(), "stereoloader.log"), `[${new Date().toISOString()}] [renderer] ${line}\n`, "utf8");
    } catch { /* logging must never break boot */ }
}

function readMeta(): PayloadMeta | null {
    try {
        const raw = JSON.parse(readFileSync(join(dataDir(), "payload", "meta.json"), "utf8")) as Partial<PayloadMeta>;
        return raw && typeof raw.electronAbi === "string" ? raw as PayloadMeta : null;
    } catch {
        return null;
    }
}

/** Ancestors of the given path, nearest first. */
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

let cachedVoiceDir: string | null = null;

function stockVoiceDir(): string {
    if (cachedVoiceDir !== null) return cachedVoiceDir;

    // DISCORD_PRELOAD points into discord_desktop_core inside the modules
    // dir of this very install, so walking up from it finds discord_voice.
    const anchors = [process.env.DISCORD_PRELOAD || "", process.execPath];
    for (const anchor of anchors) {
        if (!anchor) continue;
        for (const root of [anchor, ...ancestors(anchor)]) {
            const direct = join(root, "modules", "discord_voice-1", "discord_voice");
            if (existsSync(join(direct, VOICE_NODE_BASENAME))) {
                cachedVoiceDir = direct;
                return direct;
            }

            const modulesDir = join(root, "modules");
            if (!existsSync(modulesDir)) continue;
            try {
                for (const entry of require("node:fs").readdirSync(modulesDir) as string[]) {
                    if (!entry.toLowerCase().startsWith("discord_voice")) continue;
                    for (const nested of [join(modulesDir, entry, "discord_voice"), join(modulesDir, entry)]) {
                        if (existsSync(join(nested, VOICE_NODE_BASENAME))) {
                            cachedVoiceDir = nested;
                            return nested;
                        }
                    }
                }
            } catch { /* keep scanning */ }
        }
    }

    cachedVoiceDir = "";
    return "";
}

function resolveRedirect(filename: string): string | null {
    if (!existsSync(enabledPath())) return null;

    const base = basename(filename);
    if (base !== VOICE_NODE_BASENAME && base !== VOICE_INDEX_BASENAME) return null;

    const voiceDir = stockVoiceDir();
    if (!voiceDir) return null;

    const canonical = process.platform === "win32" ? filename.toLowerCase() : filename;
    const canonicalVoiceDir = process.platform === "win32" ? voiceDir.toLowerCase() : voiceDir;
    if (!canonical.startsWith(canonicalVoiceDir)) return null;

    if (!existsSync(payloadPath(VOICE_NODE_BASENAME))) return null;

    const meta = readMeta();
    if (!meta) return null;
    if (meta.electronAbi !== process.versions.modules
        || meta.arch !== process.arch
        || meta.platform !== process.platform) return null;

    if (base === VOICE_INDEX_BASENAME && !existsSync(payloadPath(VOICE_INDEX_BASENAME))) return null;

    return payloadPath(base);
}

let redirectCount = 0;

/**
 * The renderer process has no access to the main process redirect counter,
 * so successful redirects are recorded in a marker file that getStatus()
 * picks up. This is what makes the plugin panel reflect reality.
 */
function noteRedirect(): void {
    redirectCount++;
    try {
        mkdirSync(dataDir(), { recursive: true });
        require("node:fs").writeFileSync(
            join(dataDir(), "renderer_redirects.json"),
            JSON.stringify({ count: redirectCount, pid: process.pid, time: Date.now() }),
            "utf8"
        );
    } catch { /* never break loading */ }
}

export function installStereoLoaderPreloadHook(): void {
    try {
        // Zero-cost exit for users who never used this plugin: without a
        // cached payload there is nothing to redirect, so don't wrap any
        // module loader at all.
        if (!existsSync(payloadPath(VOICE_NODE_BASENAME)) || !readMeta()) return;

        const Module = require("node:module") as unknown as {
            _extensions: Record<string, (this: unknown, module: unknown, filename: string) => void>;
        };
        const self = Module as unknown as { __stereoLoaderPreloadHook?: boolean; };
        if (self.__stereoLoaderPreloadHook) return;
        self.__stereoLoaderPreloadHook = true;

        const originalNode = Module._extensions[".node"];
        const originalJs = Module._extensions[".js"];

        function tryLoad(load: () => void, fallback: () => void, redirectedPath: string, originalPath: string): void {
            log(`Redirecting ${originalPath} -> ${redirectedPath}`);
            try {
                load();
                noteRedirect();
            } catch (error) {
                log(`FAIL: Patched payload failed to load (${String(error)}); falling back to stock.`);
                fallback();
            }
        }

        Module._extensions[".node"] = function (module, filename) {
            const redirected = resolveRedirect(String(filename));
            if (!redirected) {
                if (/voice/i.test(String(filename))) log(`TRACE: node load: ${filename}`);
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

        log(`Preload hook installed. abi=${process.versions.modules} arch=${process.arch}`);
    } catch (error) {
        log(`WARN: Could not install preload hook: ${String(error)}`);
    }
}
