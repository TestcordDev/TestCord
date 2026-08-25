/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

type DownloadResult = { success: true; path: string; } | { success: false; error: string; };

interface NativeApi {
    getDefaultDirs(): Promise<{ imageCacheDir: string; logsDir: string; }>;
    chooseDir(kind: "logsDir" | "imageCacheDir"): Promise<string>;
    showItemInFolder(targetPath: string): Promise<void>;
    writeImageNative(filename: string, content: Uint8Array, dir: string): Promise<{ success: boolean; error?: string; }>;
    getImageNative(filename: string, dir: string): Promise<Uint8Array | null>;
    downloadAttachment(attachment: { url: string; oldUrl?: string; id: string; ext: string; }, dir: string): Promise<DownloadResult>;
    pickSavePath(defaultName: string): Promise<string>;
    writeFileAt(filePath: string, contents: string): Promise<{ success: boolean; error?: string; }>;
}

const webFallback: NativeApi = {
    async getDefaultDirs() { return { imageCacheDir: "", logsDir: "" }; },
    async chooseDir() { return ""; },
    async showItemInFolder() { },
    async writeImageNative() { return { success: false, error: "web" }; },
    async getImageNative() { return null; },
    async downloadAttachment() { return { success: false, error: "web" }; },
    async pickSavePath() { return ""; },
    async writeFileAt() { return { success: false, error: "web" }; }
};

export const Native: NativeApi = IS_WEB
    ? webFallback
    : VencordNative.pluginHelpers.MessageLoggerTestcord as unknown as PluginNative<typeof import("./native")> & NativeApi;
