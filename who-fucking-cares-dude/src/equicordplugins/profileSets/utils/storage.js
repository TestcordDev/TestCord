/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { UserStore } from "@webpack/common";
const logger = new Logger("ProfilePresets");
const LEGACY_PRESETS_KEY = "ProfileDataset";
const MAIN_PRESETS_KEY = "ProfilePresets_v2_Main";
const SERVER_PRESETS_KEY = "ProfilePresets_v2_Server";
export let presets = [];
export let currentPresetIndex = -1;
let activeScopeKey = null;
function resetPresets(nextPresets = []) {
    presets = nextPresets;
    currentPresetIndex = -1;
}
function getPresetsKey(section, userId) {
    const baseKey = section === "main" ? MAIN_PRESETS_KEY : SERVER_PRESETS_KEY;
    return `${baseKey}:${userId}`;
}
function getLegacyKey(userId) {
    return `${LEGACY_PRESETS_KEY}:${userId}:main`;
}
export async function loadPresets(section) {
    try {
        const currentUser = UserStore.getCurrentUser();
        const userId = currentUser.id;
        const key = getPresetsKey(section, userId);
        activeScopeKey = key;
        const stored = await DataStore.get(key);
        if (stored && Array.isArray(stored)) {
            resetPresets(stored);
            return;
        }
        if (section === "main") {
            const legacyKey = getLegacyKey(userId);
            const legacyStored = await DataStore.get(legacyKey);
            const legacyBaseStored = await DataStore.get(LEGACY_PRESETS_KEY);
            const legacyToUse = Array.isArray(legacyStored)
                ? legacyStored
                : (Array.isArray(legacyBaseStored) ? legacyBaseStored : null);
            if (legacyToUse) {
                resetPresets(legacyToUse);
                await DataStore.set(key, legacyToUse);
                await DataStore.del(legacyKey);
                await DataStore.del(LEGACY_PRESETS_KEY);
                return;
            }
        }
        resetPresets();
    }
    catch (err) {
        logger.error("Failed to load presets", err);
        resetPresets();
    }
}
export async function savePresetsData(section) {
    try {
        if (!activeScopeKey && !section)
            return;
        const currentUser = UserStore.getCurrentUser();
        const userId = currentUser.id;
        const key = section ? getPresetsKey(section, userId) : activeScopeKey;
        await DataStore.set(key, presets);
    }
    catch (err) {
        logger.error("Failed to save presets", err);
    }
}
export function setCurrentPresetIndex(index) {
    currentPresetIndex = index;
}
export function addPreset(preset) {
    presets.push(preset);
}
export function updatePreset(index, preset) {
    if (index >= 0 && index < presets.length) {
        presets[index] = preset;
    }
}
export function removePreset(index) {
    if (index >= 0 && index < presets.length) {
        presets.splice(index, 1);
        if (currentPresetIndex === index) {
            currentPresetIndex = -1;
        }
        else if (currentPresetIndex > index) {
            currentPresetIndex--;
        }
    }
}
export function movePresetInArray(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= presets.length || toIndex < 0 || toIndex >= presets.length)
        return;
    const [preset] = presets.splice(fromIndex, 1);
    presets.splice(toIndex, 0, preset);
}
export function replaceAllPresets(newPresets) {
    presets = newPresets;
}
