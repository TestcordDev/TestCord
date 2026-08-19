/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
import { PlainSettings, Settings, SettingsStore } from "@api/Settings";
import { debounce } from "@shared/debounce";
import plugins from "~plugins";
// Presets live in their own native file at the shared (prod-level) dir so they
// persist across build flags (dev/prod/standalone), unlike settings.json which is
// per-build. We mirror the file in an in-memory cache: hydrate once via
// loadPresets(), every mutator writes the cache then persists it to disk.
let cache = {};
let hydrated = false;
const store = () => cache;
const persist = () => { VencordNative.presets.set(cache); };
// ponytail: 500ms debounce, fine for a settings file — coalesces bursts of changes.
const persistDebounced = debounce(persist, 500);
// Global restore-on-apply default. A UI preference, so the per-build renderer
// Settings is fine (only the presets themselves needed to be build-independent).
// Defaults to on: a preset is expected to bring back the settings it saved.
export const getRestoreDefault = () => Settings.presetsRestoreDefault !== false;
export const setRestoreDefault = (v) => { Settings.presetsRestoreDefault = v; };
// Global force-apply default. Off by default: it disables plugins missing from
// the preset, which is only what you want when the preset is the source of truth.
export const getForceApplyDefault = () => Settings.presetsForceApplyDefault === true;
export const setForceApplyDefault = (v) => { Settings.presetsForceApplyDefault = v; };
// UI preference: hide the per-row Duplicate button. Renderer Settings is fine
// (cosmetic, doesn't need to be build-independent like the presets themselves).
export const getHideDuplicate = () => Boolean(Settings.presetsHideDuplicate);
export const setHideDuplicate = (v) => { Settings.presetsHideDuplicate = v; };
// Animation preferences. A master switch plus one flag per animated component.
// All default ON (undefined -> true) so existing behavior is preserved until the
// user opts out. Stored in renderer Settings (cosmetic, per-build is fine).
export const ANIM_KEYS = ["rowHover", "tabUnderline", "badgePulse", "fadeIn", "buttons", "gear", "jsonHover"];
export const ANIM_LABELS = {
    rowHover: { title: "Preset row hover", description: "The accent rail that slides in and the card lift when hovering a preset." },
    tabUnderline: { title: "Tab underline slide", description: "The sliding underline under the active tab in the preset modal." },
    badgePulse: { title: "Live badge pulse", description: "The pulsing dot on the 'live' badge." },
    fadeIn: { title: "Panel & row fade-ins", description: "Fade-in when switching modal tabs and when the Duplicate row appears/disappears." },
    buttons: { title: "Button hover & press", description: "Lift, glow and press-scale on all buttons." },
    gear: { title: "Gear icon rotate", description: "The settings gear rotating on hover." },
    jsonHover: { title: "JSON box hover", description: "The border/background highlight on the JSON editor box." },
};
// undefined (unset) = on. Only an explicit false disables.
export const getAnimMaster = () => Settings.presetsAnimMaster !== false;
export const setAnimMaster = (v) => { Settings.presetsAnimMaster = v; };
export const getAnim = (key) => Settings[`presetsAnim_${key}`] !== false;
export const setAnim = (key, v) => { Settings[`presetsAnim_${key}`] = v; };
// PlainSettings.plugins only contains keys that were written or read through the
// Settings proxy; settings still sitting at their declared default may be absent.
// Touch every registered plugin's settings once so the snapshot below is complete.
function materializePluginSettings() {
    for (const [name, plugin] of Object.entries(plugins)) {
        const store = Settings.plugins[name];
        if (!plugin.settings?.def)
            continue;
        for (const key of Object.keys(plugin.settings.def))
            void store[key];
    }
}
function snapshotPlugins() {
    materializePluginSettings();
    return structuredClone(PlainSettings.plugins);
}
// Live-backup engine: one global listener. Any preset flagged liveBackup re-snapshots
// itself whenever a plugin is toggled or a plugin setting changes, so it mirrors "now."
let liveBackupRegistered = false;
function ensureLiveBackup() {
    if (liveBackupRegistered)
        return;
    liveBackupRegistered = true;
    SettingsStore.addGlobalChangeListener((_, path) => {
        if (!path.startsWith("plugins."))
            return;
        let dirty = false;
        for (const p of Object.values(cache)) {
            if (p.liveBackup) {
                p.plugins = snapshotPlugins();
                dirty = true;
            }
        }
        if (dirty)
            persistDebounced();
    });
}
/**
 * Load presets from the native file into the cache (called once on tab mount).
 * One-shot migration: if the shared file is empty but the old per-build
 * Settings.presets has data, carry it over so existing presets aren't stranded.
 * ponytail: migration guard, drop it once everyone's presets have moved.
 */
