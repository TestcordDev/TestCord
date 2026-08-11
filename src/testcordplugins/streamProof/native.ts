/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, IpcMainInvokeEvent } from "electron";

function getWin(event: IpcMainInvokeEvent): BrowserWindow | null {
    try {
        return BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    } catch {
        return null;
    }
}

export function setContentProtection(event: IpcMainInvokeEvent, enabled: boolean): boolean {
    try {
        const win = getWin(event);
        if (win) {
            win.setContentProtection(enabled);
            return true;
        }
    } catch (err) {
        console.error("[StreamProof Native] Failed to set content protection:", err);
    }
    return false;
}
