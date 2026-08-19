/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ipcRenderer } from "electron/renderer";
export function invoke(event, ...args) {
    return ipcRenderer.invoke(event, ...args);
}
export function sendSync(event, ...args) {
    return ipcRenderer.sendSync(event, ...args);
}
const PluginHelpers = {};
const pluginIpcMap = sendSync("VencordGetPluginIpcMethodMap" /* IpcEvents.GET_PLUGIN_IPC_METHOD_MAP */);
for (const [plugin, methods] of Object.entries(pluginIpcMap)) {
    const map = PluginHelpers[plugin] = {};
    for (const [methodName, method] of Object.entries(methods)) {
        map[methodName] = (...args) => invoke(method, ...args);
    }
}
export default {
    themes: {
        uploadTheme: (fileName, fileData) => invoke("VencordUploadTheme" /* IpcEvents.UPLOAD_THEME */, fileName, fileData),
        deleteTheme: (fileName) => invoke("VencordDeleteTheme" /* IpcEvents.DELETE_THEME */, fileName),
        getThemesList: () => invoke("VencordGetThemesList" /* IpcEvents.GET_THEMES_LIST */),
        getThemeData: (fileName) => invoke("VencordGetThemeData" /* IpcEvents.GET_THEME_DATA */, fileName),
        getSystemValues: () => invoke("VencordGetThemeSystemValues" /* IpcEvents.GET_THEME_SYSTEM_VALUES */),
        openFolder: () => invoke("VencordOpenThemesFolder" /* IpcEvents.OPEN_THEMES_FOLDER */),
    },
    updater: {
        getUpdates: () => invoke("VencordGetUpdates" /* IpcEvents.GET_UPDATES */),
        update: () => invoke("VencordUpdate" /* IpcEvents.UPDATE */),
        forceUpdate: () => invoke("VencordForceUpdate" /* IpcEvents.FORCE_UPDATE */),
        rebuild: () => invoke("VencordBuild" /* IpcEvents.BUILD */),
        getRepo: () => invoke("VencordGetRepo" /* IpcEvents.GET_REPO */),
    },
    settings: {
        get: () => sendSync("VencordGetSettings" /* IpcEvents.GET_SETTINGS */),
        set: (settings, pathToNotify) => invoke("VencordSetSettings" /* IpcEvents.SET_SETTINGS */, settings, pathToNotify),
        getSettingsDir: () => invoke("VencordGetSettingsDir" /* IpcEvents.GET_SETTINGS_DIR */),
        openFolder: () => invoke("VencordOpenSettingsFolder" /* IpcEvents.OPEN_SETTINGS_FOLDER */),
    },
    presets: {
        get: () => invoke("VencordGetPresets" /* IpcEvents.GET_PRESETS */),
        set: (data) => invoke("VencordSetPresets" /* IpcEvents.SET_PRESETS */, data),
    },
    quickCss: {
        get: () => invoke("VencordGetQuickCss" /* IpcEvents.GET_QUICK_CSS */),
        set: (css) => invoke("VencordSetQuickCss" /* IpcEvents.SET_QUICK_CSS */, css),
        addChangeListener(cb) {
            ipcRenderer.on("VencordQuickCssUpdate" /* IpcEvents.QUICK_CSS_UPDATE */, (_, css) => cb(css));
        },
        addThemeChangeListener(cb) {
            ipcRenderer.on("VencordThemeUpdate" /* IpcEvents.THEME_UPDATE */, () => cb());
        },
        openFile: () => invoke("VencordOpenQuickCss" /* IpcEvents.OPEN_QUICKCSS */),
        openEditor: () => invoke("VencordOpenMonacoEditor" /* IpcEvents.OPEN_MONACO_EDITOR */),
        getEditorTheme: () => sendSync("VencordGetMonacoTheme" /* IpcEvents.GET_MONACO_THEME */),
    },
    native: {
        getVersions: () => process.versions,
        supportsWindowsMaterial: () => sendSync("VencordSupportsWindowsMaterial" /* IpcEvents.SUPPORTS_WINDOWS_MATERIAL */),
        openExternal: (url) => invoke("VencordOpenExternal" /* IpcEvents.OPEN_EXTERNAL */, url),
        getRendererCss: () => invoke("VencordGetRendererCss" /* IpcEvents.GET_RENDERER_CSS */),
        onRendererCssUpdate: (cb) => {
            if (!IS_DEV)
                return;
            ipcRenderer.on("VencordRendererCssUpdate" /* IpcEvents.RENDERER_CSS_UPDATE */, (_e, newCss) => cb(newCss));
        }
    },
    csp: {
        /**
         * Note: Only supports full explicit matches, not wildcards.
         *
         * If `*.example.com` is allowed, `isDomainAllowed("https://sub.example.com")` will return false.
         */
        isDomainAllowed: (url, directives) => invoke("VencordCspIsDomainAllowed" /* IpcEvents.CSP_IS_DOMAIN_ALLOWED */, url, directives),
        removeOverride: (url) => invoke("VencordCspRemoveOverride" /* IpcEvents.CSP_REMOVE_OVERRIDE */, url),
        requestAddOverride: (url, directives, callerName) => invoke("VencordCspRequestAddOverride" /* IpcEvents.CSP_REQUEST_ADD_OVERRIDE */, url, directives, callerName),
    },
    tray: {
        setUpdateState: (available) => ipcRenderer.send("VencordSetTrayUpdateState" /* IpcEvents.SET_TRAY_UPDATE_STATE */, available),
        onCheckUpdates: (cb) => { ipcRenderer.on("VencordTrayCheckUpdates" /* IpcEvents.TRAY_CHECK_UPDATES */, cb); },
        onRepair: (cb) => { ipcRenderer.on("VencordTrayRepair" /* IpcEvents.TRAY_REPAIR */, cb); },
    },
    privacy: {
        getData: () => invoke("TestCordPrivacyGetData" /* IpcEvents.PRIVACY_GET_DATA */),
        toggleShield: (key, value) => invoke("TestCordPrivacyToggleShield" /* IpcEvents.PRIVACY_TOGGLE_SHIELD */, key, value),
        setDnsProvider: (name) => invoke("TestCordPrivacySetDnsProvider" /* IpcEvents.PRIVACY_SET_DNS_PROVIDER */, name),
        setDnsEnabled: (enabled) => invoke("TestCordPrivacySetDnsEnabled" /* IpcEvents.PRIVACY_SET_DNS_ENABLED */, enabled),
        addCustomDns: (name, doh, fallback) => invoke("TestCordPrivacyAddCustomDns" /* IpcEvents.PRIVACY_ADD_CUSTOM_DNS */, name, doh, fallback),
        pingLatencies: () => invoke("TestCordPrivacyPingLatencies" /* IpcEvents.PRIVACY_PING_LATENCIES */),
        runDiagnostic: (mode) => invoke("TestCordPrivacyRunDiagnostic" /* IpcEvents.PRIVACY_RUN_DIAGNOSTIC */, mode),
        stopDiagnostic: () => invoke("TestCordPrivacyStopDiagnostic" /* IpcEvents.PRIVACY_STOP_DIAGNOSTIC */),
        clearDnsCache: () => invoke("TestCordPrivacyClearDnsCache" /* IpcEvents.PRIVACY_CLEAR_DNS_CACHE */),
        clearLogs: () => invoke("TestCordPrivacyClearLogs" /* IpcEvents.PRIVACY_CLEAR_LOGS */),
        clearAllowedLogs: () => invoke("TestCordPrivacyClearAllowedLogs" /* IpcEvents.PRIVACY_CLEAR_ALLOWED_LOGS */),
        setMaxLogs: (limit) => invoke("TestCordPrivacySetMaxLogs" /* IpcEvents.PRIVACY_SET_MAX_LOGS */, limit),
        incrementCounter: (key, amount) => invoke("TestCordPrivacyIncrementCounter" /* IpcEvents.PRIVACY_INCREMENT_COUNTER */, key, amount),
        getHostRules: () => invoke("TestCordPrivacyGetHostRules" /* IpcEvents.PRIVACY_GET_HOST_RULES */),
        setHostRule: (host, rule) => invoke("TestCordPrivacySetHostRule" /* IpcEvents.PRIVACY_SET_HOST_RULE */, host, rule),
        clearHostRule: (host) => invoke("TestCordPrivacyClearHostRule" /* IpcEvents.PRIVACY_CLEAR_HOST_RULE */, host),
        acknowledgeAlerts: () => invoke("TestCordPrivacyAckAlerts" /* IpcEvents.PRIVACY_ACK_ALERTS */),
        onSecurityAlert: (cb) => {
            const listener = (_, alert) => cb(alert);
            ipcRenderer.on("TestCordPrivacySecurityAlert" /* IpcEvents.PRIVACY_SECURITY_ALERT */, listener);
            // Returning the unsubscribe lets callers clean up on unmount
            // instead of leaking a listener per panel open.
            return () => {
                ipcRenderer.removeListener("TestCordPrivacySecurityAlert" /* IpcEvents.PRIVACY_SECURITY_ALERT */, listener);
            };
        }
    },
    pluginHelpers: PluginHelpers
};