export async function loadPresets() {
    if (hydrated)
        return;
    cache = (await VencordNative.presets.get()) ?? {};
    const legacy = Settings.presets;
    if (Object.keys(cache).length === 0 && legacy && Object.keys(legacy).length > 0) {
        cache = structuredClone(legacy);
        persist();
    }
    hydrated = true;
    ensureLiveBackup();
}
export function setPresetRestore(name, value) {
    const p = store()[name];
    if (!p)
        return;
    if (value === undefined)
        delete p.restoreSettings;
    else
        p.restoreSettings = value;
    persist();
}
export function setPresetForceApply(name, value) {
    const p = store()[name];
    if (!p)
        return;
    if (value === undefined)
        delete p.forceApply;
    else
        p.forceApply = value;
    persist();
}
export function setPresetLiveBackup(name, value) {
    const p = store()[name];
    if (!p)
        return;
    p.liveBackup = value;
    // Snapshot immediately on enable so it starts in sync, not stale.
    if (value)
        p.plugins = snapshotPlugins();
    persist();
}
export function listPresets() {
    return Object.values(store()).sort((a, b) => {
        const aOrdered = typeof a.order === "number";
        const bOrdered = typeof b.order === "number";
        if (aOrdered && bOrdered)
            return a.order - b.order;
        if (aOrdered !== bOrdered)
            return aOrdered ? -1 : 1;
        return b.createdAt - a.createdAt;
    });
}
export function hasPreset(name) {
    return name in store();
}
/**
 * Snapshot the current config into a named preset (overwrites same name).
 * `scope` selects what to capture; defaults to plugins-only for back-compat.
 * Async because themes/QuickCSS/DataStore reads cross the native bridge.
 */
