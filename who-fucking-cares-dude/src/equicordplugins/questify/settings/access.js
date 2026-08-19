/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Settings, useSettings } from "@api/Settings";
import { UserStore } from "@webpack/common";
export const QUESTIFY_PLUGIN_NAME = "Questify";
export function getQuestifySettings() {
    return Settings.plugins[QUESTIFY_PLUGIN_NAME];
}
export function useQuestifySettings(keys) {
    return useSettings(keys.map(key => `plugins.${QUESTIFY_PLUGIN_NAME}.${key}`)).plugins[QUESTIFY_PLUGIN_NAME];
}
export function getCurrentUserId(userId) {
    return userId ?? UserStore.getCurrentUser()?.id ?? null;
}
