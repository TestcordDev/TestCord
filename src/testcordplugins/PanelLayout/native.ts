/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { safeFetch } from "@main/utils/safeFetch";
import { exec, execFile } from "child_process";
import { type IpcMainInvokeEvent, shell } from "electron";
import { existsSync, mkdirSync } from "fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "fs/promises";
import { basename, join, resolve } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function getRepoRootDir(): string {
    const candidates = [
        join(__dirname, "../.."),
        join(__dirname, ".."),
        process.cwd()
    ];
    for (const c of candidates) {
        if (existsSync(join(c, "package.json")) && existsSync(join(c, "src"))) {
            return c;
        }
    }
    return ["desktop", "equibop"].includes(basename(__dirname))
        ? join(__dirname, "../..")
        : join(__dirname, "..");
}

function getUserModulesDir(): string {
    const root = getRepoRootDir();
    const primary = join(root, "src", "testcordplugins", "PanelLayout", "usermodules");
    if (!existsSync(primary)) {
        try {
            mkdirSync(primary, { recursive: true });
        } catch { }
    }
    return primary;
}

function sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

function getSafeFilePath(id: string, baseDir: string): string | null {
    const safeId = sanitizeId(id);
    if (!safeId) return null;
    const resolvedPath = resolve(join(baseDir, `${safeId}.json`));
    const normalizedBase = resolve(baseDir);
    if (!resolvedPath.startsWith(normalizedBase)) {
        return null;
    }
    return resolvedPath;
}

export async function saveUserModule(
    _: IpcMainInvokeEvent,
    moduleData: any
): Promise<{ success: boolean; error?: string; }> {
    try {
        if (!moduleData || typeof moduleData !== "object" || !moduleData.id) {
            return { success: false, error: "Invalid module data" };
        }

        const baseDir = getUserModulesDir();
        await mkdir(baseDir, { recursive: true });

        const filePath = getSafeFilePath(String(moduleData.id), baseDir);
        if (!filePath) {
            return { success: false, error: "Invalid module path" };
        }

        const content = JSON.stringify(moduleData, null, 2);
        await writeFile(filePath, content, "utf8");
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || "Failed to save user module file" };
    }
}

export async function deleteUserModule(
    _: IpcMainInvokeEvent,
    id: string
): Promise<{ success: boolean; error?: string; }> {
    try {
        if (typeof id !== "string" || !id.trim()) {
            return { success: false, error: "Invalid module id" };
        }

        const baseDir = getUserModulesDir();
        const filePath = getSafeFilePath(id.trim(), baseDir);
        if (!filePath) {
            return { success: false, error: "Invalid module path" };
        }

        if (existsSync(filePath)) {
            await unlink(filePath);
        }
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || "Failed to delete user module file" };
    }
}

export async function loadUserModules(
    _: IpcMainInvokeEvent
): Promise<{ success: boolean; modules: any[]; error?: string; }> {
    try {
        const baseDir = getUserModulesDir();
        if (!existsSync(baseDir)) {
            return { success: true, modules: [] };
        }

        const files = await readdir(baseDir);
        const modules: any[] = [];

        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const fullPath = join(baseDir, file);
            try {
                const text = await readFile(fullPath, "utf8");
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === "object" && parsed.id) {
                    modules.push(parsed);
                }
            } catch {
                // Ignore corrupt single file
            }
        }

        return { success: true, modules };
    } catch (e: any) {
        return { success: false, modules: [], error: e?.message || "Failed to load user modules from disk" };
    }
}

export async function openUserModulesFolder(
    _: IpcMainInvokeEvent
): Promise<{ success: boolean; error?: string; }> {
    try {
        const baseDir = getUserModulesDir();
        await mkdir(baseDir, { recursive: true });
        await shell.openPath(baseDir);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || "Failed to open user modules folder" };
    }
}

let cachedStrawberryBinary: string | null = null;

