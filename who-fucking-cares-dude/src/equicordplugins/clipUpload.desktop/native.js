/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DATA_DIR } from "@main/utils/constants";
import { ensureSafePath } from "@main/utils/ensureSafePath";
import { randomUUID } from "crypto";
import { dialog } from "electron";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { basename, extname, join, resolve } from "path";
const pendingTokens = new Map();
const tempEntries = new Map();
const CLIP_UPLOAD_DIR = join(DATA_DIR, "clipUpload");
const ALLOWED_EXTENSIONS = new Set([".mp4", ".m4v"]);
const MAX_CLIP_SIZE = 500 * 1024 * 1024; // 500MB
const MIME_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
};
const CLIP_FOOTER = Buffer.from([
    0x75, 0x75, 0x69, 0x64,
    0xA1, 0xC8, 0x52, 0x99, 0x33, 0x46, 0x4D, 0xB8, 0x88, 0xF0, 0x83, 0xF5, 0x7A, 0x75, 0xA5, 0xEF,
]);
const CLIP_FOOTER_SIZE = CLIP_FOOTER.length;
function getMimeType(filePath) {
    return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
function stripClipFooter(data) {
    const idx = data.indexOf(CLIP_FOOTER);
    return idx === -1 ? data : data.subarray(0, idx);
}
async function parseClipMetadata(filePath) {
    try {
        const buf = await readFile(filePath);
        if (buf.length <= CLIP_FOOTER_SIZE)
            return null;
        const footerIdx = buf.indexOf(CLIP_FOOTER);
        if (footerIdx === -1)
            return null;
        const jsonStr = buf.subarray(footerIdx + CLIP_FOOTER_SIZE).toString("utf-8");
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === "object")
            return Array.isArray(parsed) ? parsed : [parsed];
        return null;
    }
    catch {
        return null;
    }
}
export async function chooseVideoFile(_) {
    try {
        const { filePaths, canceled } = await dialog.showOpenDialog({
            title: "Select clip file",
            filters: [{ name: "MP4 Video", extensions: ["mp4", "m4v"] }],
            properties: ["openFile"],
        });
        if (canceled || filePaths.length === 0)
            return null;
        const resolvedPath = resolve(filePaths[0]);
        if (!ALLOWED_EXTENSIONS.has(extname(resolvedPath).toLowerCase()))
            return null;
        const token = randomUUID();
        pendingTokens.set(token, resolvedPath);
        return { token, name: basename(resolvedPath), type: getMimeType(resolvedPath) };
    }
    catch {
        return null;
    }
}
export async function createTempVideoFile(_, token) {
    const originalPath = pendingTokens.get(token);
    if (!originalPath)
        return null;
    pendingTokens.delete(token);
    try {
        const tmpDir = join(CLIP_UPLOAD_DIR, randomUUID());
        const tmpPath = join(tmpDir, basename(originalPath));
        if (!ensureSafePath(tmpDir, basename(originalPath)))
            return null;
        await mkdir(tmpDir, { recursive: true });
        await writeFile(tmpPath, stripClipFooter(await readFile(originalPath)));
        const tmpToken = randomUUID();
        tempEntries.set(tmpToken, { tmpDir, tmpPath });
        return tmpToken;
    }
    catch {
        return null;
    }
}
export async function createTempVideoFileFromBytes(_, name, data) {
    if (typeof name !== "string" || !(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_CLIP_SIZE)
        return null;
    const fileName = basename(name);
    if (fileName !== name || !ALLOWED_EXTENSIONS.has(extname(fileName).toLowerCase()))
        return null;
    try {
        const tmpDir = join(CLIP_UPLOAD_DIR, randomUUID());
        const tmpPath = join(tmpDir, fileName);
        if (!ensureSafePath(tmpDir, fileName))
            return null;
        await mkdir(tmpDir, { recursive: true });
        await writeFile(tmpPath, data);
        const tmpToken = randomUUID();
        tempEntries.set(tmpToken, { tmpDir, tmpPath });
        return tmpToken;
    }
    catch {
        return null;
    }
}
// Note: Exposing the absolute path to the renderer is unavoidable here.
// Discord's MediaEngineStore is a renderer-only module, and its
// updateClipMetadata method requires an absolute filesystem path.
export function getTempVideoFilePath(_, token) {
    return tempEntries.get(token)?.tmpPath ?? null;
}
export async function readVideoFile(_, token) {
    const entry = tempEntries.get(token);
    if (!entry)
        return null;
    try {
        const buf = await readFile(entry.tmpPath);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    catch {
        return null;
    }
}
export async function deleteTempVideoFile(_, token) {
    const entry = tempEntries.get(token);
    if (!entry)
        return;
    tempEntries.delete(token);
    if (!ensureSafePath(CLIP_UPLOAD_DIR, entry.tmpDir))
        return;
    try {
        await rm(entry.tmpDir, { force: true, recursive: true });
    }
    catch { }
}
export async function parseClipFileMetadata(_, token) {
    const originalPath = pendingTokens.get(token);
    if (!originalPath)
        return null;
    return parseClipMetadata(originalPath);
}
