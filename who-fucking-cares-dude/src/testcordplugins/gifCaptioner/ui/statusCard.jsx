/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { showToast, Toasts } from "@webpack/common";
let failTimer = null;
const FAILURE_TIMEOUT_MS = 60000;
function clearFailTimer() {
    if (!failTimer)
        return;
    clearTimeout(failTimer);
    failTimer = null;
}
function scheduleFailure(ms) {
    clearFailTimer();
    failTimer = setTimeout(() => {
        showToast("GIF processing timed out.", Toasts.Type.FAILURE);
        clearFailTimer();
    }, ms);
}
export function showCreating() {
    showToast("Creating GIF...", Toasts.Type.MESSAGE);
    scheduleFailure(FAILURE_TIMEOUT_MS);
}
export function showUploading() {
    showToast("Uploading GIF...", Toasts.Type.MESSAGE);
    scheduleFailure(FAILURE_TIMEOUT_MS);
}
export function showSent() {
    clearFailTimer();
    showToast("GIF sent.", Toasts.Type.SUCCESS);
}
export function showError(message) {
    clearFailTimer();
    showToast(message || "Failed to create GIF.", Toasts.Type.FAILURE);
}
export function clearStatus() {
    clearFailTimer();
}
