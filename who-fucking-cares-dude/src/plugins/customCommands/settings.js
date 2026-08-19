/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { unregisterCommand } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { registerTagCommand } from ".";
import { SettingsTagList } from "./SettingsTagList";
export const settings = definePluginSettings({
    tagsList: {
        type: 7 /* OptionType.CUSTOM */,
        description: "",
        default: {},
    },
    tagComponent: {
        type: 6 /* OptionType.COMPONENT */,
        component: SettingsTagList
    }
});
export function getTags() {
    return Object.values(settings.store.tagsList);
}
export function getTag(name) {
    return settings.store.tagsList[name];
}
export function addTag(tag) {
    unregisterCommand(tag.name);
    settings.store.tagsList[tag.name] = tag;
    registerTagCommand(tag);
}
export function removeTag(name) {
    delete settings.store.tagsList[name];
    unregisterCommand(name);
}
