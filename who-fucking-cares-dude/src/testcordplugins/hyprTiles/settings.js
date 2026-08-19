/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { SettingsSection } from "@components/settings/tabs/plugins/components/Common";
import { Switch } from "@components/Switch";
import { Button, React, showToast, Toasts, useState } from "@webpack/common";
import { KeybindEditor } from "./components/KeybindEditor";
import { actionLabels, allActions, defaultKeybinds, getKeybindSettingKey } from "./utils/keybinds";
import { defaultRulesTemplate } from "./utils/rulesTemplate";
const Native = IS_DISCORD_DESKTOP
    ? VencordNative.pluginHelpers.HyprTiles
    : null;
function RulesFileControl({ setValue }) {
    const [enabled, setEnabled] = useState(settings.store.enableRulesFile);
    const [opening, setOpening] = useState(false);
    async function openRulesFile() {
        if (!Native) {
            showToast("HyprTiles rules file is only available on desktop.", Toasts.Type.FAILURE);
            return;
        }
        setOpening(true);
        try {
            await Native.openRulesFile(defaultRulesTemplate);
        }
        catch (error) {
            showToast(`Unable to open HyprTiles rules file: ${error?.message || String(error)}`, Toasts.Type.FAILURE);
        }
        finally {
            setOpening(false);
        }
    }
    return React.createElement(SettingsSection, {
        id: "rulesFile",
        name: "rulesFile",
        description: "Enable JSON5 rules and auto-layout overrides. When off, HyprTiles uses the plugin layout settings only.",
        inlineSetting: true
    }, React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, React.createElement(Switch, {
        checked: enabled,
        onChange: checked => {
            setEnabled(checked);
            setValue(checked);
        }
    }), React.createElement(Button, {
        size: Button.Sizes.SMALL,
        color: Button.Colors.PRIMARY,
        disabled: opening || !IS_DISCORD_DESKTOP,
        onClick: () => void openRulesFile()
    }, "Open Rules File")));
}
const keybindSettings = Object.fromEntries(allActions.map(action => [
    getKeybindSettingKey(action),
    {
        type: 0 /* OptionType.STRING */,
        description: `${actionLabels[action]}.`,
        default: defaultKeybinds[action],
        hidden: true
    }
]));
export const settings = definePluginSettings({
    defaultLayout: {
        type: 4 /* OptionType.SELECT */,
        description: "Default layout for new workspaces.",
        options: [
            { label: "Dwindle", value: "dwindle", default: true },
            { label: "Grid", value: "grid" },
            { label: "Columns", value: "columns" },
            { label: "Master (Legacy)", value: "master" }
        ]
    },
    workspaceCount: {
        type: 4 /* OptionType.SELECT */,
        description: "Number of workspaces available.",
        restartNeeded: true,
        options: [
            { label: "1", value: 1 },
            { label: "2", value: 2 },
            { label: "3", value: 3 },
            { label: "4", value: 4, default: true },
            { label: "5", value: 5 },
            { label: "6", value: 6 },
            { label: "7", value: 7 },
            { label: "8", value: 8 },
            { label: "9", value: 9 },
        ]
    },
    restoreWorkspaceOnReload: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Restore the active workspace on Discord reload.",
        default: true
    },
    allowDuplicateTargets: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow multiple tiles for the same channel or DM.",
        default: false
    },
    showHotkeyButton: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show HyprTiles hotkey reference button in the header bar.",
        default: true
    },
    showTileHeaders: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show tile headers with title and close button.",
        default: true
    },
    enableAnimations: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Animate tile movement and focus transitions.",
        default: true
    },
    enableRulesFile: {
        type: 6 /* OptionType.COMPONENT */,
        default: false,
        component: RulesFileControl
    },
    keybindEditor: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Configure keyboard shortcuts.",
        component: KeybindEditor
    },
    gaps: {
        type: 5 /* OptionType.SLIDER */,
        description: "Gap size between tiles.",
        default: 8,
        markers: [0, 4, 8, 12, 16, 20, 24],
        stickToMarkers: true
    },
    enableBorders: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable custom border styling for tiles.",
        default: false
    },
    borderColor: {
        type: 0 /* OptionType.STRING */,
        description: "Primary border color (HEX).",
        default: "#7289da"
    },
    borderColorEnd: {
        type: 0 /* OptionType.STRING */,
        description: "Gradient end color (HEX).",
        default: "#5b6eae"
    },
    enableGradients: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable gradient borders.",
        default: true
    },
    gradientType: {
        type: 4 /* OptionType.SELECT */,
        description: "Gradient direction.",
        options: [
            { label: "Horizontal", value: "horizontal", default: true },
            { label: "Vertical", value: "vertical" },
            { label: "Diagonal", value: "diagonal" }
        ]
    },
    animatedBorder: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Animate gradient borders (flowing effect).",
        default: true
    },
    animationSpeed: {
        type: 5 /* OptionType.SLIDER */,
        description: "Animation speed (higher = faster).",
        default: 5,
        markers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        stickToMarkers: true
    },
    borderWidth: {
        type: 5 /* OptionType.SLIDER */,
        description: "Border width in pixels.",
        default: 3,
        markers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        stickToMarkers: true
    },
    showChannelName: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show channel name in tile header.",
        default: true
    },
    ...keybindSettings
});
