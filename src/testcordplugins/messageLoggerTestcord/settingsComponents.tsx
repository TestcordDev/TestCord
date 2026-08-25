/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Button, showToast, Toasts } from "@webpack/common";

import { getAllLogs } from "./db";
import { Native } from "./nativeShim";
import { settings } from "./settings";

export function ChooseDirButton({ dirKind, label }: { dirKind: "imageCacheDir" | "logsDir"; label: string; }) {
    return (
        <Button
            onClick={async () => {
                try {
                    const dir = await Native.chooseDir(dirKind);
                    if (dir) {
                        settings.store[dirKind] = dir;
                        showToast(`${label} set to ${dir}`, Toasts.Type.SUCCESS);
                    }
                } catch (e) {
                    if (e instanceof Error && e.message !== "No directory selected.")
                        showToast(e.message, Toasts.Type.FAILURE);
                }
            }}
        >
            Choose folder...
        </Button>
    );
}

export function OpenAttachmentsFolderButton() {
    const disabled = IS_WEB || !settings.store.imageCacheDir;
    return (
        <Button
            disabled={disabled}
            onClick={() => void Native.showItemInFolder(settings.store.imageCacheDir)}
        >
            Open saved attachments folder
        </Button>
    );
}

export function SaveLogsBackupButton() {
    return (
        <Button
            disabled={IS_WEB}
            onClick={async () => {
                try {
                    const logs = await getAllLogs();
                    const date = new Date().toISOString().slice(0, 10);
                    const filePath = await Native.pickSavePath(`message-logger-testcord-${date}.json`);
                    if (!filePath) return;
                    const result = await Native.writeFileAt(filePath, JSON.stringify({
                        format: "MessageLoggerTestcord",
                        version: 1,
                        exportedAt: new Date().toISOString(),
                        messages: logs
                    }));
                    if (result.success) showToast(`Saved ${logs.length} logs to disk.`, Toasts.Type.SUCCESS);
                    else showToast(result.error ?? "Failed to save logs.", Toasts.Type.FAILURE);
                } catch (e) {
                    if (e instanceof Error && e.message !== "No save location selected.")
                        showToast(e.message, Toasts.Type.FAILURE);
                }
            }}
        >
            Save logs backup to disk...
        </Button>
    );
}

export const SafeChooseImageCacheDir = ErrorBoundary.wrap(() => <ChooseDirButton dirKind="imageCacheDir" label="Attachment folder" />, { noop: true });
export const SafeChooseLogsDir = ErrorBoundary.wrap(() => <ChooseDirButton dirKind="logsDir" label="Logs folder" />, { noop: true });
export const SafeOpenAttachmentsFolder = ErrorBoundary.wrap(OpenAttachmentsFolderButton, { noop: true });
export const SafeSaveLogsBackup = ErrorBoundary.wrap(SaveLogsBackupButton, { noop: true });
