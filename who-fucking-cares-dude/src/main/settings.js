/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { SettingsStore } from "@shared/SettingsStore";
import { mergeDefaults } from "@utils/mergeDefaults";
import { ipcMain } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { NATIVE_SETTINGS_FILE, PRESETS_FILE, SETTINGS_DIR, SETTINGS_FILE } from "./utils/constants";
mkdirSync(SETTINGS_DIR, { recursive: true });
function readSettings(name, file) {
    try {
        return JSON.parse(readFileSync(file, "utf-8"));
    }
    catch (err) {
        if (err?.code !== "ENOENT")
            console.error(`Failed to read ${name} settings`, err);
        return {};
    }
}
export const RendererSettings = new SettingsStore(readSettings("renderer", SETTINGS_FILE));
RendererSettings.addGlobalChangeListener(() => {
    try {
        writeFileSync(SETTINGS_FILE, JSON.stringify(RendererSettings.plain, null, 4));
    }
    catch (e) {
        console.error("Failed to write renderer settings", e);
    }
});
ipcMain.handle("VencordGetSettingsDir" /* IpcEvents.GET_SETTINGS_DIR */, () => SETTINGS_DIR);
ipcMain.on("VencordGetSettings" /* IpcEvents.GET_SETTINGS */, e => e.returnValue = RendererSettings.plain);
ipcMain.handle("VencordSetSettings" /* IpcEvents.SET_SETTINGS */, (_, data, pathToNotify) => {
    RendererSettings.setData(data, pathToNotify);
});
// Presets live in their own file at the shared (prod-level) dir so they persist
// across build flags, instead of being trapped in the per-build settings.json.
ipcMain.handle("VencordGetPresets" /* IpcEvents.GET_PRESETS */, () => readSettings("presets", PRESETS_FILE));
ipcMain.handle("VencordSetPresets" /* IpcEvents.SET_PRESETS */, (_, data) => {
    try {
        // A BigInt plugin setting would make JSON.stringify throw and silently drop
        // the whole write; store it as its string form instead.
        writeFileSync(PRESETS_FILE, JSON.stringify(data, (_, v) => typeof v === "bigint" ? v.toString() : v, 4));
    }
    catch (e) {
        console.error("Failed to write presets", e);
    }
});
const DefaultNativeSettings = {
    plugins: {},
    customCspRules: {}
};
const nativeSettings = readSettings("native", NATIVE_SETTINGS_FILE);
mergeDefaults(nativeSettings, DefaultNativeSettings);
export const NativeSettings = new SettingsStore(nativeSettings);
NativeSettings.addGlobalChangeListener(() => {
    try {
        writeFileSync(NATIVE_SETTINGS_FILE, JSON.stringify(NativeSettings.plain, null, 4));
    }
    catch (e) {
        console.error("Failed to write native settings", e);
    }
});
