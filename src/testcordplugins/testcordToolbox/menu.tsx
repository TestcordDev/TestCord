/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openNotificationLogModal } from "@api/Notifications/notificationLog";
import { isPluginEnabled, isSettingDisabled, isSettingHidden, plugins } from "@api/PluginManager";
import { Settings, useSettings } from "@api/Settings";
import { openPluginModal, openSettingsTabModal, PluginsTab, ThemesTab } from "@components/settings";
import type { UserThemeHeader } from "@main/themes";
import { wordsFromCamel, wordsToTitle } from "@utils/text";
import { themeFileToId } from "@utils/themeIds";
import { OptionType, Plugin } from "@utils/types";
import { Menu, showToast, useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { settings } from ".";

let cachedThemes: UserThemeHeader[] = [];
let isFetchingThemes = false;

function getThemesListSync(): UserThemeHeader[] {
    if (typeof VencordNative !== "undefined" && VencordNative.themes?.getThemesList && !isFetchingThemes) {
        isFetchingThemes = true;
        VencordNative.themes.getThemesList().then(t => {
            if (Array.isArray(t)) cachedThemes = t;
            isFetchingThemes = false;
        }).catch(() => {
            isFetchingThemes = false;
        });
    }
    return cachedThemes;
}

if (typeof VencordNative !== "undefined" && VencordNative.themes?.getThemesList) {
    VencordNative.themes.getThemesList().then(t => {
        if (Array.isArray(t)) cachedThemes = t;
    }).catch(() => {});
}

let sortedPluginsCache: Plugin[] | null = null;
let sortedPluginsCacheSize = 0;

function getSortedPlugins(): Plugin[] {
    const size = Object.keys(plugins).length;
    if (!sortedPluginsCache || sortedPluginsCacheSize !== size) {
        sortedPluginsCacheSize = size;
        sortedPluginsCache = Object.values(plugins)
            .filter((p): p is Plugin => !!p && !!p.name)
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    return sortedPluginsCache;
}

function buildPluginMenu(showPluginMenu = true) {
    if (!showPluginMenu) return null;

    return (
        <Menu.MenuItem
            id="plugins"
            label="Plugins"
            action={() => openSettingsTabModal(PluginsTab)}
        >
            {buildPluginMenuEntries()}
        </Menu.MenuItem>
    );
}

export function buildPluginMenuEntries(includeEmpty = false) {
    const pluginSettings = Settings.plugins;

    const candidates = getSortedPlugins()
        .filter(p => isPluginEnabled(p.name) && !p.name.endsWith("API"));

    return (
        <>
            {candidates
                .map(p => {
                    const options = [] as ReactNode[];

                    let hasAnyOption = false;

                    if (p.settings) for (const [key, option] of Object.entries(p.settings.def)) {
                        if (isSettingHidden(p.settings, option)) continue;

                        hasAnyOption = true;

                        const s = pluginSettings[p.name];

                        const baseProps = {
                            id: `${p.name}-${key}`,
                            key: key,
                            label: wordsToTitle(wordsFromCamel(key)),
                            disabled: isSettingDisabled(p.settings, option)
                        };

                        switch (option.type) {
                            case OptionType.BOOLEAN:
                                options.push(
                                    <Menu.MenuCheckboxItem
                                        {...baseProps}
                                        checked={Boolean(s[key])}
                                        action={() => {
                                            s[key] = !s[key];
                                            if (option.restartNeeded) showToast("Restart to apply the change");
                                        }}
                                    />
                                );
                                break;
                            case OptionType.SELECT:
                                options.push(
                                    <Menu.MenuItem {...baseProps}>
                                        {option.options.map(opt => (
                                            <Menu.MenuRadioItem
                                                group={`${p.name}-${key}`}
                                                id={`${p.name}-${key}-${opt.value}`}
                                                key={opt.label}
                                                label={opt.label}
                                                checked={s[key] === opt.value}
                                                action={() => {
                                                    s[key] = opt.value;
                                                    if (option.restartNeeded) showToast("Restart to apply the change");
                                                }}
                                            />
                                        ))}
                                    </Menu.MenuItem>
                                );
                                break;
                            case OptionType.SLIDER:
                                // The menu slider doesn't support these options. Skip to avoid confusion
                                if (option.stickToMarkers || option.componentProps) continue;

                                options.push(
                                    <Menu.MenuControlItem
                                        {...baseProps}
                                        control={(props, ref) => (
                                            <Menu.MenuSliderControl
                                                ref={ref}
                                                {...props}
                                                minValue={option.markers[0]}
                                                maxValue={option.markers.at(-1)!}
                                                value={s[key]}
                                                onChange={v => s[key] = v}
                                            />
                                        )}
                                    />
                                );
                                break;
                        }
                    }

                    const hasVisibleOptions = options.length > 0;
                    const shouldSkip = !hasVisibleOptions && !(includeEmpty && hasAnyOption);
                    if (shouldSkip) return null;

                    return (
                        <Menu.MenuItem
                            id={`${p.name}-menu`}
                            key={p.name}
                            label={p.name}
                            action={() => openPluginModal(p)}
                        >
                            {hasVisibleOptions && (
                                <>
                                    <Menu.MenuGroup label={p.name}>
                                        {options}
                                    </Menu.MenuGroup>

                                    <Menu.MenuSeparator />

                                    <Menu.MenuItem
                                        id={`${p.name}-open`}
                                        label={"Open Settings"}
                                        action={() => openPluginModal(p)}
                                    />
                                </>
                            )}
                        </Menu.MenuItem>
                    );
                })
            }
        </>
    );
}

function buildLiveFixToggle() {
    const helper = Settings.plugins.TestcordHelper;
    if (!helper?.enabled) return null;

    const liveFix = Boolean(helper.liveFix);

    return (
        <Menu.MenuCheckboxItem
            id="livefix-toggle"
            label="LiveFix Debug Server"
            checked={liveFix}
            action={() => {
                Settings.plugins.TestcordHelper.liveFix = !liveFix;
                showToast(!liveFix ? "LiveFix enabled" : "LiveFix disabled");
            }}
        />
    );
}

export function buildThemeMenu(themes?: UserThemeHeader[]) {
    return (
        <Menu.MenuItem
            id="themes"
            label="Themes"
            action={() => openSettingsTabModal(ThemesTab)}
        >
            {buildThemeMenuEntries(themes)}
        </Menu.MenuItem>
    );
}

export function buildThemeMenuEntries(themesList?: UserThemeHeader[]) {
    const { useQuickCss, enabledThemes = [] } = Settings;
    const themes = themesList ?? getThemesListSync();

    return (
        <>
            <Menu.MenuCheckboxItem
                id="toggle-quickcss"
                checked={Boolean(useQuickCss)}
                label="Enable QuickCSS"
                action={() => {
                    Settings.useQuickCss = !useQuickCss;
                }}
            />
            <Menu.MenuItem
                id="edit-quickcss"
                label="Edit QuickCSS"
                action={() => VencordNative.quickCss.openEditor()}
            />
            <Menu.MenuItem
                id="manage-themes"
                label="Manage Themes"
                action={() => openSettingsTabModal(ThemesTab)}
            />
            {!!themes?.length && (
                <Menu.MenuGroup>
                    {themes.map(theme => {
                        const id = (theme.id || themeFileToId(theme.fileName)).toLowerCase();
                        const isChecked = enabledThemes.some(t => {
                            const tl = t.toLowerCase();
                            return tl === id || tl === theme.fileName.toLowerCase();
                        });

                        return (
                            <Menu.MenuCheckboxItem
                                id={`theme-${theme.fileName}`}
                                key={theme.fileName}
                                label={theme.name || theme.fileName}
                                checked={isChecked}
                                action={() => {
                                    if (isChecked) {
                                        Settings.enabledThemes = enabledThemes.filter(t => {
                                            const tl = t.toLowerCase();
                                            return tl !== id && tl !== theme.fileName.toLowerCase();
                                        });
                                    } else {
                                        Settings.enabledThemes = [
                                            ...enabledThemes.filter(t => {
                                                const tl = t.toLowerCase();
                                                return tl !== id && tl !== theme.fileName.toLowerCase();
                                            }),
                                            id
                                        ];
                                    }
                                }}
                            />
                        );
                    })}
                </Menu.MenuGroup>
            )}
        </>
    );
}

function buildCustomPluginEntries() {
    const pluginEntries = [] as { plugin: Plugin, node: ReactNode; }[];

    for (const plugin of Object.values(plugins)) {
        if (plugin.toolboxActions && isPluginEnabled(plugin.name)) {
            const entries = typeof plugin.toolboxActions === "function"
                ? plugin.toolboxActions()
                : Object.entries(plugin.toolboxActions).map(([text, action]) => {
                    const key = `${plugin.name}-${text}`;

                    return (
                        <Menu.MenuItem
                            id={key}
                            key={key}
                            label={text}
                            action={action}
                        />
                    );
                });

            if (!entries || Array.isArray(entries) && entries.length === 0) continue;

            pluginEntries.push({
                plugin,
                node:
                    <Menu.MenuGroup label={plugin.name} key={`${plugin.name}-group`}>
                        {entries}
                    </Menu.MenuGroup>
            });
        }
    }

    // If there aren't too many entries, just put them all in the main menu.
    // Otherwise, add submenus for each plugin
    // FIXME: the Slider component has broken styles that overlap with higher context menus
    // https://discord.com/channels/1015060230222131221/1015063227299811479/1440489344631705693
    if (pluginEntries.length <= 5)
        return pluginEntries.map(e => e.node);

    const submenuEntries = pluginEntries.map(({ node, plugin }) => (
        <Menu.MenuItem
            id={`${plugin.name}-menu`}
            key={`${plugin.name}-menu`}
            label={plugin.name}
            action={() => openPluginModal(plugin)}
        >
            {node}
        </Menu.MenuItem>
    ));

    return <Menu.MenuGroup>{submenuEntries}</Menu.MenuGroup>;
}

export function ToolboxMenu({ onClose }: { onClose: () => void; }) {
    useSettings();
    const { showPluginMenu } = settings.use(["showPluginMenu"]);
    const [themes, setThemes] = useState<UserThemeHeader[]>(() => getThemesListSync());

    useEffect(() => {
        if (typeof VencordNative !== "undefined" && VencordNative.themes?.getThemesList) {
            VencordNative.themes.getThemesList().then(t => {
                if (Array.isArray(t)) {
                    cachedThemes = t;
                    setThemes(t);
                }
            }).catch(() => {});
        }
    }, []);

    return (
        <Menu.Menu
            navId="vc-toolbox"
            onClose={onClose}
        >
            <Menu.MenuItem
                id="notifications"
                label="Open Notification Log"
                action={openNotificationLogModal}
            />

            {buildLiveFixToggle()}

            {buildThemeMenu(themes)}
            {buildPluginMenu(showPluginMenu)}

            {buildCustomPluginEntries()}
        </Menu.Menu>
    );
}

export function renderPopout(onClose: () => void) {
    return <ToolboxMenu onClose={onClose} />;
}
