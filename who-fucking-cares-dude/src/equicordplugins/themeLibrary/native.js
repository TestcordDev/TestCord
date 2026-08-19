/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { THEMES_DIR } from "@main/utils/constants";
import { ensureSafePath } from "@main/utils/ensureSafePath";
import { existsSync, writeFileSync } from "fs";
function getThemePath(theme) {
    if (!theme?.name)
        return null;
    return ensureSafePath(THEMES_DIR, `${theme.name}.theme.css`);
}
export async function themeExists(_, theme) {
    const path = getThemePath(theme);
    return path ? existsSync(path) : false;
}
export async function downloadTheme(_, theme) {
    if (!theme?.content || !theme?.name || !theme?.id)
        return;
    const path = getThemePath(theme);
    if (!path)
        throw new Error("Invalid theme name");
    const download = await fetch(`https://themes.equicord.org/api/download/${encodeURIComponent(theme.id)}`);
    const content = await download.text();
    writeFileSync(path, content);
}
