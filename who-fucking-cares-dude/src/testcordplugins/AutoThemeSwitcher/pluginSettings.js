/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { onceReady } from "@webpack";
import { ThemeLinksComponent } from "./themeLinksComponent";
import * as themeLister from "./themeLister";
import { timeComponent } from "./timeComponent";
import { ToggledTheme } from "./types";
const themeLists = {
    [ToggledTheme.Light]: [],
    [ToggledTheme.Dark]: [],
};
/**
 * @param theme The ToggledTheme enum that represents changing to a light theme or dark theme
 * @param onChange The onChange method from index.tsx
 * @returns The settings that should be used depending on if the theme is light or dark
 */
function getToggledThemeSettings(theme, onChange) {
    const defaultStartTime = theme === ToggledTheme.Light ? "08:00" : "20:00";
    return {
        themeStartTime: {
            type: 6 /* OptionType.COMPONENT */,
            onChange,
            // TimeComponent is necessary, see TimeComponent.tsx
            component: props => timeComponent(props, theme === ToggledTheme.Light ? "lightThemeStartTime" : "darkThemeStartTime", defaultStartTime, `In HH:MM format. For example: ${defaultStartTime}`)
        },
        theme: {
            description: "",
            type: 4 /* OptionType.SELECT */,
            options: themeLists[theme],
            onChange
        },
        themeURLs: {
            type: 6 /* OptionType.COMPONENT */,
            onChange,
            component: props => ThemeLinksComponent(props, theme === ToggledTheme.Light ? "lightThemeURLS" : "darkThemeURLS", "One per line, HTTP or HTTPS only"),
        },
    };
}
async function initializeListsInThemeSettingsWhenReady() {
    await onceReady;
    Object.entries(themeLists).forEach(([theme, list]) => {
        // we're guaranteed that theme is ToggledTheme because of themeLists's type, silly TypeScript
        const themes = themeLister.getSelectOptions(theme);
        themes.forEach(t => list.push(t));
    });
}
/**
 * @param onChange The onChange method from index.tsx
 * @returns The DefinedSettings, ie the fully configured settings, of the plugin
 */
export function getPluginSettings(onChange) {
    const lightThemeSettings = getToggledThemeSettings(ToggledTheme.Light, onChange);
    const darkThemeSettings = getToggledThemeSettings(ToggledTheme.Dark, onChange);
    const settings = definePluginSettings({
        ChangeBasedOnSystemAppearance: {
            type: 3 /* OptionType.BOOLEAN */,
            description: "Select this to switch between custom light and dark themes based on your system appearance settings rather than the time of day.",
            default: false,
            onChange
        },
        lightThemeStartTime: lightThemeSettings.themeStartTime,
        lightTheme: lightThemeSettings.theme,
        lightThemeURLs: lightThemeSettings.themeURLs,
        darkThemeStartTime: darkThemeSettings.themeStartTime,
        darkTheme: darkThemeSettings.theme,
        darkThemeURLs: darkThemeSettings.themeURLs
    });
    initializeListsInThemeSettingsWhenReady();
    return settings;
}
