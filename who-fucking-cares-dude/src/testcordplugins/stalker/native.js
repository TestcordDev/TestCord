/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DATA_DIR } from "@main/utils/constants";
import { shell } from "electron";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
const STALKER_DATA_DIR = path.join(DATA_DIR, "Stalking");
const sanitizeUsername = (username) => username.replace(/[/\\?*|<>:"']/g, "_");
const getTodayFileName = () => `stalker-log-${new Date().toISOString().slice(0, 10)}.json`;
async function getUserStalkerDirPath(userId, username) {
    const safeUsername = sanitizeUsername(username);
    return path.join(STALKER_DATA_DIR, `@${safeUsername}_${userId}`);
}
export async function getUserStalkerDir(_event, userId, username) {
    const userDir = await getUserStalkerDirPath(userId, username);
    await mkdir(userDir, { recursive: true });
    return userDir;
}
export async function writeStalkerLog(_event, contents, userId, username) {
    const userDir = await getUserStalkerDir(_event, userId, username);
    const filePath = path.join(userDir, getTodayFileName());
    await writeFile(filePath, contents, "utf8");
}
export async function readStalkerLog(_event, userId, username) {
    const userDir = await getUserStalkerDirPath(userId, username);
    const filePath = path.join(userDir, getTodayFileName());
    try {
        return await readFile(filePath, "utf8");
    }
    catch {
        return "[]";
    }
}
export async function getStalkerDataDir(_event) {
    return STALKER_DATA_DIR;
}
export async function openStalkerDataDir(_event) {
    await mkdir(STALKER_DATA_DIR, { recursive: true });
    return shell.openPath(STALKER_DATA_DIR);
}
