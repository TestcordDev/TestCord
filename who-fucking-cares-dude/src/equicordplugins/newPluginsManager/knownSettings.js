/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import plugins from "~plugins";
export const KNOWN_PLUGINS_LEGACY_DATA_KEY = "NewPluginsManager_KnownPlugins";
export const KNOWN_SETTINGS_DATA_KEY = "NewPluginsManager_KnownSettings";
function getSettingsSetForPlugin(plugin) {
    const settings = plugins[plugin]?.settings?.def || {};
    return new Set(Object.keys(settings).filter(setting => setting !== "enabled"));
}
function getCurrentSettings(pluginList) {
    return new Map(pluginList.map(name => [
        name,
        getSettingsSetForPlugin(name)
    ]));
}
export async function getKnownSettings() {
    const raw = await DataStore.get(KNOWN_SETTINGS_DATA_KEY);
    let map;
    if (!raw) {
        const knownPlugins = await DataStore.get(KNOWN_PLUGINS_LEGACY_DATA_KEY) ?? [];
        const Plugins = [...Object.keys(plugins), ...knownPlugins];
        map = getCurrentSettings(Plugins);
        await DataStore.set(KNOWN_SETTINGS_DATA_KEY, [...map.entries()].map(([plugin, settings]) => [plugin, [...settings]]));
    }
    else if (raw instanceof Map) {
        map = new Map([...raw.entries()].map(([k, v]) => [k, new Set(v)]));
    }
    else if (Array.isArray(raw)) {
        map = new Map(raw.map(([plugin, settings]) => [plugin, new Set(settings)]));
    }
    else if (typeof raw === "object") {
        map = new Map(Object.entries(raw).map(([plugin, settings]) => [
            plugin,
            new Set(Array.isArray(settings) || settings instanceof Set ? settings : [])
        ]));
    }
    else {
        map = new Map();
    }
    return map;
}
export async function getNewSettings() {
    const map = getCurrentSettings(Object.keys(plugins));
    const knownSettings = await getKnownSettings();
    map.forEach((settings, plugin) => {
        const filteredSettings = [...settings].filter(setting => !knownSettings.get(plugin)?.has(setting));
        if (!filteredSettings.length)
            return map.delete(plugin);
        map.set(plugin, new Set(filteredSettings));
    });
    return map;
}
export async function getKnownPlugins() {
    const knownSettings = await getKnownSettings();
    return new Set(knownSettings.keys());
}
export async function getNewPlugins() {
    const currentPlugins = Object.keys(plugins);
    const knownPlugins = await getKnownPlugins();
    return new Set(currentPlugins.filter(p => !knownPlugins.has(p)));
}
export async function writeKnownSettings() {
    const currentSettings = getCurrentSettings(Object.keys(plugins));
    const knownSettings = await getKnownSettings();
    const allSettings = new Map();
    new Set([...currentSettings.keys(), ...knownSettings.keys()]).forEach(plugin => {
        allSettings.set(plugin, new Set([
            ...(currentSettings.get(plugin) || []),
            ...(knownSettings.get(plugin) || [])
        ]));
    });
    await DataStore.set(KNOWN_SETTINGS_DATA_KEY, [...allSettings.entries()].map(([plugin, settings]) => [plugin, [...settings]]));
}
export async function debugWipeSomeData() {
    const settings = await getKnownSettings();
    settings.forEach((value, key) => {
        if (Math.random() > 0.8) {
            if (Math.random() > 0.5)
                return settings.set(key, new Set([...value].filter(() => Math.random() > 0.5)));
            return settings.delete(key);
        }
    });
    await DataStore.set(KNOWN_SETTINGS_DATA_KEY, [...settings.entries()].map(([plugin, set]) => [plugin, [...set]]));
}
export async function editRawData(patcher) {
    if (!patcher)
        return;
    const map = await getKnownSettings();
    const newMap = new Map(map);
    await patcher(newMap);
    const resultMap = newMap ?? map;
    await DataStore.set(KNOWN_SETTINGS_DATA_KEY, [...resultMap.entries()].map(([plugin, set]) => [plugin, [...set]]));
}
