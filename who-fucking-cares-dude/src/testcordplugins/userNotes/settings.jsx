/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { findByPropsLazy } from "@webpack";
import { Alerts, Button, showToast, Toasts } from "@webpack/common";
import { clearUserNotes, transferUserNotes } from "./data";
const token = findByPropsLazy("getToken");
let a;
export default definePluginSettings({
    removeRegularButton: {
        type: 3 /* OptionType.BOOLEAN */,
        description: 'Remove the regular "Add Note"/"Edit Note" button from the user context menu',
        default: true,
    },
    replaceRegularNotes: {
        type: 3 /* OptionType.BOOLEAN */,
        description: 'Replace the regular "Notes" section by a button that opens notes from this plugin',
        default: false,
        restartNeeded: true,
    },
    disableSpellCheck: {
        type: 3 /* OptionType.BOOLEAN */,
        description: 'Disable "Spellcheck" in notes',
        default: false,
    },
    addNotesDataToolBar: {
        default: true,
        type: 3 /* OptionType.BOOLEAN */,
        description: 'Add "Open Notes Data" button to toolbar',
        restartNeeded: true,
    },
    startupCache: {
        default: false,
        type: 3 /* OptionType.BOOLEAN */,
        description: "Cache all users on startup",
    },
    transferExistingNotes: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Transfer existing notes from Discord into this plugin's data",
        component: () => <Button onClick={() => {
                // didn't find better way to get current user notes :))
                fetch("https://discord.com/api/v9/users/@me/notes", {
                    method: "GET",
                    headers: {
                        Authorization: token.getToken(),
                    }
                }).then(async (r) => {
                    if (!r.ok) {
                        showToast("Unable to retrieve regular notes from Discord", Toasts.Type.FAILURE);
                        return;
                    }
                    r.json().then(resularUsersNotes => {
                        transferUserNotes(resularUsersNotes);
                        showToast("Successfully transferred notes from Discord", Toasts.Type.SUCCESS);
                    }).catch(() => {
                        showToast("Unable to retrieve regular notes from Discord", Toasts.Type.FAILURE);
                    });
                }).catch(() => {
                    showToast("Unable to retrieve regular notes from Discord", Toasts.Type.FAILURE);
                });
            }}>
                Transfer existing regular notes from Discord
            </Button>
    },
    clearNotes: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Clear plugin's notes",
        component: () => <Button color={Button.Colors.RED} onClick={() => Alerts.show({
                title: "Clear Notes",
                body: "Are you sure you want to clear plugin's notes?",
                confirmColor: Button.Colors.RED,
                confirmText: "Clear",
                cancelText: "Cancel",
                onConfirm: () => {
                    clearUserNotes();
                    showToast("Successfully cleared", Toasts.Type.SUCCESS);
                },
            })}>
                Clear Plugin's Notes
            </Button>
    },
});