function findStrawberryBinary(customPath?: string): string | null {
    if (customPath && customPath.trim()) {
        const trimmed = customPath.trim();
        if (existsSync(trimmed)) return trimmed;
    }

    if (cachedStrawberryBinary && existsSync(cachedStrawberryBinary)) {
        return cachedStrawberryBinary;
    }

    if (process.platform === "win32") {
        const programFiles = process.env.ProgramFiles || "C:\\Program Files";
        const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        const localAppData = process.env.LOCALAPPDATA || "";
        const candidates = [
            join(programFiles, "Strawberry Music Player", "strawberry.exe"),
            join(programFilesX86, "Strawberry Music Player", "strawberry.exe"),
            join(localAppData, "Programs", "Strawberry Music Player", "strawberry.exe"),
            join(programFiles, "Strawberry", "strawberry.exe"),
            "strawberry.exe"
        ];
        for (const candidate of candidates) {
            if (candidate === "strawberry.exe" || existsSync(candidate)) {
                cachedStrawberryBinary = candidate;
                return candidate;
            }
        }
    } else {
        cachedStrawberryBinary = "strawberry";
        return "strawberry";
    }
    return null;
}

export interface StrawberryNativeState {
    running: boolean;
    isPlaying: boolean;
    track: {
        id: string;
        name: string;
        artist: string;
        album: string;
        imageSrc: string | null;
        songDuration: number;
        elapsedSeconds: number;
        url?: string | null;
    } | null;
    position: number;
    volume: number;
}

