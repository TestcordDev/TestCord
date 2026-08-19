/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin from "@utils/types";
import { closeAllModals, SettingsRouter, useState } from "@webpack/common";
import { registerAction } from "./commands";
import { openCommandPalette } from "./components/CommandPalette";
const cl = classNameFactory("vc-command-palette-");
let isRecordingGlobal = false;
let paletteRoot = null;
export const settings = definePluginSettings({
    hotkey: {
        description: "The hotkey to open the command palette.",
        type: 6 /* OptionType.COMPONENT */,
        default: ["Control", "Shift", "P"],
        component: () => {
            const [isRecording, setIsRecording] = useState(false);
            const recordKeybind = (setIsRecording) => {
                const keys = new Set();
                const keyLists = [];
                setIsRecording(true);
                isRecordingGlobal = true;
                let recorderButton = document.querySelector(`.${cl("key-recorder-button")}`);
                const updateKeys = () => {
                    if (recorderButton && !document.contains(recorderButton))
                        recorderButton = null;
                    if (keys.size === 0 || !recorderButton) {
                        const longestArray = keyLists.reduce((a, b) => a.length > b.length ? a : b);
                        if (longestArray.length > 0) {
                            settings.store.hotkey = longestArray.map(key => key.toLowerCase());
                        }
                        setIsRecording(false);
                        isRecordingGlobal = false;
                        document.removeEventListener("keydown", keydownListener);
                        document.removeEventListener("keyup", keyupListener);
                    }
                    keyLists.push(Array.from(keys));
                };
                const keydownListener = (e) => {
                    const { key } = e;
                    if (!keys.has(key)) {
                        keys.add(key);
                    }
                    updateKeys();
                };
                const keyupListener = (e) => {
                    keys.delete(e.key);
                    updateKeys();
                };
                document.addEventListener("keydown", keydownListener);
                document.addEventListener("keyup", keyupListener);
            };
            return (<>
                    <div className={cl("key-recorder-container")} onClick={() => recordKeybind(setIsRecording)}>
                        <div className={`${cl("key-recorder")} ${isRecording ? cl("recording") : ""}`}>
                            {settings.store.hotkey.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" + ")}
                            <button className={`${cl("key-recorder-button")} ${isRecording ? cl("recording-button") : ""}`} disabled={isRecording}>
                                {isRecording ? "Recording..." : "Record keybind"}
                            </button>
                        </div>
                    </div>
                </>);
        }
    },
    allowMouseControl: {
        description: "Allow the mouse to control the command palette.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true
    }
});
export default definePlugin({
    name: "KeyboardNavigation",
    description: "Allows you to navigate the UI with a keyboard.",
    tags: ["Accessibility", "Shortcuts"],
    authors: [Devs.Ethan],
    settings,
    start() {
        document.addEventListener("keydown", this.event);
        if (IS_DEV) {
            registerAction({
                id: "openDevSettings",
                label: "Open Dev tab",
                callback: () => SettingsRouter.openUserSettings("equicord_patch_helper_panel"),
                registrar: "Equicord"
            });
        }
    },
    stop() {
        document.removeEventListener("keydown", this.event);
    },
    event(e) {
        let Modifiers;
        (function (Modifiers) {
            Modifiers["control"] = "ctrlKey";
            Modifiers["shift"] = "shiftKey";
            Modifiers["alt"] = "altKey";
            Modifiers["meta"] = "metaKey";
        })(Modifiers || (Modifiers = {}));
        const { hotkey } = settings.store;
        const pressedKey = e.key.toLowerCase();
        if (isRecordingGlobal)
            return;
        for (let i = 0; i < hotkey.length; i++) {
            const lowercasedRequiredKey = hotkey[i].toLowerCase();
            if (lowercasedRequiredKey in Modifiers && !e[Modifiers[lowercasedRequiredKey]]) {
                return;
            }
            if (!(lowercasedRequiredKey in Modifiers) && pressedKey !== lowercasedRequiredKey) {
                return;
            }
        }
        closeAllModals();
        if (paletteRoot && !document.contains(paletteRoot))
            paletteRoot = null;
        if (!paletteRoot)
            paletteRoot = document.querySelector(`.${cl("root")}`);
        if (paletteRoot)
            return;
        openCommandPalette();
    }
});
