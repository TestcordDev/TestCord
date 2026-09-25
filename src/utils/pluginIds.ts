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
            map.set(alias.toLowerCase(), canonical);
        }
        if (plugin.id) {
            map.set(plugin.id.toLowerCase(), canonical);
        }
        // also map lowercase variants to be forgiving
        if (plugin.id && plugin.id !== plugin.name.toLowerCase()) {
            map.set(plugin.name.toLowerCase(), canonical);
        }
    }
    return map;
}

export function resolvePluginId(raw: string, aliasMap: Map<string, string>): string {
    return aliasMap.get(raw) ?? aliasMap.get(raw.toLowerCase()) ?? raw;
}

/**
 * Lookup index for `findPlugin`, cached per registry object.
 *
 * `SettingsStore`'s `getDefaultValue` calls `findPlugin` on every read of a key
 * that isn't materialised in the settings object yet, and nested reads
 * (`plugins.SomePlugin.someObject.leafKey`) never resolve to a plugin, so they
 * miss forever. The previous linear scan walked all ~700 plugins (with two
 * `toLowerCase` allocations and an `aliases.some` per plugin) on every one of
 * those reads. CustomTimestamps hits this 5x per rendered message timestamp,
 * which cost ~600us per read and pinned the main thread at ~550ms per second.
 *
 * The registry is a bundle-time constant, so the index is built once and reused.
 *
 * Exact and case-folded keys are kept in separate maps on purpose. The old scan was
 * plugin-major: for each plugin it tried exact then case-insensitive, returning the
 * first plugin that matched on either. Looking up one merged map would let a later
 * plugin's exact name beat an earlier plugin's case-insensitive match, so the two
 * candidates are compared by registry order instead.
 *
 * Note that in a real build `~plugins` is a Proxy whose `has` trap already answers for
 * every id, name and alias, so the `in` check above short-circuits anything the index
 * could match and the index is only reached on a miss. That is the whole point: the hot
 * path is the miss, and a miss used to walk all ~700 plugins. The index still has to be
 * correct for plain-object registries (tests, settings fixtures, any future registry
 * without that Proxy), which is what the differential test pins down.
 */
interface FindIndex {
    /** exact and case-folded key -> position in `order` */
    exact: Map<string, number>;
    folded: Map<string, number>;
    order: Plugin[];
}

const findIndexCache = new WeakMap<object, FindIndex>();

function buildFindIndex(plugins: Record<string, Plugin>): FindIndex {
    const exact = new Map<string, number>();
    const folded = new Map<string, number>();
    const order: Plugin[] = [];

    for (const p of Object.values(plugins)) {
        const position = order.push(p) - 1;
        const claim = (map: Map<string, number>, key: string | undefined) => {
            if (key !== undefined && !map.has(key)) map.set(key, position);
        };
        for (const key of [p.id, p.name, ...(p.aliases ?? [])]) {
            claim(exact, key);
            claim(folded, key?.toLowerCase());
        }
    }

    return { exact, folded, order };
}

export function findPlugin(idOrName: string, plugins: Record<string, Plugin>): Plugin | undefined {
    if (idOrName in plugins) return plugins[idOrName];

    let index = findIndexCache.get(plugins);
    if (index === undefined) {
        index = buildFindIndex(plugins);
        findIndexCache.set(plugins, index);
    }

    const direct = index.exact.get(idOrName);
    const insensitive = index.folded.get(idOrName.toLowerCase());
    if (direct === undefined) return insensitive === undefined ? undefined : index.order[insensitive];
    if (insensitive === undefined) return index.order[direct];
    return index.order[insensitive < direct ? insensitive : direct];
}
