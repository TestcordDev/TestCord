/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { iconsModule } from "@equicordplugins/_core/concatenatedModules";
let iconNames;
export function getDiscordFolderIcon(name) {
    if (!name || !iconsModule)
        return;
    const icon = iconsModule[name];
    return typeof icon === "function" && name.endsWith("Icon") ? icon : undefined;
}
export function getDiscordFolderIconNames() {
    if (iconNames)
        return iconNames;
    if (!iconsModule)
        return [];
    iconNames = Object.keys(iconsModule)
        .filter(name => name.endsWith("Icon") && typeof iconsModule[name] === "function")
        .sort((a, b) => a.localeCompare(b));
    return iconNames;
}
