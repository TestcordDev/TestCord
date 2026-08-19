/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
export const logger = new Logger("SongSpotlight");
export const cl = classNameFactory("vc-songspotlight-");
export function formatDurationMs(duration) {
    const seconds = Math.floor(duration / 1000);
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export function formatCoverTooltip(song, render) {
    if (["user", "artist"].includes(song.type)) {
        // "Jane Remover's Top tracks"
        return `${render.label}'s ${render.sublabel}`;
    }
    else {
        // "Star people by Jane Remover"
        return `${render.label} by ${render.sublabel}`;
    }
}
