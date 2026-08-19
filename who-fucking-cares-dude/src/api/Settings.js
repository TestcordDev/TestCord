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
import { SettingsStore as SettingsStoreClass } from "@shared/SettingsStore";
import { Logger } from "@utils/Logger";
import { mergeDefaults } from "@utils/mergeDefaults";
import { React, useEffect } from "@webpack/common";
import plugins from "~plugins";
const logger = new Logger("Settings");
const DefaultSettings = {
    autoUpdate: true,
    autoUpdateNotification: true,
    updaterBranch: "main",
    useQuickCss: true,
    useTestcordIcon: false,
    hideThemeMarketplace: false,
    hideSnippetMarketplace: false,
    themeLinks: [],
    eagerPatches: false, // Eagerly patching no longer works due to module factories with the same id being able to have different sources now.
    enabledThemes: [],
    enabledThemeLinks: [],
    enableOnlineThemes: true,
    pinnedThemes: [],
    themeNames: {},
    themeActivationModes: {},
    enableReactDevtools: false,
    mainWindowFrameless: false,
    frameless: false,
    transparent: false,
    winCtrlQ: false,
    macosVibrancyStyle: undefined,
    windowsMaterial: "none",
    disableMinSize: false,
    winNativeTitleBar: false,
    plugins: {},
    uiElements: {
        chatBarButtons: {},
        messagePopoverButtons: {}
    },
    notifications: {
        timeout: 5000,
        position: "bottom-right",
        useNative: "not-focused",
        missed: true,
        logLimit: 50
    },
    cloud: {
        authenticated: false,
        url: "https://cloud.equicord.org/",
        settingsSync: false,
        settingsSyncVersion: 0
    },
    ignoreResetWarning: false,
    experimentalDataStoreExport: false,
};
const settings = !IS_REPORTER ? VencordNative.settings.get() : {};
mergeDefaults(settings, DefaultSettings);
export const SettingsStore = new SettingsStoreClass(settings, {
    readOnly: true,
    getDefaultValue({ target, key, path }) {
        const v = target[key];
        if (!plugins)
            return v; // plugins not initialised yet. this means this path was reached by being called on the top level
        if (path === "plugins" && key in plugins)
            return target[key] = {
                enabled: IS_REPORTER || plugins[key].required || plugins[key].enabledByDefault || false
            };
        // Since the property is not set, check if this is a plugin's setting and if so, try to resolve
        // the default value.
        if (path.startsWith("plugins.")) {
            const plugin = path.slice("plugins.".length);
            if (plugin in plugins) {
                const setting = plugins[plugin].settings?.def[key];
                if (!setting)
                    return v;
                if ("default" in setting)
                    // normal setting with a default value
                    return (target[key] = setting.default);
                if (setting.type === 4 /* OptionType.SELECT */) {
                    const def = setting.options.find(o => o.default);
                    if (def)
                        target[key] = def.value;
                    return def?.value;
                }
            }
        }
        return v;
    }
});
if (!IS_REPORTER) {
    let flushQueued = false;
    const changedPaths = new Set();
    SettingsStore.addGlobalChangeListener((_, path) => {
        changedPaths.add(path);
        if (flushQueued)
            return;
        flushQueued = true;
        queueMicrotask(() => {
            flushQueued = false;
            const path = changedPaths.size === 1 ? changedPaths.values().next().value : "";
            changedPaths.clear();
            SettingsStore.plain.cloud.settingsSyncVersion = Date.now();
            VencordNative.settings.set(SettingsStore.plain, path);
        });
    });
}
/**
 * Same as {@link Settings} but unproxied. You should treat this as readonly,
 * as modifying properties on this will not save to disk or call settings
 * listeners.
 * WARNING: default values specified in plugin.settings will not be ensured here. In other words,
 * settings for which you specified a default value may be uninitialised. If you need proper
 * handling for default values, use {@link Settings}
 */
export const PlainSettings = settings;
/**
 * A smart settings object. Altering props automagically saves
 * the updated settings to disk.
 * This recursively proxies objects. If you need the object non proxied, use {@link PlainSettings}
 */
export const Settings = SettingsStore.store;
/**
 * Settings hook for React components. Returns a smart settings
 * object that automagically triggers a rerender if any properties
 * are altered
 * @param paths An optional list of paths to whitelist for rerenders
 * @returns Settings
 */
