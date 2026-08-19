/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Button } from "@webpack/common";
import { openMicrophoneSettingsModal } from "../betterMicrophone.desktop/modals";
import { openScreenshareModal } from "../betterScreenshare.desktop/modals";
const SettingsShortcutsElement = () => (<div style={{ display: "flex", gap: "0.5rem" }}>
        <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={openMicrophoneSettingsModal}>
            {"Better Microphone Settings"}
        </Button>
        <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={openScreenshareModal}>
            {"Better Screenshare Settings"}
        </Button>
    </div>);
export default definePlugin({
    name: "SettingsShortcuts",
    description: "Adds Better Microphone and Better Screenshare shortcut buttons to Discord settings.",
    tags: ["Shortcuts", "Utility"],
    authors: [TestcordDevs.x2b],
    start() {
        const customSettingsSections = Vencord.Plugins.plugins.Settings.customSections;
        const sectionFactory = () => ({
            section: "privcord.settings-shortcuts",
            label: "Privcord Shortcuts",
            searchableTitles: ["Privcord Shortcuts", "Better Microphone", "Better Screenshare"],
            element: SettingsShortcutsElement,
            id: "PrivcordSettingsShortcuts",
        });
        customSettingsSections.push(sectionFactory);
    },
    stop() {
        const customSettingsSections = Vencord.Plugins.plugins.Settings.customSections;
        const i = customSettingsSections.findIndex(section => section({}).id === "PrivcordSettingsShortcuts");
        if (i !== -1)
            customSettingsSections.splice(i, 1);
    },
});
