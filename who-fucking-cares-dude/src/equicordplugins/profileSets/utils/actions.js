/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { isNonNullish } from "@utils/guards";
import { showToast, Toasts, UserProfileSettingsStore } from "@webpack/common";
import { getCurrentProfile } from "./profile";
import { addPreset, movePresetInArray, presets, removePreset, replaceAllPresets, savePresetsData, updatePreset } from "./storage";
function isImageInput(value) {
    if (typeof value === "string")
        return value.length > 0;
    return typeof value === "object" && isNonNullish(value) && "imageUri" in value && typeof value.imageUri === "string";
}
function getFreshPendingAvatar(section, guildId) {
    const pending = (section === "server" && guildId
        ? UserProfileSettingsStore.getPendingChanges?.(guildId)
        : UserProfileSettingsStore.getPendingChanges?.()) ?? {};
    const pendingObj = pending;
    const selected = [pendingObj.pendingAvatar].find(isImageInput);
    if (!selected)
        return null;
    return typeof selected === "string" ? selected : selected.imageUri;
}
export async function savePreset(name, section, guildId) {
    const profile = await getCurrentProfile(guildId, { isGuildProfile: section === "server" });
    const freshPendingAvatar = getFreshPendingAvatar(section, guildId);
    const effectiveAvatar = freshPendingAvatar ?? profile.avatarDataUrl ?? null;
    const newPreset = {
        name,
        timestamp: Date.now(),
        ...profile,
        avatarDataUrl: effectiveAvatar,
    };
    addPreset(newPreset);
    await savePresetsData(section);
}
export async function updatePresetField(index, field, value, section, guildId) {
    if (index < 0 || index >= presets.length)
        return;
    void guildId;
    const updatedPreset = {
        ...presets[index],
        [field]: value,
        timestamp: Date.now()
    };
    updatePreset(index, updatedPreset);
    await savePresetsData(section);
}
export async function deletePreset(index, section, guildId) {
    if (index < 0 || index >= presets.length)
        return;
    removePreset(index);
    await savePresetsData(section);
}
export async function movePreset(fromIndex, toIndex, section, guildId) {
    if (fromIndex < 0 || fromIndex >= presets.length || toIndex < 0 || toIndex >= presets.length)
        return;
    movePresetInArray(fromIndex, toIndex);
    await savePresetsData(section);
}
export async function renamePreset(index, newName, section, guildId) {
    if (index < 0 || index >= presets.length || !newName.trim())
        return;
    const updatedPreset = { ...presets[index], name: newName.trim() };
    updatePreset(index, updatedPreset);
    await savePresetsData(section);
}
export function exportPresets(section) {
    const dataStr = JSON.stringify(presets, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `profile-presets-${section}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
}
export async function importPresets(forceUpdate, onImportPrompt, section, guildId) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async (event) => {
        try {
            const target = event.currentTarget;
            const file = target?.files?.[0];
            if (!file)
                return;
            const text = await file.text();
            const importedPresets = JSON.parse(text);
            if (!Array.isArray(importedPresets)) {
                return;
            }
            if (presets.length > 0) {
                const decision = await onImportPrompt(presets.length);
                if (decision === "cancel")
                    return;
                if (decision === "override") {
                    replaceAllPresets(importedPresets);
                }
                else {
                    const combined = [...presets, ...importedPresets];
                    replaceAllPresets(combined);
                }
            }
            else {
                replaceAllPresets(importedPresets);
            }
            await savePresetsData(section);
            forceUpdate();
        }
        catch {
            showToast("Failed to import presets. The file might be invalid.", Toasts.Type.FAILURE);
        }
    };
    input.click();
}
