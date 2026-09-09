/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Settings, SettingsStore, type ThemeActivationMode } from "@api/Settings";
import { createAndAppendStyle } from "@utils/css";
import { isNonNullish } from "@utils/guards";
import { Logger } from "@utils/Logger";
import { parseThemeIdFromCss, themeFileToId } from "@utils/themeIds";
import { ThemeStore } from "@vencord/discord-types";
import { PopoutWindowStore } from "@webpack/common";

import { coreStyleRootNode, managedStyleRootNode, userStyleRootNode, vencordRootNode } from "./Styles";

let style: HTMLStyleElement;
let themesStyle: HTMLStyleElement;

const themeChangeListeners = new Set<() => void>();

function getThemeActivationMode(themeId: string) {
    return Settings.themeActivationModes?.[themeId] ?? "always";
}

function shouldApplyTheme(mode: ThemeActivationMode, activeTheme?: "light" | "dark") {
    if (mode === "always") return true;
    if (!activeTheme) return false;
    return mode === activeTheme;
}

async function toggle(isEnabled: boolean) {
    if (!style) {
        if (isEnabled) {
            style = createAndAppendStyle("vencord-custom-css", userStyleRootNode);
            VencordNative.quickCss.addChangeListener(css => {
                style.textContent = css;
                // At the time of writing this, changing textContent resets the disabled state
                style.disabled = !Settings.useQuickCss;
                updatePopoutWindows();
            });
            style.textContent = await VencordNative.quickCss.get();
        }
    } else
        style.disabled = !isEnabled;
}

// for cleanup
let previousThemeBlobObjectURLs = [] as string[];

const warnedMissingThemes = new Set<string>();

// Cache for id → fileName resolution
let themeIdToFile = new Map<string, string>();

async function buildThemeIdMap(): Promise<Map<string, string>> {
    if (IS_WEB) return new Map();
    try {
        const list = await VencordNative.themes.getThemesList();
        const m = new Map<string, string>();
        for (const h of list) {
            const id = (h as any).id ?? themeFileToId(h.fileName);
            m.set(id.toLowerCase(), h.fileName);
            m.set(h.fileName.toLowerCase(), h.fileName);
            // also parse css @id to be safe
            try {
                const css = await VencordNative.themes.getThemeData(h.fileName).catch(() => "");
                if (css) {
                    const parsed = parseThemeIdFromCss(css, h.fileName);
                    m.set(parsed.toLowerCase(), h.fileName);
                }
            } catch { }
        }
        themeIdToFile = m;
        return m;
    } catch { return themeIdToFile; }
}

function resolveThemeFile(entry: string, map: Map<string, string>): string {
    const lower = entry.toLowerCase();
    if (map.has(lower)) return map.get(lower)!;
    // entry may be id without extension; try with .css
    if (!lower.endsWith(".css") && map.has(lower + ".css")) return map.get(lower + ".css")!;
    return entry;
}

