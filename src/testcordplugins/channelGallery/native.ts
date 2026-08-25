/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { safeFetch } from "@main/utils/safeFetch";
import { dialog, IpcMainInvokeEvent } from "electron";
import { mkdir, writeFile } from "fs/promises";
import { basename, join, normalize } from "path";

const MAX_FILE_BYTES = 500 * 1024 * 1024;

async function readCappedBuffer(response: Response): Promise<Buffer> {
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES) {
        throw new Error("File is too large to download.");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Download returned an empty response.");

    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_FILE_BYTES) {
            await reader.cancel();
            throw new Error("File is too large to download.");
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return Buffer.from(bytes);
}

export async function pickFolder(_: IpcMainInvokeEvent): Promise<string | null> {
    const res = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"]
    });

    return res.canceled ? null : res.filePaths[0] ?? null;
}

export async function downloadToFolder(_: IpcMainInvokeEvent, folder: string, filename: string, url: string): Promise<boolean> {
    folder = normalize(folder);
    filename = basename(normalize(filename));

    if (!folder || !filename) throw new Error("Invalid download target.");
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("Invalid download URL.");

    let bytes: Buffer;
    try {
        const response = await safeFetch(url);
        if (!response.ok) throw new Error(`Download failed with status ${response.status}.`);
        bytes = await readCappedBuffer(response);
    } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Download failed.");
    }

    try {
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, filename), bytes);
    } catch {
        throw new Error("Could not write the file to disk.");
    }
    return true;
}
