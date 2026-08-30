/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DATA_DIR } from "@main/utils/constants";
import { dialog, type IpcMainInvokeEvent,shell } from "electron";

const ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;

type DownloadResult = { success: true; path: string; } | { success: false; error: string; };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

// Renderer-controlled paths are untrusted: require an absolute path with no traversal segments.
function safeDir(dir: unknown): string | null {
    if (typeof dir !== "string" || !path.isAbsolute(dir)) return null;
    const resolved = path.resolve(dir);
    if (resolved.split(path.sep).includes("..")) return null;
    return resolved;
}

function safeFilename(name: unknown): string | null {
    if (typeof name !== "string" || !/^[a-zA-Z0-9._-]{1,128}$/.test(name)) return null;
    if (name.includes("..")) return null;
    return name;
}

async function ensureDirExists(dir: string) {
    await mkdir(dir, { recursive: true });
}

export async function getDefaultDirs(): Promise<{ imageCacheDir: string; logsDir: string; }> {
    const base = path.join(DATA_DIR, "messageLoggerTestcord");
    return {
        imageCacheDir: path.join(base, "savedAttachments"),
        logsDir: base
    };
}

export async function chooseDir(_event: IpcMainInvokeEvent, kind: unknown): Promise<string> {
    if (kind !== "logsDir" && kind !== "imageCacheDir") throw new Error("Invalid directory kind.");

    const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const dir = res.filePaths[0];
    if (!dir) throw new Error("No directory selected.");
    return dir;
}

export async function showItemInFolder(_event: IpcMainInvokeEvent, targetPath: unknown) {
    if (typeof targetPath !== "string" || !targetPath) throw new Error("Invalid path.");
    shell.showItemInFolder(targetPath);
}

export async function writeImageNative(
    _event: IpcMainInvokeEvent,
    filename: unknown,
    content: unknown,
    dir: unknown
): Promise<{ success: boolean; error?: string; }> {
    const safeName = safeFilename(filename);
    const safeDirPath = safeDir(dir);
    if (!safeName || !safeDirPath) return { success: false, error: "Invalid attachment filename or directory." };
    if (!(content instanceof Uint8Array)) return { success: false, error: "Invalid attachment content." };

    try {
        await ensureDirExists(safeDirPath);
        await writeFile(path.join(safeDirPath, safeName), content);
        return { success: true };
    } catch {
        return { success: false, error: "Could not write the attachment to disk." };
    }
}

export async function getImageNative(
    _event: IpcMainInvokeEvent,
    filename: unknown,
    dir: unknown
): Promise<Uint8Array | null> {
    const safeName = safeFilename(filename);
    const safeDirPath = safeDir(dir);
    if (!safeName || !safeDirPath) return null;

    try {
        return await readFile(path.join(safeDirPath, safeName));
    } catch {
        return null;
    }
}

export async function downloadAttachment(
    _event: IpcMainInvokeEvent,
    attachment: unknown,
    dir: unknown
): Promise<DownloadResult> {
    if (!isRecord(attachment)) return { success: false, error: "Invalid attachment." };

    const url = typeof attachment.url === "string" ? attachment.url : "";
    const oldUrl = typeof attachment.oldUrl === "string" ? attachment.oldUrl : undefined;
    const id = typeof attachment.id === "string" ? attachment.id : "";
    const ext = typeof attachment.ext === "string" ? attachment.ext : "";

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { success: false, error: "Invalid attachment URL." };
    }
    if (parsed.protocol !== "https:" || !ATTACHMENT_HOSTS.has(parsed.hostname))
        return { success: false, error: "Attachment host is not allowed." };
    if (!/^\d{15,25}$/.test(id)) return { success: false, error: "Invalid attachment ID." };
    if (!/^[a-z0-9]{1,10}$/.test(ext)) return { success: false, error: "Invalid attachment extension." };

    const safeDirPath = safeDir(dir);
    if (!safeDirPath) return { success: false, error: "Invalid attachment directory." };

    const finalPath = path.join(safeDirPath, `${id}.${ext}`);
    try {
        await ensureDirExists(safeDirPath);
    } catch {
        return { success: false, error: "Could not create the attachment directory." };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(url, { redirect: "follow", signal: controller.signal });
        if (!response.ok || !response.body)
            return { success: false, error: `Attachment is gone or unavailable (HTTP ${response.status}).` };

        // Validate final URL host after redirects
        try {
            const finalUrl = new URL(response.url || url);
            if (finalUrl.protocol !== "https:" || !ATTACHMENT_HOSTS.has(finalUrl.hostname))
                return { success: false, error: "Attachment host is not allowed after redirect." };
        } catch { /* ignore */ }

        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > MAX_ATTACHMENT_BYTES)
            return { success: false, error: "Attachment exceeds the size limit." };

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_ATTACHMENT_BYTES)
            return { success: false, error: "Attachment exceeds the size limit." };

        await writeFile(finalPath, Buffer.from(buffer));
        return { success: true, path: finalPath };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && error.name === "AbortError"
                ? "The attachment download timed out."
                : "Could not download the attachment."
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function pickSavePath(_event: IpcMainInvokeEvent, defaultName: unknown): Promise<string> {
    if (typeof defaultName !== "string" || !/^[a-zA-Z0-9 ._-]{1,128}$/.test(defaultName))
        throw new Error("Invalid default file name.");

    const res = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: "JSON", extensions: ["json"] }]
    });
    const { filePath } = res;
    if (!filePath) throw new Error("No save location selected.");
    return filePath;
}

export async function writeFileAt(_event: IpcMainInvokeEvent, filePath: unknown, contents: unknown): Promise<{ success: boolean; error?: string; }> {
    if (typeof contents !== "string") return { success: false, error: "Invalid log content." };
    if (typeof filePath !== "string" || !filePath.endsWith(".json")) return { success: false, error: "Logs must be saved as .json files." };

    const resolved = safeDir(path.dirname(filePath));
    if (!resolved || !safeFilename(path.basename(filePath))) return { success: false, error: "Invalid save location." };

    try {
        await ensureDirExists(resolved);
        await writeFile(path.join(resolved, path.basename(filePath)), contents, "utf-8");
        return { success: true };
    } catch {
        return { success: false, error: "Could not write the logs to disk." };
    }
}
