/*!
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

// DO NOT REMOVE UNLESS YOU WISH TO FACE THE WRATH OF THE CIRCULAR DEPENDENCY DEMON!!!!!!!
import "~plugins";
import "./fixWeirdAppRegionBug.css";

export * as Api from "./api";
export * as Plugins from "./api/PluginManager";
export * as Components from "./components";
export * as Util from "./utils";
export * as Updater from "./utils/updater";
export * as Webpack from "./webpack";
export * as WebpackPatcher from "./webpack/patchWebpack";
export { PlainSettings, Settings };

import { coreStyleRootNode, initStyles } from "@api/Styles";
import { openSettingsTabModal, UpdaterTab } from "@components/settings";
import { openUpdateAvailableModal } from "@components/UpdateAvailableModal";
import { debounce } from "@shared/debounce";
import { IS_WINDOWS } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import { StartAt } from "@utils/types";
import { SettingsRouter } from "@webpack/common";

import { get as dsGet } from "./api/DataStore";
import { popNotice, showNotice } from "./api/Notices";
import { NotificationData, showNotification } from "./api/Notifications";
import { PatchVersioning } from "./api/PatchVersioning";
import { initPluginManager, PMLogger, startAllPlugins } from "./api/PluginManager";
import { PlainSettings, Settings, SettingsStore } from "./api/Settings";
import { areLocalSettingsDirty, getCloudSettings, getCloudSyncDirection, markLocalSettingsDirty, putCloudSettings, shouldCloudSync } from "./api/SettingsSync/cloudSync";
import { relaunch } from "./utils/native";
import { changes, checkForUpdates, isOutdated as getIsOutdated, update, UpdateLogger } from "./utils/updater";
import { onceReady } from "./webpack";
import { patches } from "./webpack/patchWebpack";

if (IS_REPORTER) {
    require("./debug/runReporter");
}

async function syncSettings() {
    const hasCloudAuth = await dsGet("Vencord_cloudSecret");
    if (!hasCloudAuth) {
        if (Settings.cloud.authenticated) {
            // User switched to an account that isn't connected to cloud
            showNotification({
                title: "Cloud Settings",
                body: "Cloud sync was disabled because this account isn't connected to the cloud App. You can enable it again by connecting this account in Cloud Settings. (note: it will store your preferences separately)",
                color: "var(--yellow-360)",
                onClick: () => SettingsRouter.openUserSettings("equicord_cloud_panel")
            });
            // Disable cloud sync globally
            Settings.cloud.authenticated = false;
        }
        return;
    }

    // pre-check for local shared settings
    if (
        Settings.cloud.authenticated &&
        !hasCloudAuth // this has been enabled due to local settings share or some other bug
    ) {
        // show a notification letting them know and tell them how to fix it
        showNotification({
            title: "Cloud Integrations",
            body: "We've noticed you have cloud integrations enabled in another client! Due to limitations, you will " +
                "need to re-authenticate to continue using them. Click here to go to the settings page to do so!",
            color: "var(--yellow-360)",
            onClick: () => SettingsRouter.openUserSettings("equicord_cloud_panel")
        });
        return;
    }

    if (
        Settings.cloud.settingsSync && // if it's enabled
        Settings.cloud.authenticated && // if cloud integrations are enabled
        getCloudSyncDirection() !== "manual" // if we're not in manual mode
    ) {
        if (areLocalSettingsDirty() && shouldCloudSync("push")) {
            await putCloudSettings();
        } else if (shouldCloudSync("pull") && await getCloudSettings(false)) { // if we synchronized something (false means no sync)
            // we show a notification here instead of allowing getCloudSettings() to show one to declutter the amount of
            // potential notifications that might occur. getCloudSettings() will always send a notification regardless if
            // there was an error to notify the user, but besides that we only want to show one notification instead of all
            // of the possible ones it has (such as when your settings are newer).
            showNotification({
                title: "Cloud Settings",
                body: "Your settings have been updated! Click here to restart to fully apply changes!",
                color: "var(--green-360)",
                onClick: relaunch
            });
        }
    }

    const saveSettingsOnFrequentAction = debounce(async () => {
        if (Settings.cloud.settingsSync && Settings.cloud.authenticated && shouldCloudSync("push")) {
            await putCloudSettings();
        }
    }, 60_000);

    SettingsStore.addGlobalChangeListener(() => {
        markLocalSettingsDirty();
        saveSettingsOnFrequentAction();
    });
}

let notifiedForUpdatesThisSession = false;

async function runUpdateCheck() {
    if (IS_UPDATER_DISABLED) return;

    const notify = (data: NotificationData) => {
        if (notifiedForUpdatesThisSession) return;
        notifiedForUpdatesThisSession = true;

        setTimeout(() => showNotification({
            permanent: true,
            noPersist: true,
            ...data
        }), 10_000);
    };

    try {
        const isOutdated = await checkForUpdates();
        if (IS_DISCORD_DESKTOP) VencordNative.tray.setUpdateState(isOutdated);
        if (!isOutdated) return;

        if (Settings.autoUpdate) {
            await update();
            if (Settings.autoUpdateNotification) {
                if (notifiedForUpdatesThisSession) return;
                notifiedForUpdatesThisSession = true;

                openUpdateAvailableModal({
                    commits: changes,
                    title: "TestCord has updated!",
                    confirmText: "View Updates",
                    onConfirm: () => openSettingsTabModal(UpdaterTab!),
                    onUpdate: relaunch,
                    updateText: "Restart"
                });
            }
            return;
        }

        if (notifiedForUpdatesThisSession) return;
        notifiedForUpdatesThisSession = true;

        openUpdateAvailableModal({
            commits: changes,
            title: "TestCord has updated!",
            confirmText: "View Updates",
            onConfirm: () => openSettingsTabModal(UpdaterTab!),
            onUpdate: async () => {
                await update();
                relaunch();
            }
        });
    } catch (err) {
        UpdateLogger.error("Failed to check for updates", err);
    }
}

function initTrayIpc() {
    if (IS_WEB || IS_UPDATER_DISABLED) return;

    VencordNative.tray.onCheckUpdates(async () => {
        try {
            const isOutdated = await checkForUpdates();
            VencordNative.tray.setUpdateState(isOutdated);

            if (isOutdated) {
                showNotice("A Testcord update is available!", "View Update", () => openSettingsTabModal(UpdaterTab!));
            } else {
                showNotice("No updates available, you're on the latest version!", "OK", popNotice);
            }
        } catch (err) {
            UpdateLogger.error("Failed to check for updates from tray", err);
            showNotice("Failed to check for updates, check the console for more info", "OK", popNotice);
        }
    });

    VencordNative.tray.onRepair(async () => {
        try {
            await update();
            relaunch();
        } catch (err) {
            UpdateLogger.error("Failed to repair Equicord", err);
        }
    });

    VencordNative.tray.setUpdateState(getIsOutdated);
}

async function init() {
    await onceReady;
    startAllPlugins(StartAt.WebpackReady);

    syncSettings();

    if (!IS_DEV && !IS_WEB && !IS_UPDATER_DISABLED) {
        runUpdateCheck();

        // this tends to get really annoying, so only do this if the user has auto-update without notification enabled
        if (Settings.autoUpdate && !Settings.autoUpdateNotification) {
            setInterval(runUpdateCheck, 1000 * 60 * 30); // 30 minutes
        }
    }

    if (IS_DEV) {
        const pendingPatches = patches.filter(p => !p.all && p.predicate?.() !== false);
        if (pendingPatches.length)
            PMLogger.warn(
                "Webpack has finished initialising, but some patches haven't been applied yet.",
                "This might be expected since some Modules are lazy loaded, but please verify",
                "that all plugins are working as intended.",
                "You are seeing this warning because this is a Development build of TestCord.",
                "\nThe following patches have not been applied:",
                "\n\n" + pendingPatches.map(p => `${p.plugin}: ${p.find}`).join("\n")
            );
    }

    // Initialise patch versioning so that codeChanged entries are recorded
    // when Discord updates the underlying code for a patched module.
    void PatchVersioning.init();

    // Defer non-critical IPC init to not block the critical startup path
    setTimeout(initTrayIpc, 0);
}

initPluginManager();

if (!IS_DEV) {
    window.onerror = (message, source, lineno, colno, error) => {
        const msg = String(message);
        if (msg.includes("startsWith") || msg.includes("Cannot read properties")) return true;
    };
    window.addEventListener("unhandledrejection", e => {
        const { reason } = e;
        if (reason?.message?.includes?.("startsWith")) e.preventDefault();
    });
}

function initNotificationSafeguard() {
    if (typeof window === "undefined") return;

    if (window.Notification && !(window.Notification as any)._safePatched) {
        const OrigNotification = window.Notification;
        const SafeNotification = function (title: string, options?: NotificationOptions) {
            const safeTitle = typeof title === "string" ? title : (title == null ? "" : String(title));
            const safeOptions = options ? { ...options } : {};
            if ("body" in safeOptions) {
                safeOptions.body = typeof safeOptions.body === "string" ? safeOptions.body : (safeOptions.body == null ? "" : String(safeOptions.body));
            }
            return new OrigNotification(safeTitle, safeOptions);
        } as any;
        SafeNotification.prototype = OrigNotification.prototype;
        SafeNotification.permission = OrigNotification.permission;
        SafeNotification.requestPermission = OrigNotification.requestPermission ? OrigNotification.requestPermission.bind(OrigNotification) : undefined;
        SafeNotification._safePatched = true;
        try {
            window.Notification = SafeNotification;
        } catch {}
    }

    const patchDiscordNative = () => {
        try {
            const dn = (window as any).DiscordNative;
            if (dn?.notifications?.sendNotification && !dn.notifications._safePatched) {
                const origSend = dn.notifications.sendNotification.bind(dn.notifications);
                dn.notifications.sendNotification = function (opts: any, ...rest: any[]) {
                    if (opts && typeof opts === "object") {
                        if ("title" in opts && typeof opts.title !== "string") {
                            opts.title = opts.title == null ? "" : String(opts.title);
                        }
                        if ("body" in opts && typeof opts.body !== "string") {
                            opts.body = opts.body == null ? "" : String(opts.body);
                        }
                        if ("text" in opts && typeof opts.text !== "string") {
                            opts.text = opts.text == null ? "" : String(opts.text);
                        }
                    }
                    return origSend(opts, ...rest);
                };
                dn.notifications._safePatched = true;
            }
        } catch {}
    };

    patchDiscordNative();
    setTimeout(patchDiscordNative, 500);
}

initNotificationSafeguard();
initStyles();
startAllPlugins(StartAt.Init);
init();

window.addEventListener("keydown", e => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const key = e.key?.toLowerCase();
    if ((isCtrl && e.shiftKey && key === "i") || (isCtrl && e.altKey && key === "i") || key === "f12") {
        try {
            const winApi = (window as any).DiscordNative?.window || (window as any).VencordNative?.window;
            if (typeof winApi?.openDevTools === "function") {
                winApi.openDevTools();
            } else if (typeof winApi?.toggleDevTools === "function") {
                winApi.toggleDevTools();
            }
        } catch (err) {
            console.error("[TestCord] Failed to open DevTools:", err);
        }
    }
}, true);

document.addEventListener("DOMContentLoaded", () => {
    startAllPlugins(StartAt.DOMContentLoaded);

    // FIXME
    if (IS_DISCORD_DESKTOP && Settings.winNativeTitleBar && IS_WINDOWS) {
        createAndAppendStyle("vencord-native-titlebar-style", coreStyleRootNode).textContent = "[class*=titleBar]{display: none!important}";
    }
}, { once: true });
