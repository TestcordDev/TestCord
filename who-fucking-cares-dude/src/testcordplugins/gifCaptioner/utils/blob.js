/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Convert BetterDiscord's getUrl to work with text files
export function getUrl(content) {
    const blob = new Blob([content], { type: "application/javascript" });
    return { url: URL.createObjectURL(blob) };
}