export async function savePreset(name, createdAt, scope = ["plugins"]) {
    const existing = store()[name];
    const ordered = listPresets().filter(p => typeof p.order === "number");
    const order = existing?.order ?? (ordered.length ? Math.min(...ordered.map(p => p.order)) - 1 : undefined);
    const preset = { name, createdAt, plugins: {}, scope: [...scope] };
    if (order !== undefined)
        preset.order = order;
    // Overwriting keeps the preset's configured behavior; only the captured data refreshes.
    if (existing?.restoreSettings !== undefined)
        preset.restoreSettings = existing.restoreSettings;
    if (existing?.forceApply !== undefined)
        preset.forceApply = existing.forceApply;
    if (existing?.liveBackup)
        preset.liveBackup = true;
    if (scope.includes("plugins")) {
        // Deep-clone via PlainSettings so the stored preset doesn't alias the live proxy.
        preset.plugins = snapshotPlugins();
    }
    if (scope.includes("themes")) {
        preset.themes = [...(Settings.enabledThemes ?? [])];
        const themes = await VencordNative.themes.getThemesList().catch(() => []);
        const contentByName = new Map(themes.map(theme => [theme.fileName, theme.content]));
        preset.themeFiles = Object.fromEntries(preset.themes
            .map(fileName => [fileName, contentByName.get(fileName)])
            .filter((entry) => typeof entry[1] === "string"));
    }
    if (scope.includes("quickCss")) {
        preset.quickCss = await VencordNative.quickCss.get().catch(() => "");
    }
    if (scope.includes("dataStore")) {
        const entries = await DataStore.entries().catch(() => []);
        preset.dataStore = Object.fromEntries(entries.map(([k, v]) => [String(k), v]));
    }
    store()[name] = preset;
    persist();
}
export function deletePreset(name) {
    delete store()[name];
    persist();
}
export function renamePreset(from, to) {
    const s = store();
    if (!s[from] || from === to || s[to])
        return;
    s[to] = { ...s[from], name: to };
    delete s[from];
    persist();
}
export function duplicatePreset(name, copyName, createdAt) {
    const s = store();
    const src = s[name];
    if (!src)
        return;
    // structuredClone the whole preset so themes/quickCss/dataStore copy too.
    s[copyName] = { ...structuredClone(src), name: copyName, createdAt };
    delete s[copyName].liveBackup; // a copy shouldn't inherit live-tracking
    // Sit the copy right next to its source once manual ordering exists, instead
    // of dropping it into the unordered (bottom) bucket.
    if (listPresets().some(p => typeof p.order === "number")) {
        const list = listPresets();
        const [copy] = list.splice(list.findIndex(p => p.name === copyName), 1);
        list.splice(list.findIndex(p => p.name === name) + 1, 0, copy);
        for (const [index, preset] of list.entries())
            s[preset.name].order = index;
    }
    persist();
}
export function reorderPresets(sourceName, targetName, position) {
    if (sourceName === targetName)
        return false;
    const ordered = listPresets();
    const sourceIndex = ordered.findIndex(p => p.name === sourceName);
    const targetIndex = ordered.findIndex(p => p.name === targetName);
    if (sourceIndex === -1 || targetIndex === -1)
        return false;
    const [source] = ordered.splice(sourceIndex, 1);
    const nextTargetIndex = ordered.findIndex(p => p.name === targetName);
    ordered.splice(position === "before" ? nextTargetIndex : nextTargetIndex + 1, 0, source);
    const currentNames = listPresets().map(p => p.name).join("\n");
    const nextNames = ordered.map(p => p.name).join("\n");
    if (currentNames === nextNames)
        return false;
    for (const [index, preset] of ordered.entries()) {
        store()[preset.name].order = index;
    }
    // Drag reorders fire per row crossing; coalesce the disk writes into one.
    persistDebounced();
    return true;
}
// Sort object keys recursively so key insertion order (which depends on when
// defaults were materialized) can't make equal values compare unequal.
function normalizeForCompare(value) {
    if (typeof value === "bigint")
        return value.toString();
    if (Array.isArray(value))
        return value.map(normalizeForCompare);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .map(([key, v]) => [key, normalizeForCompare(v)])
            .sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
}
function sameValue(a, b) {
    try {
        return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
    }
    catch {
        return Object.is(a, b);
    }
}
function pluginSettings(plugin) {
    const { enabled: _, ...settings } = plugin;
    return settings;
}
function addScope(preset, key) {
    const next = new Set(presetScope(preset));
    next.add(key);
    preset.scope = [...next];
}
function enabledThemeFiles(preset) {
    const enabled = new Set(preset.themes ?? []);
    return Object.fromEntries(Object.entries(preset.themeFiles ?? {}).filter(([fileName]) => enabled.has(fileName)));
}
function comparablePreset(preset) {
    const scope = presetScope(preset);
    return {
        scope: [...scope].sort(),
        plugins: scope.includes("plugins") ? preset.plugins : {},
        themes: scope.includes("themes") ? [...(preset.themes ?? [])].sort() : undefined,
        themeFiles: scope.includes("themes") ? Object.fromEntries(Object.entries(enabledThemeFiles(preset)).sort(([a], [b]) => a.localeCompare(b))) : undefined,
        quickCss: scope.includes("quickCss") ? preset.quickCss ?? "" : undefined,
        dataStore: scope.includes("dataStore") ? preset.dataStore ?? {} : undefined,
        restoreSettings: preset.restoreSettings,
        forceApply: preset.forceApply,
    };
}
export function arePresetsIdentical(sourceName, targetName) {
    const source = store()[sourceName];
    const target = store()[targetName];
    if (!source || !target || sourceName === targetName)
        return false;
    return sameValue(comparablePreset(source), comparablePreset(target));
}
export function getMergePlan(sourceName, targetName) {
    const source = store()[sourceName];
    const target = store()[targetName];
    if (!source || !target || sourceName === targetName)
        return null;
    const additions = [];
    const overlaps = [];
    const conflicts = [];
    const sourceScope = presetScope(source);
    for (const [pluginName, sourcePlugin] of sourceScope.includes("plugins") ? Object.entries(source.plugins) : []) {
        const targetPlugin = target.plugins[pluginName];
        if (!targetPlugin) {
            additions.push(`Plugin: ${pluginName}`);
            continue;
        }
        if (sameValue(sourcePlugin, targetPlugin)) {
            overlaps.push(`Plugin already identical: ${pluginName}`);
            continue;
        }
        const bothEnabled = sourcePlugin.enabled && targetPlugin.enabled;
        const settingsDiffer = !sameValue(pluginSettings(sourcePlugin), pluginSettings(targetPlugin));
        conflicts.push({
            id: `plugin:${pluginName}`,
            kind: "plugin",
            label: pluginName,
            description: bothEnabled && settingsDiffer
                ? "Both presets enable this plugin with different settings. Choose the settings to keep, or disable it in the merged preset."
                : "Both presets include this plugin differently. Choose which version should win.",
            options: [
                { value: "target", label: `Keep ${target.name}` },
                { value: "source", label: `Use ${source.name}` },
                { value: "disable", label: "Disable in merged preset" },
                { value: "remove", label: "Remove from merged preset" },
            ],
            defaultAction: "target",
        });
    }
    const sourceThemeFiles = enabledThemeFiles(source);
    const targetThemeFiles = enabledThemeFiles(target);
    const sourceEnabledThemes = (source.themes ?? []).filter(theme => sourceThemeFiles[theme] !== undefined);
    const targetThemes = new Set(Object.keys(targetThemeFiles));
    const targetThemeCodeEntries = Object.entries(targetThemeFiles);
    for (const theme of sourceScope.includes("themes") ? sourceEnabledThemes : []) {
        const sourceContent = sourceThemeFiles[theme];
        if (targetThemes.has(theme)) {
            if (sourceContent !== undefined && targetThemeFiles[theme] !== undefined && sourceContent === targetThemeFiles[theme]) {
                overlaps.push(`Theme already identical: ${theme}`);
                continue;
            }
            conflicts.push({
                id: `theme:${theme}`,
                kind: "theme",
                label: theme,
                description: sourceContent !== undefined && targetThemeFiles[theme] !== undefined
                    ? "Both presets include this theme filename, but the saved CSS is different. Choose which theme code to keep, or remove it from the merged preset."
                    : "Both presets include this enabled theme. Keep it once, or remove it from the merged preset.",
                options: [
                    { value: "keep", label: `Keep ${target.name}` },
                    ...(sourceContent !== undefined ? [{ value: "source", label: `Use ${source.name}` }] : []),
                    { value: "remove", label: "Remove theme" },
                ],
                defaultAction: "keep",
            });
        }
        else if (sourceContent !== undefined) {
            const sameCodeTheme = targetThemeCodeEntries.find(([targetTheme, targetContent]) => targetTheme !== theme && targetContent === sourceContent)?.[0];
            if (sameCodeTheme) {
                conflicts.push({
                    id: `theme:${theme}`,
                    kind: "theme",
                    label: theme,
                    description: `This theme has the same saved CSS as ${sameCodeTheme}. Add it anyway, or skip it to avoid a duplicate theme file.`,
                    options: [
                        { value: "source", label: `Add ${theme}` },
                        { value: "remove", label: "Skip duplicate code" },
                    ],
                    defaultAction: "remove",
                });
            }
            else {
                additions.push(`Theme: ${theme}`);
            }
        }
        else {
            additions.push(`Theme: ${theme}`);
        }
    }
    if (sourceScope.includes("quickCss") && source.quickCss !== undefined) {
        if (target.quickCss === undefined || target.quickCss.length === 0)
            additions.push("QuickCSS");
        else if (source.quickCss === target.quickCss)
            overlaps.push("QuickCSS already identical");
        else
            conflicts.push({
                id: "quickCss",
                kind: "quickCss",
                label: "QuickCSS",
                description: "Both presets contain QuickCSS. Choose which stylesheet should be saved, append the source, or clear it.",
                options: [
                    { value: "target", label: `Keep ${target.name}` },
                    { value: "source", label: `Use ${source.name}` },
                    { value: "append", label: "Append source after target" },
                    { value: "remove", label: "Clear QuickCSS" },
                ],
                defaultAction: "target",
            });
    }
    const targetDataStore = target.dataStore ?? {};
    for (const [key, value] of sourceScope.includes("dataStore") ? Object.entries(source.dataStore ?? {}) : []) {
        if (!(key in targetDataStore)) {
            additions.push(`DataStore: ${key}`);
            continue;
        }
        if (sameValue(value, targetDataStore[key])) {
            overlaps.push(`DataStore already identical: ${key}`);
            continue;
        }
        conflicts.push({
            id: `dataStore:${key}`,
            kind: "dataStore",
            label: key,
            description: "Both presets contain this DataStore key with different values. Choose which value to keep, or delete it from the merged preset.",
            options: [
                { value: "target", label: `Keep ${target.name}` },
                { value: "source", label: `Use ${source.name}` },
                { value: "remove", label: "Delete key" },
            ],
            defaultAction: "target",
        });
    }
    return { source, target, additions, overlaps, conflicts, identical: arePresetsIdentical(sourceName, targetName) };
}
export function mergePresets(sourceName, targetName, decisions, options) {
    const source = store()[sourceName];
    const target = store()[targetName];
    const outputName = options.outputName.trim();
    if (!source || !target || sourceName === targetName || !outputName || outputName in store())
        return null;
    const merged = structuredClone(target);
    const sourceScope = presetScope(source);
    for (const [pluginName, sourcePlugin] of sourceScope.includes("plugins") ? Object.entries(source.plugins) : []) {
        const id = `plugin:${pluginName}`;
        if (!(pluginName in merged.plugins)) {
            merged.plugins[pluginName] = structuredClone(sourcePlugin);
            continue;
        }
        switch (decisions[id] ?? "target") {
            case "source":
                merged.plugins[pluginName] = structuredClone(sourcePlugin);
                break;
            case "disable":
                merged.plugins[pluginName].enabled = false;
                break;
            case "remove":
                delete merged.plugins[pluginName];
                break;
        }
    }
    if (sourceScope.includes("plugins"))
        addScope(merged, "plugins");
    if (sourceScope.includes("themes") && source.themes) {
        const sourceThemeFiles = enabledThemeFiles(source);
        const sourceEnabledThemes = source.themes.filter(theme => sourceThemeFiles[theme] !== undefined);
        merged.themeFiles = enabledThemeFiles(merged);
        const themes = new Set(Object.keys(merged.themeFiles));
        for (const theme of sourceEnabledThemes) {
            const action = decisions[`theme:${theme}`] ?? (!themes.has(theme) ? "source" : "keep");
            if (action !== "remove")
                themes.add(theme);
            if (action === "source" && sourceThemeFiles[theme] !== undefined)
                merged.themeFiles[theme] = sourceThemeFiles[theme];
        }
        for (const theme of sourceEnabledThemes) {
            if ((decisions[`theme:${theme}`] ?? "keep") === "remove")
                themes.delete(theme);
        }
        merged.themes = [...themes];
        if (Object.keys(merged.themeFiles).length === 0)
            delete merged.themeFiles;
        addScope(merged, "themes");
    }
    if (sourceScope.includes("quickCss") && source.quickCss !== undefined) {
        switch (decisions.quickCss ?? (merged.quickCss === undefined ? "source" : "target")) {
            case "source":
                merged.quickCss = source.quickCss;
                break;
            case "append":
                merged.quickCss = `${merged.quickCss ?? ""}${merged.quickCss ? "\n\n" : ""}${source.quickCss}`;
                break;
            case "remove":
                delete merged.quickCss;
                merged.scope = presetScope(merged).filter(s => s !== "quickCss");
                break;
        }
        if (merged.quickCss !== undefined)
            addScope(merged, "quickCss");
    }
    if (sourceScope.includes("dataStore") && source.dataStore) {
        merged.dataStore = { ...(merged.dataStore ?? {}) };
        for (const [key, value] of Object.entries(source.dataStore)) {
            switch (decisions[`dataStore:${key}`] ?? (!(key in merged.dataStore) ? "source" : "target")) {
                case "source":
                    merged.dataStore[key] = structuredClone(value);
                    break;
                case "remove":
                    delete merged.dataStore[key];
                    break;
            }
        }
        if (Object.keys(merged.dataStore).length)
            addScope(merged, "dataStore");
        else {
            delete merged.dataStore;
            merged.scope = presetScope(merged).filter(s => s !== "dataStore");
        }
    }
    merged.name = outputName;
    merged.createdAt = Date.now();
    const ordered = listPresets().filter(p => typeof p.order === "number");
    if (ordered.length)
        merged.order = Math.min(...ordered.map(p => p.order)) - 1;
    else
        delete merged.order;
    delete merged.liveBackup;
    store()[outputName] = merged;
    if (options.deleteSource)
        delete store()[sourceName];
    if (options.deleteTarget)
        delete store()[targetName];
    persist();
    return outputName;
}
/** Which scopes a preset captured; legacy presets (no scope) are plugins-only. */
export function presetScope(preset) {
    return preset.scope ?? ["plugins"];
}
/**
 * Apply a preset back onto live config. Restores every scope the preset captured:
 * - plugins: always writes `enabled`; if `restoreSettings` or `forceApply`, the full
 *   settings slice. `forceApply` also disables every plugin the preset doesn't
 *   mention, making the preset the source of truth.
 * - themes: enables stored theme names; missing local files are recreated when
 *   the preset contains saved CSS in `themeFiles`.
 * - quickCss / dataStore: overwrites wholesale.
 * Async because themes/QuickCSS/DataStore reads/writes cross the native bridge.
 */
