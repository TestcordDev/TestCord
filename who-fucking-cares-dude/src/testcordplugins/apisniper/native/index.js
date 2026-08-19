/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@main/utils/constants";
import { dialog, shell } from "electron";
const SNIPER_DIR_KEY = "sniperDir";
const SNIPER_SETTINGS_FILE = "apisniper-settings.json";
let sniperDir = null;
function getDefaultSniperDir() {
    return path.join(DATA_DIR, "apisniper-logs");
}
async function getSniperDir() {
    if (!sniperDir) {
        sniperDir = getDefaultSniperDir();
    }
    return sniperDir;
}
async function ensureDirectoryExists(dir) {
    try {
        await mkdir(dir, { recursive: true });
    }
    catch (error) {
        // Directory might already exist or we don't have permissions
    }
}
async function loadSettings() {
    try {
        const settingsPath = path.join(DATA_DIR, SNIPER_SETTINGS_FILE);
        const content = await readFile(settingsPath, "utf-8");
        return JSON.parse(content);
    }
    catch {
        return {};
    }
}
async function saveSettings(settings) {
    try {
        const settingsPath = path.join(DATA_DIR, SNIPER_SETTINGS_FILE);
        await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    }
    catch (error) {
        console.error("Failed to save apisniper settings:", error);
    }
}
export async function init(_event) {
    const settings = await loadSettings();
    if (settings.sniperDir) {
        sniperDir = settings.sniperDir;
    }
}
export async function getSettings(_event) {
    return {
        sniperDir: sniperDir || getDefaultSniperDir(),
    };
}
export async function saveSnipe(_event, filename, content) {
    const dir = await getSniperDir();
    await ensureDirectoryExists(dir);
    // basename strips any directory or traversal component the renderer sent. Callers only
    // ever pass a flat name.
    const filePath = path.join(dir, path.basename(filename));
    await writeFile(filePath, content, "utf-8");
}
export async function chooseDir(event, logKey) {
    const settings = await loadSettings();
    const defaultPath = settings[logKey] || getDefaultSniperDir();
    const res = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        defaultPath,
    });
    const dir = res.filePaths[0];
    if (!dir)
        throw Error("Invalid Directory");
    settings[logKey] = dir;
    sniperDir = dir;
    await saveSettings(settings);
    return dir;
}
export async function clearSniperLogs(_event) {
    const dir = await getSniperDir();
    try {
        const files = await readdir(dir);
        const txtFiles = files.filter(f => f.endsWith(".txt"));
        for (const file of txtFiles) {
            const filePath = path.join(dir, file);
            const fileStat = await stat(filePath);
            if (fileStat.isFile()) {
                await unlink(filePath);
            }
        }
    }
    catch (error) {
        console.error("Failed to clear sniper logs:", error);
    }
}
export async function openSniperFolder(_event) {
    const dir = await getSniperDir();
    await ensureDirectoryExists(dir);
    shell.showItemInFolder(dir);
}