export async function getStrawberryState(
    _: IpcMainInvokeEvent,
    customBinaryPath?: string
): Promise<StrawberryNativeState> {
    const defaultState: StrawberryNativeState = {
        running: false,
        isPlaying: false,
        track: null,
        position: 0,
        volume: 100,
    };

    try {
        if (process.platform === "linux") {
            try {
                const { stdout } = await execAsync(
                    "playerctl -p strawberry metadata --format \"{{status}};;;{{xesam:title}};;;{{xesam:artist}};;;{{xesam:album}};;;{{mpris:artUrl}};;;{{position}};;;{{mpris:length}};;;{{volume}}\" 2>/dev/null"
                );
                const parts = stdout.trim().split(";;;");
                if (parts.length >= 8) {
                    const status = parts[0]?.trim();
                    const title = parts[1]?.trim() || "Unknown Title";
                    const artist = parts[2]?.trim() || "Unknown Artist";
                    const album = parts[3]?.trim() || "";
                    let artUrl = parts[4]?.trim() || null;
                    const positionMicros = parseInt(parts[5] || "0", 10);
                    const lengthMicros = parseInt(parts[6] || "0", 10);
                    const volFloat = parseFloat(parts[7] || "1");

                    if (artUrl?.startsWith("file://")) {
                        const localPath = decodeURIComponent(artUrl.replace(/^file:\/\//, ""));
                        if (existsSync(localPath)) {
                            try {
                                const buffer = await readFile(localPath);
                                const ext = localPath.endsWith(".png") ? "png" : "jpeg";
                                artUrl = `data:image/${ext};base64,${buffer.toString("base64")}`;
                            } catch { }
                        }
                    }

                    const isPlaying = status.toLowerCase() === "playing";
                    const durationSec = lengthMicros > 0 ? Math.round(lengthMicros / 1000000) : 0;
                    const elapsedSec = positionMicros > 0 ? Math.round(positionMicros / 1000000) : 0;

                    return {
                        running: true,
                        isPlaying,
                        track: {
                            id: `${title}-${artist}`,
                            name: title,
                            artist,
                            album,
                            imageSrc: artUrl,
                            songDuration: durationSec,
                            elapsedSeconds: elapsedSec,
                            url: null,
                        },
                        position: elapsedSec * 1000,
                        volume: Math.round(volFloat * 100),
                    };
                }
            } catch { }
        } else if (process.platform === "win32") {
            try {
                const { stdout } = await execAsync(
                    "powershell -NoProfile -Command \"Get-Process strawberry -ErrorAction SilentlyContinue | Select-Object -ExpandProperty MainWindowTitle\"",
                    { timeout: 3000 }
                );
                const rawTitle = stdout.trim();
                if (rawTitle) {
                    if (rawTitle.toLowerCase() === "strawberry music player" || rawTitle.toLowerCase() === "strawberry") {
                        return {
                            running: true,
                            isPlaying: false,
                            track: null,
                            position: 0,
                            volume: 100,
                        };
                    }

                    const cleaned = rawTitle
                        .replace(/\s*-\s*Strawberry Music Player\s*$/i, "")
                        .replace(/\s*-\s*Strawberry\s*$/i, "")
                        .trim();

                    const segments = cleaned.split(" - ");
                    let artist = "Strawberry Music Player";
                    let title = cleaned;
                    if (segments.length >= 2) {
                        artist = segments[0].trim();
                        title = segments.slice(1).join(" - ").trim();
                    }

                    return {
                        running: true,
                        isPlaying: true,
                        track: {
                            id: `${title}-${artist}`,
                            name: title,
                            artist,
                            album: "",
                            imageSrc: null,
                            songDuration: 0,
                            elapsedSeconds: 0,
                            url: null,
                        },
                        position: 0,
                        volume: 100,
                    };
                }
            } catch { }
        }

        return defaultState;
    } catch {
        return defaultState;
    }
}

export async function sendStrawberryCommand(
    _: IpcMainInvokeEvent,
    action: string,
    arg?: any,
    customBinaryPath?: string
): Promise<{ success: boolean; error?: string; }> {
    try {
        if (process.platform === "linux") {
            const actionMap: Record<string, string> = {
                play: "play",
                pause: "pause",
                toggle: "play-pause",
                stop: "stop",
                next: "next",
                previous: "previous",
            };

            if (actionMap[action]) {
                try {
                    await execAsync(`playerctl -p strawberry ${actionMap[action]}`);
                    return { success: true };
                } catch { }
            } else if (action === "seek" && typeof arg === "number") {
                try {
                    await execAsync(`playerctl -p strawberry position ${arg}`);
                    return { success: true };
                } catch { }
            } else if (action === "volume" && typeof arg === "number") {
                try {
                    await execAsync(`playerctl -p strawberry volume ${arg / 100}`);
                    return { success: true };
                } catch { }
            }
        }

        const binary = findStrawberryBinary(customBinaryPath);
        if (!binary) {
            return { success: false, error: "Strawberry executable not found" };
        }

        let cliArgs: string[] = [];
        switch (action) {
            case "play":
                cliArgs = ["-p"];
                break;
            case "pause":
                cliArgs = ["-u"];
                break;
            case "toggle":
                cliArgs = ["-t"];
                break;
            case "stop":
                cliArgs = ["-s"];
                break;
            case "next":
                cliArgs = ["-f"];
                break;
            case "previous":
                cliArgs = ["-r"];
                break;
            case "seek":
                if (typeof arg === "number") {
                    cliArgs = ["--seek-to", String(Math.round(arg))];
                }
                break;
            case "volume":
                if (typeof arg === "number") {
                    cliArgs = ["-v", String(Math.max(0, Math.min(100, Math.round(arg))))];
                }
                break;
            default:
                return { success: false, error: `Unknown action: ${action}` };
        }

        if (cliArgs.length > 0) {
            await execFileAsync(binary, cliArgs);
            return { success: true };
        }

        return { success: false, error: "No arguments to execute" };
    } catch (e: any) {
        return { success: false, error: e?.message || "Failed to execute Strawberry command" };
    }
}

export async function fetchSpicyLyrics(
    _: IpcMainInvokeEvent,
    trackId: string,
    apiKey: string
): Promise<{ status: number; data?: any; error?: string; }> {
    try {
        const id = encodeURIComponent(trackId.trim());
        const key = apiKey.trim();
        const auth = key.startsWith("Bearer ") ? key : `Bearer ${key}`;
        const response = await safeFetch(`https://api.spicylyrics.org/v1/lyrics/${id}`, {
            method: "GET",
            headers: {
                Authorization: auth,
                Accept: "application/json",
                Origin: "https://discord.com"
            }
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => null);
            return {
                status: response.status,
                error: errBody?.Body?.error ?? errBody?.Body?.message ?? response.statusText
            };
        }

        const data = await response.json();
        return {
            status: response.status,
            data
        };
    } catch (e: any) {
        return {
            status: 500,
            error: e?.message || "Failed to fetch Spicy Lyrics"
        };
    }
}
