/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import definePlugin from "@utils/types";
import { findStore } from "@webpack";
import * as pluginSettings from "./pluginSettings";
import * as themeScheduler from "./themeScheduler";
import * as themeToggler from "./themeToggler";
import { ToggledTheme } from "./types";
// Import settings immediately
const settings = pluginSettings.getPluginSettings(onChange);
let currentTheme = null;
let intervalHandle = null;
let mediaQueryList = null;
let pluginStarted = false;
/**
 * Function that updates the current theme if the plugin has started
 */
function onChange() {
    if (pluginStarted) {
        updateTheme();
    }
}
/**
 * Main function; updates the theme depending on either time of day or system appearance
 * @param isDark The output of the media query, which is the current system theme; true if dark, false if not
 */
function updateTheme(isDark) {
    // If isDark is not provided, check the media query
    if (isDark === undefined && mediaQueryList) {
        isDark = mediaQueryList.matches;
    }
    else if (isDark === undefined) {
        // Fallback if media query is not available
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    // Decide which method to find the expected theme based on the toggle setting
    let expectedTheme;
    if (settings.store.ChangeBasedOnSystemAppearance) {
        // System appearance
        expectedTheme = isDark ? ToggledTheme.Dark : ToggledTheme.Light;
    }
    else {
        // Time of day
        expectedTheme = themeScheduler.getExpectedTheme(settings.store.lightThemeStartTime, settings.store.darkThemeStartTime);
    }
    let discordTheme = expectedTheme === ToggledTheme.Dark ? settings.store.darkTheme : settings.store.lightTheme;
    // Set the theme property if this is the custom Nitro theme
    if (discordTheme === "customnitro") {
        // Get custom theme information from the store
        const customThemeStore = findStore("SavedCustomThemeStore");
        const themeInfo = { theme: "dark", customUserThemeSettings: customThemeStore.getSavedCustomTheme() };
        // Set if the custom theme should be light or dark and return it
        if (expectedTheme === ToggledTheme.Dark) {
            themeInfo.theme = "dark";
            discordTheme = themeInfo;
        }
        else {
            themeInfo.theme = "light";
            discordTheme = themeInfo;
        }
    }
    // Get custom theme URLs
    const customCssURLs = expectedTheme === ToggledTheme.Dark ? settings.store.darkThemeURLs : settings.store.lightThemeURLs;
    themeToggler.changeDiscordTheme(discordTheme);
    if (customCssURLs) {
        themeToggler.changeCustomCssUrls(customCssURLs);
    }
    currentTheme = expectedTheme;
}
/**
 * Function that periodically updates the system theme (when changing is set by time of day)
 * If the current theme is not expected, ie not what the settings are, update it
 */
function periodicThemeUpdateCheck() {
    const expectedTheme = themeScheduler.getExpectedTheme(settings.store.lightThemeStartTime, settings.store.darkThemeStartTime);
    if (expectedTheme !== currentTheme) {
        updateTheme();
    }
}
/**
 * Function that updates the current theme if there is a system appearance change
 * @param event The MediaQueryListEvent that detects if the system is in dark mode or not
 */
function handleSystemThemeChange(event) {
    updateTheme(event.matches);
}
export default definePlugin({
    name: "AutoThemeSwitcher",
    description: "Automatically switches between themes based on the time of day, or based on system appearance (ie. light/dark mode). Now supports custom themes!",
    tags: ["Customisation", "Appearance"],
    authors: [{
            name: "maddie480",
            id: 354341658352943115n
        },
        {
            name: "adorabilis",
            id: 157156034136244224n
        },
        {
            name: "ichi0995",
            id: 176761898581229569n
        }],
    settings,
    startAt: "WebpackReady" /* StartAt.WebpackReady */,
    start() {
        // Start system listeners and periodic checks along with changing the theme
        mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQueryList.addEventListener("change", handleSystemThemeChange);
        intervalHandle = setInterval(periodicThemeUpdateCheck, 60000);
        pluginStarted = true;
    },
    stop() {
        // Clear everything
        if (mediaQueryList !== null) {
            mediaQueryList.removeEventListener("change", handleSystemThemeChange);
            mediaQueryList = null;
        }
        if (intervalHandle !== null) {
            clearInterval(intervalHandle);
            intervalHandle = null;
        }
        currentTheme = null;
        pluginStarted = false;
    },
    flux: {
        CONNECTION_OPEN() {
            updateTheme();
        },
    }
});
