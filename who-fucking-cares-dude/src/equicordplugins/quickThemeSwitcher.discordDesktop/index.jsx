/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings, Settings, SettingsStore } from "@api/Settings";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { debounce } from "@shared/debounce";
import { Devs, IS_MAC } from "@utils/constants";
import definePlugin from "@utils/types";
import { showToast, Toasts } from "@webpack/common";
const { VencordNative } = window;
let themeList = [];
let currentIndex = 0;
let fileWatcher = null;
let lastThemeCount = 0;
let skipNextIndexUpdate = false;
const updateCurrentIndex = () => {
    if (skipNextIndexUpdate)
        return skipNextIndexUpdate = false;
    currentIndex = findCurrentThemeIndex();
};
const refreshThemeList = async (silent = false) => {
    const oldTheme = themeList[currentIndex];
    const oldCount = themeList.length;
    themeList = await getAllThemes();
    currentIndex = findCurrentThemeIndex();
    if (oldTheme && themeList[currentIndex]?.id !== oldTheme.id) {
        const newIndex = themeList.findIndex(t => t.id === oldTheme.id && t.type === oldTheme.type);
        if (~newIndex)
            currentIndex = newIndex;
    }
    if (!silent && themeList.length !== oldCount) {
        const diff = themeList.length - oldCount;
        const action = diff > 0 ? "Added" : "Removed";
        const count = Math.abs(diff);
        showToast(`${action} ${count} theme${count > 1 ? "s" : ""}`, Toasts.Type.SUCCESS);
    }
};
const debouncedRefresh = debounce(() => refreshThemeList(), 500);
const settings = definePluginSettings({
    includeLocal: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Include local themes",
        default: true,
        onChange: refreshThemeList,
    },
    includeOnline: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Include online themes",
        default: true,
        onChange: refreshThemeList,
    },
    sortOrder: {
        type: 4 /* OptionType.SELECT */,
        description: "Sort method",
        options: [
            { label: "A-Z", value: "alphabetical", default: true },
            { label: "Z-A", value: "reverse" },
            { label: "Recent", value: "recent" },
        ],
        onChange: refreshThemeList,
    },
    autoRefresh: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Auto-refresh theme list when changes are detected",
        default: true,
    },
    showNotifications: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show notifications when themes are added/removed",
        default: true,
    },
});
async function getAllThemes() {
    const themes = [];
    if (settings.store.includeLocal) {
        const localThemes = await VencordNative.themes.getThemesList();
        localThemes.forEach(({ fileName }) => {
            if (!fileName.endsWith(".css") || fileName === "source.theme.css")
                return;
            themes.push({
                name: Settings.themeNames?.[fileName] ?? fileName.replace(/\.css$/, ""),
                id: fileName,
                type: "local",
            });
        });
    }
    if (settings.store.includeOnline && Settings.themeLinks) {
        Settings.themeLinks.forEach((link) => {
            const cleanLink = link.replace(/^@(?:light|dark)\s+/, "");
            const name = Settings.themeNames?.[cleanLink] ??
                cleanLink
                    .split("/")
                    .pop()
                    ?.replace(/\.css$/, "") ??
                cleanLink;
            themes.push({
                name,
                id: link,
                type: "online",
            });
        });
    }
    const { sortOrder } = settings.store;
    if (sortOrder === "alphabetical") {
        themes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    }
    else if (sortOrder === "reverse") {
        themes.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }));
    }
    return themes;
}
function switchTheme(direction) {
    // empty arrays are truthy so need length to check emptiness
    if (!themeList.length)
        return;
    currentIndex =
        direction === "next"
            ? (currentIndex + 1) % themeList.length
            : (currentIndex - 1 + themeList.length) % themeList.length;
    applyTheme(themeList[currentIndex]);
}
function applyTheme(theme) {
    const isLocal = theme.type === "local";
    Settings.enabledThemes = isLocal ? [theme.id] : [];
    Settings.enabledThemeLinks = isLocal ? [] : [theme.id];
}
function findCurrentThemeIndex() {
    const enabledLocal = Settings.enabledThemes?.[0];
    const enabledOnline = Settings.enabledThemeLinks?.[0];
    const idx = themeList.findIndex(t => (t.type === "local" && t.id === enabledLocal) || (t.type === "online" && t.id === enabledOnline));
    return ~idx ? idx : 0;
}
function toggleCurrentTheme(enable) {
    // empty arrays are truthy so need length to check emptiness
    if (!themeList.length)
        return;
    const theme = themeList[currentIndex];
    const isLocal = theme.type === "local";
    const arr = isLocal ? Settings.enabledThemes : Settings.enabledThemeLinks;
    const isEnabled = arr.includes(theme.id);
    if (enable === isEnabled)
        return;
    skipNextIndexUpdate = true;
    if (isLocal) {
        Settings.enabledThemes = enable ? [...arr, theme.id] : arr.filter((t) => t !== theme.id);
    }
    else {
        Settings.enabledThemeLinks = enable ? [...arr, theme.id] : arr.filter((t) => t !== theme.id);
    }
}
async function reloadThemes() {
    await refreshThemeList(true);
    showToast(`Reloaded ${themeList.length} themes`, Toasts.Type.SUCCESS);
}
async function watchForLocalThemeChanges() {
    if (!settings.store.autoRefresh || !settings.store.includeLocal)
        return;
    const currentThemes = await VencordNative.themes.getThemesList();
    const currentCount = currentThemes.filter((t) => t.fileName.endsWith(".css") && t.fileName !== "source.theme.css").length;
    if (lastThemeCount && currentCount !== lastThemeCount) {
        const diff = currentCount - lastThemeCount;
        await refreshThemeList();
        if (settings.store.showNotifications) {
            const action = diff > 0 ? "Added" : "Removed";
            const count = Math.abs(diff);
            showToast(`${action} ${count} local theme${count > 1 ? "s" : ""}`, Toasts.Type.SUCCESS);
        }
    }
    lastThemeCount = currentCount;
}
const isCtrl = (e) => (IS_MAC ? e.metaKey : e.ctrlKey);
function handleKeyDown(e) {
    // using || because we want to exit if EITHER condition is false (need both ctrl AND shift)
    if (!isCtrl(e) || !e.shiftKey)
        return;
    if (e.altKey) {
        e.preventDefault();
        reloadThemes();
        return;
    }
    const actions = {
        ArrowRight: () => switchTheme("next"),
        ArrowLeft: () => switchTheme("prev"),
        ArrowUp: () => toggleCurrentTheme(true),
        ArrowDown: () => toggleCurrentTheme(false),
    };
    const action = actions[e.key];
    if (!action)
        return;
    e.preventDefault();
    action();
}
const handleThemeLinksChange = () => settings.store.autoRefresh && debouncedRefresh();
const handleThemeNamesChange = () => settings.store.autoRefresh && debouncedRefresh();
export default definePlugin({
    name: "QuickThemeSwitcher",
    description: "Quickly switch between themes using keyboard shortcuts.",
    tags: ["Appearance", "Utility"],
    authors: [Devs.prism],
    settings,
    startAt: "DOMContentLoaded" /* StartAt.DOMContentLoaded */,
    settingsAboutComponent: () => (<>
            <HeadingSecondary>Bindings</HeadingSecondary>
            <Paragraph>
                Use Ctrl/Cmd+Shift+Arrows to navigate (Left/Right: cycle themes, Up: enable, Down: disable).
                <br />
                Press Ctrl/Cmd+Shift+Alt to reload the theme list.
            </Paragraph>
        </>),
    async start() {
        themeList = await getAllThemes();
        currentIndex = findCurrentThemeIndex();
        lastThemeCount = themeList.filter(t => t.type === "local").length;
        document.addEventListener("keydown", handleKeyDown);
        SettingsStore.addChangeListener("themeLinks", handleThemeLinksChange);
        SettingsStore.addChangeListener("themeNames", handleThemeNamesChange);
        SettingsStore.addChangeListener("enabledThemes", updateCurrentIndex);
        SettingsStore.addChangeListener("enabledThemeLinks", updateCurrentIndex);
        if (settings.store.autoRefresh && settings.store.includeLocal) {
            fileWatcher = setInterval(watchForLocalThemeChanges, 2000);
        }
    },
    stop() {
        document.removeEventListener("keydown", handleKeyDown);
        SettingsStore.removeChangeListener("themeLinks", handleThemeLinksChange);
        SettingsStore.removeChangeListener("themeNames", handleThemeNamesChange);
        SettingsStore.removeChangeListener("enabledThemes", updateCurrentIndex);
        SettingsStore.removeChangeListener("enabledThemeLinks", updateCurrentIndex);
        if (fileWatcher) {
            clearInterval(fileWatcher);
            fileWatcher = null;
        }
        themeList = [];
        currentIndex = 0;
        lastThemeCount = 0;
        skipNextIndexUpdate = false;
    },
});
