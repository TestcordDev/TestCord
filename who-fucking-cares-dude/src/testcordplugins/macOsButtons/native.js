/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BrowserWindow } from "electron";
function getWin(event) {
    // Get the window that sent the IPC event
    return BrowserWindow.fromWebContents(event.sender);
}
export function closeWindow(event) {
    getWin(event)?.close();
}
export function minimizeWindow(event) {
    getWin(event)?.minimize();
}
export function maximizeWindow(event) {
    const win = getWin(event);
    if (!win)
        return;
    if (win.isMaximized())
        win.unmaximize();
    else
        win.maximize();
}
export function isMaximized(event) {
    return getWin(event)?.isMaximized() ?? false;
}
