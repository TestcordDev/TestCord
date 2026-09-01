/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Settings } from "@api/Settings";
import type { CspRequestResult } from "@main/csp/manager";
import type { PluginIpcMappings } from "@main/ipcPlugins";
import { UserThemeHeader } from "@main/themes";
import { IpcEvents } from "@shared/IpcEvents";
import type { IpcRes } from "@utils/types";
import { ipcRenderer } from "electron/renderer";

export function invoke<T = any>(event: IpcEvents, ...args: any[]) {
    return ipcRenderer.invoke(event, ...args) as Promise<T>;
}

export function sendSync<T = any>(event: IpcEvents, ...args: any[]) {
    return ipcRenderer.sendSync(event, ...args) as T;
}

const PluginHelpers = {} as Record<string, Record<string, (...args: any[]) => Promise<any>>>;
const pluginIpcMap = sendSync<PluginIpcMappings>(IpcEvents.GET_PLUGIN_IPC_METHOD_MAP);

for (const [plugin, methods] of Object.entries(pluginIpcMap)) {
    const map = PluginHelpers[plugin] = {};
    for (const [methodName, method] of Object.entries(methods)) {
        map[methodName] = (...args: any[]) => invoke(method as IpcEvents, ...args);
    }
}

export default {
    themes: {
        uploadTheme: (fileName: string, fileData: string) => invoke<void>(IpcEvents.UPLOAD_THEME, fileName, fileData),
        deleteTheme: (fileName: string) => invoke<void>(IpcEvents.DELETE_THEME, fileName),
        getThemesList: () => invoke<Array<UserThemeHeader>>(IpcEvents.GET_THEMES_LIST),
        getThemeData: (fileName: string) => invoke<string | undefined>(IpcEvents.GET_THEME_DATA, fileName),
        getSystemValues: () => invoke<Record<string, string>>(IpcEvents.GET_THEME_SYSTEM_VALUES),

        openFolder: () => invoke<void>(IpcEvents.OPEN_THEMES_FOLDER),
    },

    updater: {
        getUpdates: (branch?: string) => invoke<IpcRes<Record<"hash" | "author" | "message", string>[]>>(IpcEvents.GET_UPDATES, branch),
        update: (branch?: string) => invoke<IpcRes<boolean>>(IpcEvents.UPDATE, branch),
        forceUpdate: (branch?: string) => invoke<IpcRes<boolean>>(IpcEvents.FORCE_UPDATE, branch),
        rebuild: () => invoke<IpcRes<boolean>>(IpcEvents.BUILD),
        getRepo: () => invoke<IpcRes<string>>(IpcEvents.GET_REPO),
    },

    settings: {
        get: () => sendSync<Settings>(IpcEvents.GET_SETTINGS),
        set: (settings: Settings, pathToNotify?: string) => invoke<void>(IpcEvents.SET_SETTINGS, settings, pathToNotify),
        getSettingsDir: () => invoke<string>(IpcEvents.GET_SETTINGS_DIR),

        openFolder: () => invoke<void>(IpcEvents.OPEN_SETTINGS_FOLDER),
    },

    presets: {
        get: () => invoke<Record<string, any>>(IpcEvents.GET_PRESETS),
        set: (data: Record<string, any>) => invoke<void>(IpcEvents.SET_PRESETS, data),
    },

    quickCss: {
        get: () => invoke<string>(IpcEvents.GET_QUICK_CSS),
        set: (css: string) => invoke<void>(IpcEvents.SET_QUICK_CSS, css),

        addChangeListener(cb: (newCss: string) => void) {
            ipcRenderer.on(IpcEvents.QUICK_CSS_UPDATE, (_, css) => cb(css));
        },

        addThemeChangeListener(cb: () => void) {
            ipcRenderer.on(IpcEvents.THEME_UPDATE, () => cb());
        },

        openFile: () => invoke<void>(IpcEvents.OPEN_QUICKCSS),
        openEditor: () => invoke<void>(IpcEvents.OPEN_MONACO_EDITOR),
        getEditorTheme: () => sendSync<string>(IpcEvents.GET_MONACO_THEME),
    },

    native: {
        getVersions: () => process.versions as Partial<NodeJS.ProcessVersions>,
        supportsWindowsMaterial: () => sendSync<boolean>(IpcEvents.SUPPORTS_WINDOWS_MATERIAL),
        openExternal: (url: string) => invoke<void>(IpcEvents.OPEN_EXTERNAL, url),
        getRendererCss: () => invoke<string>(IpcEvents.GET_RENDERER_CSS),
        onRendererCssUpdate: (cb: (newCss: string) => void) => {
            if (!IS_DEV) return;

            ipcRenderer.on(IpcEvents.RENDERER_CSS_UPDATE, (_e, newCss: string) => cb(newCss));
        }
    },

    csp: {
        /**
         * Note: Only supports full explicit matches, not wildcards.
         *
         * If `*.example.com` is allowed, `isDomainAllowed("https://sub.example.com")` will return false.
         */
        isDomainAllowed: (url: string, directives: string[]) => invoke<boolean>(IpcEvents.CSP_IS_DOMAIN_ALLOWED, url, directives),
        removeOverride: (url: string) => invoke<boolean>(IpcEvents.CSP_REMOVE_OVERRIDE, url),
        requestAddOverride: (url: string, directives: string[], callerName: string) =>
            invoke<CspRequestResult>(IpcEvents.CSP_REQUEST_ADD_OVERRIDE, url, directives, callerName),
    },

    tray: {
        setUpdateState: (available: boolean) => ipcRenderer.send(IpcEvents.SET_TRAY_UPDATE_STATE, available),
        onCheckUpdates: (cb: () => void) => { ipcRenderer.on(IpcEvents.TRAY_CHECK_UPDATES, cb); },
        onRepair: (cb: () => void) => { ipcRenderer.on(IpcEvents.TRAY_REPAIR, cb); },
    },

    privacy: {
        getData: () => invoke<any>(IpcEvents.PRIVACY_GET_DATA),
        toggleShield: (key: string, value: boolean) => invoke<any>(IpcEvents.PRIVACY_TOGGLE_SHIELD, key, value),
        setDnsProvider: (name: string) => invoke<boolean>(IpcEvents.PRIVACY_SET_DNS_PROVIDER, name),
        setDnsEnabled: (enabled: boolean) => invoke<boolean>(IpcEvents.PRIVACY_SET_DNS_ENABLED, enabled),
        addCustomDns: (name: string, doh: string, fallback: string) => invoke<boolean>(IpcEvents.PRIVACY_ADD_CUSTOM_DNS, name, doh, fallback),
        pingLatencies: () => invoke<Record<string, number>>(IpcEvents.PRIVACY_PING_LATENCIES),
        runDiagnostic: (mode: "doh" | "dot" | "auto") => invoke<any[]>(IpcEvents.PRIVACY_RUN_DIAGNOSTIC, mode),
        stopDiagnostic: () => invoke<any[]>(IpcEvents.PRIVACY_STOP_DIAGNOSTIC),
        clearDnsCache: () => invoke<any>(IpcEvents.PRIVACY_CLEAR_DNS_CACHE),
        clearLogs: () => invoke<any[]>(IpcEvents.PRIVACY_CLEAR_LOGS),
        clearAllowedLogs: () => invoke<any[]>(IpcEvents.PRIVACY_CLEAR_ALLOWED_LOGS),
        setMaxLogs: (limit: number) => invoke<number>(IpcEvents.PRIVACY_SET_MAX_LOGS, limit),
        incrementCounter: (key: string, amount?: number) => invoke<any>(IpcEvents.PRIVACY_INCREMENT_COUNTER, key, amount),
        getHostRules: () => invoke<Record<string, "allow" | "block">>(IpcEvents.PRIVACY_GET_HOST_RULES),
        setHostRule: (host: string, rule: "allow" | "block") => invoke<Record<string, "allow" | "block">>(IpcEvents.PRIVACY_SET_HOST_RULE, host, rule),
        clearHostRule: (host: string) => invoke<Record<string, "allow" | "block">>(IpcEvents.PRIVACY_CLEAR_HOST_RULE, host),
        acknowledgeAlerts: () => invoke<any[]>(IpcEvents.PRIVACY_ACK_ALERTS),
        postScienceEvents: (payload: any, token?: string, cookie?: string, superProps?: string) =>
            invoke<{ status: number; body?: any; error?: string }>(IpcEvents.PRIVACY_POST_SCIENCE_EVENTS, payload, token, cookie, superProps),
        onSecurityAlert: (cb: (alert: any) => void) => {
            const listener = (_: unknown, alert: any) => cb(alert);
            ipcRenderer.on(IpcEvents.PRIVACY_SECURITY_ALERT, listener);
            // Returning the unsubscribe lets callers clean up on unmount
            // instead of leaking a listener per panel open.
            return () => {
                ipcRenderer.removeListener(IpcEvents.PRIVACY_SECURITY_ALERT, listener);
            };
        }
    },

    pluginHelpers: PluginHelpers
};
