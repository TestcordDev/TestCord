/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SETTINGS_DIR } from "@main/utils/constants";
import { shell } from "electron";
const RULES_FILE = "hyprtiles.rules.json5";
export async function readRulesFile(_, defaultContents) {
    await mkdir(SETTINGS_DIR, { recursive: true });
    const filePath = path.join(SETTINGS_DIR, RULES_FILE);
    try {
        const contents = await readFile(filePath, "utf-8");
        return { filePath, contents };
    }
    catch (error) {
        if (error?.code !== "ENOENT")
            throw error;
        await writeFile(filePath, defaultContents, "utf-8");
        return { filePath, contents: defaultContents };
    }
}
export async function openRulesFile(_, defaultContents) {
    const { filePath } = await readRulesFile(_, defaultContents);
    await shell.openPath(filePath);
    return { filePath };
}
