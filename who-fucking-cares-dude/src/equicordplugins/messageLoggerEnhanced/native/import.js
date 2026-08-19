/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { dialog } from "electron";
const activeFiles = new Map();
export async function startNativeLogImport(_event, defaultPath) {
    const res = await dialog.showOpenDialog({
        title: "Import Logs",
        filters: [{ name: "Logs", extensions: ["json"] }],
        properties: ["openFile"],
        defaultPath
    });
    const [path] = res.filePaths;
    if (!path)
        throw Error("No file selected");
    const fileHandle = await open(path, "r");
    const fileId = randomUUID();
    activeFiles.set(fileId, fileHandle);
    return fileId;
}
export async function readNativeLogChunk(_event, fileId, size = 64 * 1024) {
    const fileHandle = activeFiles.get(fileId);
    if (!fileHandle)
        return null;
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await fileHandle.read(buffer, 0, size);
    if (bytesRead === 0) {
        await fileHandle.close();
        activeFiles.delete(fileId);
        return null;
    }
    return buffer.toString("utf-8", 0, bytesRead);
}
export async function closeNativeLogImport(_event, fileId) {
    const fileHandle = activeFiles.get(fileId);
    if (fileHandle) {
        await fileHandle.close();
        activeFiles.delete(fileId);
    }
}