async function initThemes() {
    themesStyle ??= createAndAppendStyle("vencord-themes", userStyleRootNode);

    const { enabledThemeLinks, enabledThemes } = Settings;

    const { ThemeStore } = require("@webpack/common/stores") as typeof import("@webpack/common/stores");

    // "darker" and "midnight" both count as dark
    // This function is first called on DOMContentLoaded, so ThemeStore may not have been loaded yet
    const activeTheme = ThemeStore == null
        ? undefined
        : ThemeStore.theme === "light" ? "light" : "dark";

    const links = new Set<string>();

    for (const rawLink of enabledThemeLinks) {
        const match = /^@(light|dark) (.*)/.exec(rawLink);
        const link = match?.[2] ?? rawLink;
        const mode = getThemeActivationMode(rawLink);

        if (shouldApplyTheme(mode, activeTheme)) {
            links.add(link);
        }
    }

    // Build id → file map once per init; on web themes are fetched by entry as-is
    const idMap = IS_WEB ? new Map<string, string>() : await buildThemeIdMap();

    if (IS_WEB) {
        previousThemeBlobObjectURLs.forEach(url => URL.revokeObjectURL(url));

        const themesToApply = enabledThemes.filter(theme => {
            const file = resolveThemeFile(theme, idMap);
            return shouldApplyTheme(getThemeActivationMode(theme) ?? getThemeActivationMode(file), activeTheme);
        });

        const objectUrls = await Promise.all(themesToApply.map(async theme => {
            const file = resolveThemeFile(theme, idMap);
            const themeData = await VencordNative.themes.getThemeData(file).catch(() => VencordNative.themes.getThemeData(theme).catch(() => undefined));
            if (!themeData) return null;

            const blob = new Blob([themeData], { type: "text/css" });
            return URL.createObjectURL(blob);
        }));

        previousThemeBlobObjectURLs = objectUrls.filter(isNonNullish);
        previousThemeBlobObjectURLs.forEach(url => links.add(url));
    } else {
        const version = Date.now();
        for (const entry of enabledThemes) {
            const themeFile = resolveThemeFile(entry, idMap);
            const mode = getThemeActivationMode(entry) ?? getThemeActivationMode(themeFile);
            if (!shouldApplyTheme(mode, activeTheme)) continue;
            // A missing file would silently produce a dead @import; surface it instead
            const exists = await VencordNative.themes.getThemeData(themeFile).then(() => true).catch(() => false);
            if (!exists) {
                // try fallback to raw entry
                const fallbackExists = entry !== themeFile ? await VencordNative.themes.getThemeData(entry).then(() => true).catch(() => false) : false;
                if (!fallbackExists) {
                    if (!warnedMissingThemes.has(entry)) {
                        warnedMissingThemes.add(entry);
                        new Logger("Themes").warn(`Enabled theme "${entry}" (resolved "${themeFile}") was not found in the themes folder, skipping`);
                    }
                    continue;
                }
                links.add(`vencord:///themes/${entry}?v=${version}`);
                continue;
            }
            links.add(`vencord:///themes/${themeFile}?v=${version}`);
        }
    }

    themesStyle.textContent = Array.from(links).map(link => `@import url("${link.trim()}");`).join("\n");
    updatePopoutWindows();
    themeChangeListeners.forEach(listener => listener());
}

function applyToPopout(popoutWindow: Window | undefined, key: string) {
    if (!popoutWindow?.document) return;

    const doc = popoutWindow.document;

    doc.querySelector("vencord-root")?.remove();

    const clonedRoot = vencordRootNode.cloneNode(false) as HTMLElement;

    clonedRoot.append(
        coreStyleRootNode.cloneNode(true),
        managedStyleRootNode.cloneNode(true)
    );

    if (key !== "DISCORD_OutOfProcessOverlay") {
        clonedRoot.append(userStyleRootNode.cloneNode(true));
    }

    doc.documentElement.appendChild(clonedRoot);
}

function updatePopoutWindows() {
    if (!PopoutWindowStore) return;

    for (const key of PopoutWindowStore.getWindowKeys()) {
        applyToPopout(PopoutWindowStore.getWindow(key), key);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (IS_USERSCRIPT) return;

    initThemes();

    toggle(Settings.useQuickCss);
    SettingsStore.addChangeListener("useQuickCss", toggle);

    SettingsStore.addChangeListener("enabledThemeLinks", initThemes);
    SettingsStore.addChangeListener("enabledThemes", initThemes);
    SettingsStore.addChangeListener("themeActivationModes", initThemes);

    window.addEventListener("message", event => {
        const { discordPopoutEvent } = event.data || {};
        if (discordPopoutEvent?.type !== "loaded") return;

        applyToPopout(PopoutWindowStore.getWindow(discordPopoutEvent.key), discordPopoutEvent.key);
    });

    if (!IS_WEB) {
        VencordNative.quickCss.addThemeChangeListener(initThemes);
    }
}, { once: true });

export function initQuickCssThemeStore(themeStore: ThemeStore) {
    if (IS_USERSCRIPT) return;

    initThemes();

    let currentTheme = themeStore.theme;
    themeStore.addChangeListener(() => {
        if (currentTheme === themeStore.theme) return;

        currentTheme = themeStore.theme;
        initThemes();
    });
}

export function addThemeChangeListener(listener: () => void) {
    themeChangeListeners.add(listener);
}

export function removeThemeChangeListener(listener: () => void) {
    themeChangeListeners.delete(listener);
}
