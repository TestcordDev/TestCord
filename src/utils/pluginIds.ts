/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Plugin } from "@utils/types";

/**
 * Stable ID helpers.
 *
 * A plugin's stable `id` is its persistent key in `Settings.plugins`.
 * The human-readable `name` may change freely as long as `id` stays
 * constant. If `id` is absent, `name` is used (backwards compat).
 *
 * This module also records known aliases so a plugin that previously
 * shipped without an `id` can be renamed without orphaning existing
 * settings.
 */

export function getPluginId(plugin: { id?: string; name: string; }): string {
    return plugin.id ?? plugin.name;
}

export function getPluginIdByName(name: string, plugins: Record<string, Plugin>): string {
    const p = plugins[name];
    return p ? getPluginId(p) : name;
}

/**
 * Build an alias → canonicalId map from the live plugin registry.
 * Called once at startup before any `isPluginEnabled` checks.
 */
export function buildAliasMap(plugins: Record<string, Plugin>): Map<string, string> {
    const map = new Map<string, string>();
    for (const plugin of Object.values(plugins)) {
        const canonical = getPluginId(plugin);
        // name itself is an alias if it differs from id
        if (plugin.id && plugin.id !== plugin.name) map.set(plugin.name, canonical);
        for (const alias of (plugin as any).aliases ?? []) {
            map.set(alias, canonical);
        }
        // also map lowercase variants to be forgiving
        if (plugin.id && plugin.id !== plugin.name.toLowerCase()) {
            map.set(plugin.name.toLowerCase(), canonical);
        }
    }
    return map;
}

export function resolvePluginId(raw: string, aliasMap: Map<string, string>): string {
    return aliasMap.get(raw) ?? raw;
}