export async function applyPreset(name, restoreSettings, forceApply = false) {
    const preset = store()[name];
    if (!preset)
        return { changed: false, missingThemes: [] };
    const scope = presetScope(preset);
    let changed = false;
    const missingThemes = [];
    if (scope.includes("plugins")) {
        if (forceApply) {
            for (const plugin of Object.keys(PlainSettings.plugins)) {
                if (!(plugin in preset.plugins))
                    (Settings.plugins[plugin] ??= { enabled: false }).enabled = false;
            }
        }
        for (const [plugin, saved] of Object.entries(preset.plugins)) {
            const current = (Settings.plugins[plugin] ??= { enabled: false });
            if (restoreSettings || forceApply)
                Settings.plugins[plugin] = structuredClone(saved);
            else
                current.enabled = saved.enabled;
        }
        changed = true;
    }
    if (scope.includes("themes") && preset.themes) {
        const list = await VencordNative.themes.getThemesList().catch(() => []);
        const present = new Set(list.map(t => t.fileName));
        const toEnable = [];
        for (const themeName of preset.themes) {
            if (!present.has(themeName) && preset.themeFiles?.[themeName] !== undefined) {
                await VencordNative.themes.uploadTheme(themeName, preset.themeFiles[themeName]).then(() => present.add(themeName)).catch(() => { });
            }
            if (present.has(themeName))
                toEnable.push(themeName);
            else
                missingThemes.push(themeName);
        }
        Settings.enabledThemes = toEnable;
        changed = true;
    }
    if (scope.includes("quickCss") && preset.quickCss !== undefined) {
        await VencordNative.quickCss.set(preset.quickCss).catch(() => { });
        changed = true;
    }
    if (scope.includes("dataStore") && preset.dataStore) {
        for (const [k, v] of Object.entries(preset.dataStore)) {
            await DataStore.set(k, v).catch(() => { });
        }
        changed = true;
    }
    return { changed, missingThemes };
}
// BigInt settings values would make JSON.stringify throw; stringify them as strings.
const stringifyReplacer = (_, value) => typeof value === "bigint" ? value.toString() : value;
export function stringifyPreset(value, space) {
    return JSON.stringify(value, stringifyReplacer, space);
}
/** Serialize one preset to a shareable string. */
export function exportPreset(name) {
    const preset = store()[name];
    if (!preset)
        return null;
    return stringifyPreset(preset, 4);
}
/** Serialize every preset to one blob (Export all). */
export function exportAllPresets() {
    return stringifyPreset(store(), 4);
}
export function getPreset(name) {
    return store()[name];
}
/** Shape check shared by import + manual edit. Returns the parsed preset or null. */
export function validatePreset(obj) {
    if (!obj || typeof obj.name !== "string" || !obj.name || typeof obj.plugins !== "object" || !obj.plugins) {
        return null;
    }
    return obj;
}
/** Coerce an arbitrary parsed object into a clean Preset (drops junk fields). */
function sanitize(parsed, name) {
    const clean = {
        name,
        createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
        plugins: parsed.plugins && typeof parsed.plugins === "object" ? structuredClone(parsed.plugins) : {},
    };
    if (typeof parsed.order === "number")
        clean.order = parsed.order;
    if (Array.isArray(parsed.themes))
        clean.themes = parsed.themes.filter((t) => typeof t === "string");
    if (parsed.themeFiles && typeof parsed.themeFiles === "object") {
        clean.themeFiles = Object.fromEntries(Object.entries(parsed.themeFiles).filter((entry) => typeof entry[0] === "string" && typeof entry[1] === "string"));
    }
    if (typeof parsed.quickCss === "string")
        clean.quickCss = parsed.quickCss;
    if (parsed.dataStore && typeof parsed.dataStore === "object")
        clean.dataStore = structuredClone(parsed.dataStore);
    if (Array.isArray(parsed.scope)) {
        const valid = parsed.scope.filter((s) => ["plugins", "themes", "quickCss", "dataStore"].includes(s));
        if (valid.length)
            clean.scope = valid;
    }
    if (typeof parsed.restoreSettings === "boolean")
        clean.restoreSettings = parsed.restoreSettings;
    if (typeof parsed.forceApply === "boolean")
        clean.forceApply = parsed.forceApply;
    if (parsed.liveBackup === true)
        clean.liveBackup = true;
    return clean;
}
/**
 * Store an already-parsed preset object. Returns the stored name, or null if the
 * object is malformed. Without an overrideName, an existing name is suffixed
 * " (imported)"; an overrideName is used verbatim (and overwrites a clash).
 */
export function importPresetObject(parsed, overrideName) {
    const valid = validatePreset(parsed);
    if (!valid)
        return null;
    const s = store();
    let name = overrideName?.trim() || valid.name;
    if (!overrideName && name in s)
        name = `${name} (imported)`;
    s[name] = sanitize(valid, name);
    persist();
    return name;
}
/** Parse a shared preset string and store it. Returns the stored name, or null. */
export function importPreset(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    return importPresetObject(parsed);
}
/**
 * Replace a preset from hand-edited JSON. Validates on save. If the edited JSON's
 * name differs: moves to the new key unless it's already taken (then returns null).
 * Returns the stored name, or null on parse/validation/name-clash failure.
 */
export function updatePresetRaw(original, raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    const valid = validatePreset(parsed);
    if (!valid)
        return null;
    const s = store();
    const newName = valid.name;
    if (newName !== original && newName in s)
        return null; // refuse to clobber a different preset
    if (newName !== original)
        delete s[original];
    s[newName] = sanitize(valid, newName);
    persist();
    return newName;
}
