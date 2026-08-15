/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Note: Auto-translated

import { app, IpcMainInvokeEvent } from "electron";
import { rm } from "fs/promises";
import { constants as osConstants, setPriority as setOsPriority } from "os";
import { join } from "path";

// Get all Discord process PIDs via Electron app.getAppMetrics().
// Falls back to main process PID if appMetrics fails.
function getAllDiscordPids(): number[] {
    try {
        const pids = app.getAppMetrics()
            .map(m => m.pid)
            .filter((p): p is number => typeof p === "number" && p > 0);
        return pids.length ? Array.from(new Set(pids)) : [process.pid];
    } catch {
        return [process.pid];
    }
}

// Total CPU usage across all Discord processes via Electron app.getAppMetrics().
export function getTotalCpu(_e: IpcMainInvokeEvent): number {
    try {
        let total = 0;
        for (const m of app.getAppMetrics()) total += m.cpu?.percentCPUUsage ?? 0;
        return total;
    } catch {
        return 0;
    }
}

// Lower priority of all Discord processes via os.setPriority (Windows only).
export async function setProcessPriority(_e: IpcMainInvokeEvent, level: "belowNormal" | "normal"): Promise<{ ok: boolean; reason: string; changed: number; }> {
    if (process.platform !== "win32") {
        return { ok: false, reason: "Windows only", changed: 0 };
    }
    const priority = level === "belowNormal"
        ? osConstants.priority.PRIORITY_BELOW_NORMAL
        : osConstants.priority.PRIORITY_NORMAL;

    let changed = 0;
    for (const pid of getAllDiscordPids()) {
        try {
            setOsPriority(pid, priority);
            changed++;
        } catch {
            // Ignore failures for protected processes
        }
    }
    return changed > 0
        ? { ok: true, reason: "", changed }
        : { ok: false, reason: "no processes updated", changed: 0 };
}

// Relaunch Discord via Electron app.relaunch() and app.exit(0).
export function relaunchApp(_e: IpcMainInvokeEvent): void {
    app.relaunch();
    app.exit(0);
}

// Determines Discord app data directory based on executable path.
function getDiscordAppDataPath(appData: string): string {
    try {
        const exe = process.execPath.toLowerCase();
        if (exe.includes("discorddevelopment")) return join(appData, "discorddevelopment");
        if (exe.includes("discordcanary")) return join(appData, "discordcanary");
        if (exe.includes("discordptb")) return join(appData, "discordptb");
    } catch {
        // Fallback to default
    }
    return join(appData, "discord");
}

// Deletes Discord cache folders via fs.
export async function cleanCache(_e: IpcMainInvokeEvent): Promise<{ ok: boolean; cleared: number; }> {
    const appData = process.env.APPDATA; // %AppData% (Windows)
    if (!appData) return { ok: false, cleared: 0 };

    const base = getDiscordAppDataPath(appData);
    const targets = [
        join(base, "Cache"),
        join(base, "Code Cache"),
        join(base, "GPUCache"),
    ];

    let cleared = 0;
    for (const dir of targets) {
        try {
            await rm(dir, { recursive: true, force: true });
            cleared++;
        } catch {
            // Ignore locked/in-use files
        }
    }
    return { ok: cleared > 0, cleared };
}
