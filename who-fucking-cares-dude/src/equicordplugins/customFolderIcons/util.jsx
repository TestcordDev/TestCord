/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 sadan
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { settings } from "./settings";
export async function setFolderData(props, newData) {
    if (!settings.store.folderIcons) {
        settings.store.folderIcons = {};
    }
    const folderSettings = settings.store.folderIcons;
    folderSettings[props.folderId] = newData;
}
/**
 * @param rgbVal RGB value
 * @param alpha alpha bewteen zero and 1
*/
export function int2rgba(rgbVal, alpha = 1) {
    const b = rgbVal & 0xFF, g = (rgbVal & 0xFF00) >>> 8, r = (rgbVal & 0xFF0000) >>> 16;
    return `rgba(${[r, g, b].join(",")},${alpha})`;
}
