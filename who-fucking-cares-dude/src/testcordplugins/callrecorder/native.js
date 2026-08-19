/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { app } from "electron";
import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, join, normalize } from "path";
export async function readRecording(_, filePath) {
    filePath = normalize(filePath);
    const filename = basename(filePath);
    const discordBaseDir = normalize(app.getPath("userData") + "/");
    if (!/^\d*recording\.ogg$/.test(filename) || !filePath.startsWith(discordBaseDir)) {
        return null;
    }
    try {
        const content = await readFile(filePath);
        return new Uint8Array(content.buffer);
    }
    catch {
        return null;
    }
}
export async function saveRecording(_, fileBuffer, folder, filename) {
    folder = normalize(folder);
    filename = basename(normalize(filename));
    if (!fileBuffer || !folder || !filename) {
        throw new Error("Invalid path");
    }
    const destPath = join(folder, filename);
    await mkdir(folder, { recursive: true });
    await writeFile(destPath, Buffer.from(fileBuffer));
    return destPath;
}
