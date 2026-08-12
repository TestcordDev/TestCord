/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { React, Select, useEffect, useState } from "@webpack/common";

import { settings } from "../settings";
import { actionLabels, defaultKeybinds, getKeybindSettingKey, hotkeySections, HyprTilesAction } from "../utils/keybinds";

const cl = classNameFactory("vc-hyprtiles-");
const actionOptions = hotkeySections.flatMap(section => section.actions.map(action => ({
    label: actionLabels[action],
    value: action
})));

function buildKeybindString(e: KeyboardEvent): string | null {
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("CTRL");
    if (e.altKey) parts.push("ALT");
    if (e.shiftKey) parts.push("SHIFT");
    if (e.metaKey) parts.push("META");
    parts.push(e.key === " " ? "SPACE" : e.key.toUpperCase());
    return parts.join("+");
}

export function KeybindEditor() {
    const [selectedAction, setSelectedAction] = useState<HyprTilesAction>("openCurrent");
    const [recording, setRecording] = useState(false);

    const settingKey = getKeybindSettingKey(selectedAction);
    const [currentBind, setCurrentBind] = useState(
        () => settings.store[settingKey] || defaultKeybinds[selectedAction]
    );

    useEffect(() => {
        setCurrentBind(settings.store[settingKey] || defaultKeybinds[selectedAction]);
        setRecording(false);
    }, [selectedAction]);

    useEffect(() => {
        if (!recording) return;

        function onKeyDown(e: KeyboardEvent) {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") { setRecording(false); return; }
            const bind = buildKeybindString(e);
            if (!bind) return;
            settings.store[settingKey] = bind;
            setCurrentBind(bind);
            setRecording(false);
        }

        window.addEventListener("keydown", onKeyDown, { capture: true });
        return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    }, [recording, settingKey]);

    const defaultBind = defaultKeybinds[selectedAction];
    const isModified = currentBind !== defaultBind;

    return (
        <div className={cl("keybind-editor")}>
            <div className={cl("keybind-action-select")}>
                <Select
                    options={actionOptions}
                    isSelected={value => value === selectedAction}
                    select={value => setSelectedAction(value)}
                    serialize={value => value}
                />
            </div>

            <div className={cl("keybind-controls")}>
                <span className={cl(recording ? "keybind-recording" : "keybind-display")}>
                    {recording ? "Press keys…" : (currentBind || "No Keybind Set")}
                </span>
                <button
                    type="button"
                    className={cl("keybind-record-btn", recording && "keybind-record-active")}
                    onClick={() => setRecording(v => !v)}
                >
                    {recording ? "Cancel" : "Record Keybind"}
                </button>
                {isModified && (
                    <button
                        type="button"
                        className={cl("keybind-reset-btn")}
                        onClick={() => {
                            settings.store[settingKey] = defaultBind;
                            setCurrentBind(defaultBind);
                        }}
                    >
                        Reset
                    </button>
                )}
            </div>
        </div>
    );
}