// TODO: Representing paths as essentially "string[].join('.')" wont allow dots in paths, change to "paths?: string[][]" later
export function useSettings(paths) {
    const [, forceUpdate] = React.useReducer(() => ({}), {});
    // Almost every call site passes a fresh array literal, so keying the effect on the
    // array identity tore down and rebuilt every listener on every single render. Key on
    // the contents instead and read the current paths through a ref.
    const pathsRef = React.useRef(paths);
    pathsRef.current = paths;
    const pathKey = paths ? paths.join("\0") : null;
    useEffect(() => {
        const currentPaths = pathsRef.current;
        if (currentPaths) {
            currentPaths.forEach(p => {
                if (!p)
                    return;
                if (p.endsWith(".*")) {
                    SettingsStore.addPrefixChangeListener(p.slice(0, -2), forceUpdate);
                }
                else {
                    SettingsStore.addChangeListener(p, forceUpdate);
                }
            });
            return () => currentPaths.forEach(p => {
                if (!p)
                    return;
                if (p.endsWith(".*")) {
                    SettingsStore.removePrefixChangeListener(p.slice(0, -2), forceUpdate);
                }
                else {
                    SettingsStore.removeChangeListener(p, forceUpdate);
                }
            });
        }
        else {
            SettingsStore.addGlobalChangeListener(forceUpdate);
            return () => SettingsStore.removeGlobalChangeListener(forceUpdate);
        }
    }, [pathKey]);
    return SettingsStore.store;
}
export function migratePluginSettings(name, ...oldNames) {
    const { plugins } = SettingsStore.plain;
    if (name in plugins)
        return;
    for (const oldName of oldNames) {
        if (oldName in plugins) {
            logger.info(`Migrating settings from old name ${oldName} to ${name}`);
            plugins[name] = plugins[oldName];
            delete plugins[oldName];
            SettingsStore.markAsChanged();
            break;
        }
    }
}
export function migratePluginSetting(pluginName, newSetting, oldSetting) {
    const settings = SettingsStore.plain.plugins[pluginName];
    if (!settings)
        return;
    if (!Object.hasOwn(settings, oldSetting) || Object.hasOwn(settings, newSetting))
        return;
    logger.info(`Migrating plugin setting from ${oldSetting} to ${newSetting} on ${pluginName}`);
    settings[newSetting] = settings[oldSetting];
    delete settings[oldSetting];
    SettingsStore.markAsChanged();
}
export function migratePluginToSettings(deleteOldSettings, newName, oldName, ...settingNames) {
    const { plugins } = SettingsStore.plain;
    const newPlugin = plugins[newName];
    const oldPlugin = plugins[oldName];
    if (newPlugin && oldPlugin?.enabled) {
        for (const settingName of settingNames) {
            logger.info(`Migrating plugin to setting from old name ${oldName} to ${newName} as ${settingName}`);
            newPlugin[settingName] = true;
        }
        newPlugin.enabled = true;
        if (deleteOldSettings)
            delete plugins[oldName];
        SettingsStore.markAsChanged();
    }
}
export function migrateSettingToPlugin(newName, oldName, settingName) {
    const { plugins } = SettingsStore.plain;
    const newPlugin = plugins[newName];
    const oldPlugin = plugins[oldName];
    if (newPlugin && oldPlugin?.enabled && oldPlugin?.[settingName]) {
        logger.info(`Migrating setting ${settingName} from ${oldName} to seperate plugin ${newName}`);
        delete oldPlugin[settingName];
        newPlugin.enabled = true;
        SettingsStore.markAsChanged();
    }
}
export function migrateSettingsFromPlugin(newPlugin, oldPlugin, ...settings) {
    const { plugins } = SettingsStore.plain;
    const oldSettings = plugins[oldPlugin];
    const newSettings = plugins[newPlugin];
    if (!oldSettings || !newSettings)
        return;
    for (const setting of settings) {
        if (!Object.hasOwn(oldSettings, setting))
            continue;
        if (Object.hasOwn(newSettings, setting))
            continue;
        logger.info(`Migrating plugin setting "${setting}" from ${oldPlugin} to ${newPlugin}`);
        newSettings[setting] = oldSettings[setting];
        delete oldSettings[setting];
    }
    SettingsStore.markAsChanged();
}
export function migrateOldSettingToNewPlugin(newPlugin, newSetting, oldPlugin, oldSetting) {
    const { plugins } = SettingsStore.plain;
    const oldSettings = plugins[oldPlugin];
    const newSettings = plugins[newPlugin];
    if (!oldSettings || !newSettings)
        return;
    if (!Object.hasOwn(oldSettings, oldSetting) || Object.hasOwn(newSettings, newSetting))
        return;
    logger.info(`Migrating plugin setting "${oldSetting}" from ${oldPlugin} to "${newSetting}" on ${newPlugin}`);
    newSettings[newSetting] = oldSettings[oldSetting];
    delete oldSettings[oldSetting];
    SettingsStore.markAsChanged();
}
export function definePluginSettings(def, checks) {
    if (checks) {
        for (const [name, check] of Object.entries(checks)) {
            Object.assign(def[name], check);
        }
    }
    const definedSettings = {
        get store() {
            if (!definedSettings.pluginName)
                throw new Error("Cannot access settings before plugin is initialized");
            return Settings.plugins[definedSettings.pluginName];
        },
        get plain() {
            if (!definedSettings.pluginName)
                throw new Error("Cannot access settings before plugin is initialized");
            return PlainSettings.plugins[definedSettings.pluginName];
        },
        use: settings => useSettings((settings
            ? settings.map(name => `plugins.${definedSettings.pluginName}.${name}`)
            : [`plugins.${definedSettings.pluginName}.*`])).plugins[definedSettings.pluginName],
        def,
        pluginName: "",
        withPrivateSettings() {
            return this;
        }
    };
    return definedSettings;
}
