/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ponytail: standalone self-check for preset apply logic. Stubs the Settings
// proxy (real one needs the Discord runtime) and re-implements the two functions
// whose logic can break: apply with/without restoreSettings. Run: node presets.selfcheck.mjs
// Mirrors presets.ts:applyPreset — if you change that, change this.

import assert from "node:assert";

function applyPreset(Settings, preset, restoreSettings) {
    for (const [plugin, saved] of Object.entries(preset.plugins)) {
        const current = (Settings.plugins[plugin] ??= { enabled: false });
        if (restoreSettings) Settings.plugins[plugin] = structuredClone(saved);
        else current.enabled = saved.enabled;
    }
}

const preset = {
    name: "streaming",
    plugins: {
        A: { enabled: true, volume: 100 },
        B: { enabled: false, color: "red" },
    },
};

// Case 1: restoreSettings=false — only enabled flips, tuned settings untouched.
let Settings = { plugins: { A: { enabled: false, volume: 11 }, B: { enabled: true, color: "blue" } } };
applyPreset(Settings, preset, false);
assert.strictEqual(Settings.plugins.A.enabled, true, "A enabled should flip on");
assert.strictEqual(Settings.plugins.B.enabled, false, "B enabled should flip off");
assert.strictEqual(Settings.plugins.A.volume, 11, "A.volume must be preserved (not clobbered)");
assert.strictEqual(Settings.plugins.B.color, "blue", "B.color must be preserved (not clobbered)");

// Case 2: restoreSettings=true — full slice overwrites tuned settings.
Settings = { plugins: { A: { enabled: false, volume: 11 } } };
applyPreset(Settings, preset, true);
assert.strictEqual(Settings.plugins.A.volume, 100, "A.volume must be overwritten to preset value");
assert.strictEqual(Settings.plugins.B.color, "red", "B must be created from preset");

// Case 3: stored slice must not alias live settings (clone on write).
Settings.plugins.A.volume = 999;
assert.strictEqual(preset.plugins.A.volume, 100, "preset must not alias live settings");

// Case 4: plugin present in settings but absent from preset is left alone.
Settings = { plugins: { A: { enabled: false }, Untouched: { enabled: true } } };
applyPreset(Settings, preset, false);
assert.strictEqual(Settings.plugins.Untouched.enabled, true, "plugins not in preset are untouched");

// Case 5: restore-override resolution — preset value wins when set, global when undefined.
const resolve = (presetVal, global) => presetVal ?? global;
assert.strictEqual(resolve(undefined, true), true, "undefined override follows global=on");
assert.strictEqual(resolve(undefined, false), false, "undefined override follows global=off");
assert.strictEqual(resolve(false, true), false, "override=off wins over global=on");
assert.strictEqual(resolve(true, false), true, "override=on wins over global=off");

// Case 6: live-backup snapshot replaces plugins with a clone of current (no aliasing).
const live = { name: "backup", liveBackup: true, plugins: { A: { enabled: false } } };
const currentPlugins = { A: { enabled: true, volume: 50 }, B: { enabled: true } };
live.plugins = structuredClone(currentPlugins);
currentPlugins.A.volume = 999;
assert.strictEqual(live.plugins.A.volume, 50, "live snapshot must clone, not alias current");
assert.strictEqual(live.plugins.B.enabled, true, "live snapshot captures all current plugins");

// Case 7: validatePreset — mirrors presets.ts:validatePreset. Reject junk, accept valid.
const validatePreset = obj =>
    (!obj || typeof obj.name !== "string" || !obj.name || typeof obj.plugins !== "object" || !obj.plugins) ? null : obj;
assert.strictEqual(validatePreset(null), null, "null rejected");
assert.strictEqual(validatePreset({ plugins: {} }), null, "missing name rejected");
assert.strictEqual(validatePreset({ name: "" }), null, "empty name rejected");
assert.strictEqual(validatePreset({ name: "x" }), null, "missing plugins rejected");
assert.strictEqual(validatePreset({ name: "x", plugins: "nope" }), null, "non-object plugins rejected");
assert.ok(validatePreset({ name: "x", plugins: {} }), "minimal valid accepted");
assert.ok(validatePreset({ name: "x", plugins: { A: { enabled: true } }, liveBackup: true }), "full preset accepted");

// Case 8: updatePresetRaw rename — to a free name moves it; to a taken name is refused.
function updatePresetRaw(s, original, raw) {
    let parsed; try { parsed = JSON.parse(raw); } catch { return null; }
    if (!validatePreset(parsed)) return null;
    const newName = parsed.name;
    if (newName !== original && newName in s) return null;
    if (newName !== original) delete s[original];
    s[newName] = { name: newName, createdAt: 0, plugins: structuredClone(parsed.plugins) };
    return newName;
}
const bank = { a: { name: "a", plugins: {} }, b: { name: "b", plugins: {} } };
assert.strictEqual(updatePresetRaw(bank, "a", '{"name":"b","plugins":{}}'), null, "rename onto existing is refused");
assert.ok(bank.a, "refused rename leaves original intact");
assert.strictEqual(updatePresetRaw(bank, "a", '{"name":"c","plugins":{}}'), "c", "rename to free name succeeds");
assert.ok(!bank.a && bank.c, "renamed key moved");
assert.strictEqual(updatePresetRaw(bank, "c", "{ bad json"), null, "malformed JSON refused");

console.log("presets self-check OK");
