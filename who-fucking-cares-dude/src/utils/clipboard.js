/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function copyToClipboard(text) {
    return IS_DISCORD_DESKTOP ? DiscordNative.clipboard.copy(text) : navigator.clipboard.writeText(text);
}
export function readClipboard() {
    return IS_DISCORD_DESKTOP ? DiscordNative.clipboard.read() : navigator.clipboard.readText();
}
