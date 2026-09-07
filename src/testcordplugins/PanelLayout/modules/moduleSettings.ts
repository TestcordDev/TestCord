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
            (Settings.plugins as any)[moduleName] ??= {};
            (Settings.plugins as any)[moduleName][prop] = value;
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
