/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Note: Auto-translated

import { plugins } from "@api/PluginManager";
import { Settings } from "@api/Settings";

// Essential plugins that are never disabled
const TESTCORD_ESSENTIALS = ["PerformanceBoost"];

/** Determines if a plugin is essential and should not be disabled in performance mode. */
export function isEssentialPlugin(name: string): boolean {
    const p = (plugins as Record<string, { required?: boolean; isDependency?: boolean; }>)[name];
    return !!(p?.required || p?.isDependency) || TESTCORD_ESSENTIALS.includes(name);
}

/** Returns all togglable (non-essential) plugin names. */
export function togglablePlugins(): string[] {
    return Object.keys(plugins).filter(n => !isEssentialPlugin(n)).sort((a, b) => a.localeCompare(b));
}

/** Returns currently enabled togglable plugins. */
export function enabledTogglablePlugins(): string[] {
    return togglablePlugins().filter(n => Settings.plugins[n]?.enabled);
}

/** Parses comma-separated keep list. */
export function parseKeep(raw: string): string[] {
    return (raw || "").split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * Enters performance mode: disables non-essential plugins except exceptions, returns previously enabled list.
 */
export function enterPerformanceMode(keep: string[]): string[] {
    const keepSet = new Set(keep);
    const wasEnabled: string[] = [];
    for (const name of Object.keys(plugins)) {
        if (isEssentialPlugin(name)) continue;
        const s = Settings.plugins[name];
        if (!s) continue;
        if (s.enabled) wasEnabled.push(name);
        if (keepSet.has(name)) continue;
        s.enabled = false;
    }
    return wasEnabled;
}

/** Exits performance mode: re-enables previously saved plugins. */
export function exitPerformanceMode(saved: string[]): void {
    for (const name of saved) {
        const s = Settings.plugins[name];
        if (s) s.enabled = true;
    }
}
