/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PlainSettings, Settings, SettingsStore, useSettings } from "@api/Settings";
import { DefinedSettings, OptionType, SettingsDefinition } from "@utils/types";

export function defineModuleSettings<Def extends SettingsDefinition>(
    moduleName: string,
    def: Def
): DefinedSettings<Def> {
    (PlainSettings.plugins as any)[moduleName] ??= {};

    if (moduleName === "discordDevBanner") {
        const legacyPlain = (PlainSettings.plugins as any).DiscordDevBanner || (PlainSettings.plugins as any).devBanner;
        if (legacyPlain) {
            for (const [k, v] of Object.entries(legacyPlain)) {
                if ((PlainSettings.plugins as any)[moduleName][k] === undefined) {
                    (PlainSettings.plugins as any)[moduleName][k] = v;
                }
            }
        }
        const legacySettings = (Settings.plugins as any)?.DiscordDevBanner || (Settings.plugins as any)?.devBanner;
        if (legacySettings) {
            (Settings.plugins as any)[moduleName] ??= {};
            for (const [k, v] of Object.entries(legacySettings)) {
                if ((Settings.plugins as any)[moduleName][k] === undefined) {
                    (Settings.plugins as any)[moduleName][k] = v;
                }
            }
        }
    }

    function getDefault(key: string) {
        const setting = def[key];
        if (!setting) return undefined;
        if ("default" in setting) return (setting as any).default;
        if (setting.type === OptionType.SELECT) {
            const opt = setting.options?.find(o => o.default);
            return opt?.value;
        }
        return undefined;
    }

    for (const [key, item] of Object.entries(def)) {
        if (item.onChange) {
            SettingsStore.addChangeListener(`plugins.${moduleName}.${key}`, item.onChange);
        }
    }

    const storeProxy = new Proxy({} as any, {
        get(_, prop: string) {
            if (prop === "$$typeof") return undefined;
            const raw = (Settings.plugins as any)[moduleName]?.[prop];
            if (raw !== undefined) return raw;
            return getDefault(prop);
        },
        set(_, prop: string, value) {
            (PlainSettings.plugins as any)[moduleName] ??= {};
            (PlainSettings.plugins as any)[moduleName][prop] = value;
            (Settings.plugins as any)[moduleName] ??= {};
            (Settings.plugins as any)[moduleName][prop] = value;
            SettingsStore.markAsChanged();
            return true;
        }
    });

    const plainProxy = new Proxy({} as any, {
        get(_, prop: string) {
            if (prop === "$$typeof") return undefined;
            const raw = (PlainSettings.plugins as any)[moduleName]?.[prop];
            if (raw !== undefined) return raw;
            return getDefault(prop);
        },
        set(_, prop: string, value) {
            (PlainSettings.plugins as any)[moduleName] ??= {};
            (PlainSettings.plugins as any)[moduleName][prop] = value;
            SettingsStore.markAsChanged();
            return true;
        }
    });

    const definedSettings: DefinedSettings<Def> = {
        get store() {
            return storeProxy;
        },
        get plain() {
            return plainProxy;
        },
        use<F extends Extract<keyof Def, string>>(filter?: readonly F[]): Pick<any, F> {
            const paths = filter
                ? filter.map(k => `plugins.${moduleName}.${String(k)}` as const)
                : [`plugins.${moduleName}.*` as const];

            useSettings(paths as any);
            return storeProxy;
        },
        def,
        pluginName: moduleName,
        withPrivateSettings() {
            return definedSettings as any;
        }
    };

    return definedSettings;
}
