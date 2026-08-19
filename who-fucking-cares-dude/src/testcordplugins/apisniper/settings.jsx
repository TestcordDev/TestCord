/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Alerts } from "@webpack/common";
import { SniperDir } from "./components/FolderSelectInput";
const Native = VencordNative.pluginHelpers.ApiSniper;
export const settings = definePluginSettings({
    sniperDir: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Select directory to save sniped credentials",
        component: ErrorBoundary.wrap(SniperDir),
    },
    snipeOwnMessages: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Detect credentials in your own messages",
        default: false,
    },
    userBlacklist: {
        type: 0 /* OptionType.STRING */,
        description: "Comma-separated list of user IDs to ignore (won't snipe their messages)",
        default: "996137713432530976, 1485706082080002140",
    },
    notifyOnDiscordToken: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Notify when Discord tokens are detected",
        default: true,
    },
    notifyOnApiKey: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Notify when API keys are detected",
        default: true,
    },
    notifyOnEmailPassword: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Notify when email:password combos are detected",
        default: true,
    },
    notifyOnPrivateKeys: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Notify when private keys are detected",
        default: true,
    },
    clearSniperLogs: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Clear all sniper logs",
        component: function ClearLogsButton() {
            return (<Button variant="dangerPrimary" onClick={() => Alerts.show({
                    title: "Clear Sniper Logs",
                    body: "Are you sure you want to clear all sniper logs? This cannot be undone.",
                    confirmText: "Clear",
                    cancelText: "Cancel",
                    onConfirm: async () => {
                        await Native.clearSniperLogs();
                    },
                })}>
                    Clear Sniper Logs
                </Button>);
        },
    },
    openSniperFolder: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Open sniper logs folder",
        component: function OpenFolderButton() {
            return (<Button variant="primary" onClick={async () => {
                    await Native.openSniperFolder();
                }}>
                    Open Sniper Folder
                </Button>);
        },
    },
});
