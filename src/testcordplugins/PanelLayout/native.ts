/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type IpcMainInvokeEvent, shell } from "electron";
import { existsSync, mkdirSync } from "fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "fs/promises";
import { basename, join, resolve } from "path";

function getRepoRootDir(): string {
    const candidates = [
        join(__dirname, "../.."),
        join(__dirname, ".."),
        process.cwd()
    ];
    for (const c of candidates) {
        if (existsSync(join(c, "package.json")) && existsSync(join(c, "src"))) {
            return c;
        }
    }
    return ["desktop", "equibop"].includes(basename(__dirname))
        ? join(__dirname, "../..")
        : join(__dirname, "..");
}

function getUserModulesDir(): string {
    const root = getRepoRootDir();
    const primary = join(root, "src", "testcordplugins", "PanelLayout", "usermodules");
    if (!existsSync(primary)) {
        try {
            mkdirSync(primary, { recursive: true });
        } catch { }
    }
    return primary;
}

function sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

function getSafeFilePath(id: string, baseDir: string): string | null {
    const safeId = sanitizeId(id);
    if (!safeId) return null;
    const resolvedPath = resolve(join(baseDir, `${safeId}.json`));
    const normalizedBase = resolve(baseDir);
    if (!resolvedPath.startsWith(normalizedBase)) {
        return null;
    }
    return resolvedPath;
}

export async function saveUserModule(
    _: IpcMainInvokeEvent,
    moduleData: any
): Promise<{ success: boolean; error?: string; }> {
    try {
        if (!moduleData || typeof moduleData !== "object" || !moduleData.id) {
            return { success: false, error: "Invalid module data" };
        }

        const baseDir = getUserModulesDir();
        await mkdir(baseDir, { recursive: true });

        const filePath = getSafeFilePath(String(moduleData.id), baseDir);
        if (!filePath) {
            return { success: false, error: "Invalid module path" };
        }

        const content = JSON.stringify(moduleData, null, 2);
        await writeFile(filePath, content, "utf8");
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || "Failed to save user module file" };
    }
}

export async function deleteUserModule(
    _: IpcMainInvokeEvent,
    id: string
): Promise<{ success: boolean; error?: string; }> {
    try {
        if (typeof id !== "string" || !id.trim()) {
            return { success: false, error: "Invalid module id" };
        }

        const baseDir = getUserModulesDir();
        const filePath = getSafeFilePath(id.trim(), baseDir);
        if (!filePath) {
            return { success: false, error: "Invalid module path" };
        }

        if (existsSync(filePath)) {
            await unlink(filePath);
        }
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || "Failed to delete user module file" };
    }
}

export async function loadUserModules(
    _: IpcMainInvokeEvent
): Promise<{ success: boolean; modules: any[]; error?: string; }> {
    try {
        const baseDir = getUserModulesDir();
        if (!existsSync(baseDir)) {
            return { success: true, modules: [] };
        }

        const files = await readdir(baseDir);
        const modules: any[] = [];

        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const fullPath = join(baseDir, file);
            try {
                const text = await readFile(fullPath, "utf8");
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === "object" && parsed.id) {
                    modules.push(parsed);
                }
            } catch {
                // Ignore corrupt single file
            }
        }

        return { success: true, modules };
    } catch (e: any) {
        return { success: false, modules: [], error: e?.message || "Failed to load user modules from disk" };
    }
}

export async function openUserModulesFolder(
    _: IpcMainInvokeEvent
): Promise<{ success: boolean; error?: string; }> {
    try {
        const baseDir = getUserModulesDir();
        await mkdir(baseDir, { recursive: true });
        await shell.openPath(baseDir);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || "Failed to open user modules folder" };
    }
}
