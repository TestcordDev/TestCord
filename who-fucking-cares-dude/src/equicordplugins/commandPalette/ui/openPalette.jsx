/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import ErrorBoundary from "@components/ErrorBoundary";
import { closeModal, openModal } from "@webpack/common";
import { Palette } from "./Palette";
const SafePalette = ErrorBoundary.wrap(Palette, { noop: true });
let activeKey = null;
export function isPaletteOpen() {
    return activeKey !== null;
}
export function closePalette() {
    if (activeKey) {
        closeModal(activeKey);
        activeKey = null;
    }
}
export function openPalette(initialPage) {
    if (activeKey)
        closePalette();
    const key = openModal(() => <SafePalette onClose={closePalette} initialPage={initialPage}/>, {
        onCloseCallback() {
            if (activeKey === key)
                activeKey = null;
        }
    });
    activeKey = key;
}
export function togglePalette() {
    if (activeKey)
        closePalette();
    else
        openPalette();
}
