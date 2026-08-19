/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const settings = definePluginSettings({
    fakeMute: {
        description: "Make everyone believe you're muted (you can still speak)",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    fakeDeafen: {
        description: "Make everyone believe you're deafened (you can still hear)",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    fakeStream: {
        description: "Make everyone believe you're streaming (when you're not)",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    fakeGame: {
        description: "Make everyone believe you're in an activity (when you're not)",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    fakeCam: {
        description: "Make everyone believe your camera is on (even if it's not)",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
    },
    cutMicTransmission: {
        description: "Locally mute your microphone while Fake Voice is enabled so no mic input is transmitted",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
    },
    autoMute: {
        description: "Automatically fake mute when fake deafened (matches real Discord behavior)",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    userAreaButton: {
        description: "Show the Fake Voice toggle button in the user area",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    contextMenu: {
        description: "Show Fake Voice options in the voice channel context menu",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    deviceContextMenu: {
        description: "Show fake mute/deafen/camera toggles in the audio & video device context menus",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    muteKeybind: {
        description: "⌨️ Keybind for toggling fake mute only (format: modifier+key, e.g. 'ctrl+j')",
        type: 0 /* OptionType.STRING */,
        default: "ctrl+j",
    },
    deafenKeybind: {
        description: "⌨️ Keybind for toggling fake deafen (+ fake mute if auto-mute is on) (e.g. 'ctrl+l')",
        type: 0 /* OptionType.STRING */,
        default: "ctrl+l",
    },
});
