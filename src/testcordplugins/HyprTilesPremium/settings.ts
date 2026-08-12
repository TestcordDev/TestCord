/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { SettingsSection } from "@components/settings/tabs/plugins/components/Common";
import { Switch } from "@components/Switch";
import { OptionType, PluginNative } from "@utils/types";
import { Button, React, showToast, Toasts, useState } from "@webpack/common";

import { KeybindEditor } from "./components/KeybindEditor";
import { actionLabels, allActions, defaultKeybinds, getKeybindSettingKey, HyprTilesKeybindSetting } from "./utils/keybinds";
import { defaultRulesTemplate } from "./utils/rulesTemplate";

const Native = IS_DISCORD_DESKTOP
    ? VencordNative.pluginHelpers.HyprTiles as PluginNative<typeof import("./native")>
    : null;

function RulesFileControl({ setValue }: { setValue(value: boolean): void; }) {
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
        } catch (error: any) {
            showToast(`Unable to open HyprTiles rules file: ${error?.message || String(error)}`, Toasts.Type.FAILURE);
        } finally {
            setOpening(false);
        }
    }

    return React.createElement(
        SettingsSection,
        {
            name: "rulesFile",
            id: "rulesFile",
            description: "Enable JSON5 rules and auto-layout overrides. When off, HyprTiles uses the plugin layout settings only.",
            inlineSetting: true
        },
        React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8 } },
            React.createElement(Switch, {
                checked: enabled,
                onChange: checked => {
                    setEnabled(checked);
                    setValue(checked);
                }
            }),
            React.createElement(
                Button,
                {
                    size: Button.Sizes.SMALL,
                    color: Button.Colors.PRIMARY,
                    disabled: opening || !IS_DISCORD_DESKTOP,
                    onClick: () => void openRulesFile()
                },
                "Open Rules File"
            )
        )
    );
}

type KeybindSettingDefinition = {
    type: OptionType.STRING;
    description: string;
    default: string;
    hidden: true;
};

const keybindSettings = Object.fromEntries(
    allActions.map(action => [
        getKeybindSettingKey(action),
        {
            type: OptionType.STRING,
            description: `${actionLabels[action]}.`,
            default: defaultKeybinds[action],
            hidden: true
        } satisfies KeybindSettingDefinition
    ])
) as Record<HyprTilesKeybindSetting, KeybindSettingDefinition>;

export const settings = definePluginSettings({
    defaultLayout: {
        type: OptionType.SELECT,
        description: "Default layout for new workspaces.",
        options: [
            { label: "Dwindle", value: "dwindle", default: true },
            { label: "Grid", value: "grid" },
            { label: "Columns", value: "columns" },
            { label: "Master (Legacy)", value: "master" }
        ]
    },
    workspaceCount: {
        type: OptionType.SELECT,
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
        type: OptionType.BOOLEAN,
        description: "Restore the active workspace on Discord reload.",
        default: true
    },
    allowDuplicateTargets: {
        type: OptionType.BOOLEAN,
        description: "Allow multiple tiles for the same channel or DM.",
        default: false
    },
    showHotkeyButton: {
        type: OptionType.BOOLEAN,
        description: "Show HyprTiles hotkey reference button in the header bar.",
        default: true
    },
    showTileHeaders: {
        type: OptionType.BOOLEAN,
        description: "Show tile headers with title and close button.",
        default: true
    },
    enableAnimations: {
        type: OptionType.BOOLEAN,
        description: "Animate tile movement and focus transitions.",
        default: true
    },
    enableRulesFile: {
        type: OptionType.COMPONENT,
        default: false,
        component: RulesFileControl
    },
    keybindEditor: {
        type: OptionType.COMPONENT,
        description: "Configure keyboard shortcuts.",
        component: KeybindEditor
    },
    gaps: {
        type: OptionType.SLIDER,
        description: "Gap size between tiles.",
        default: 8,
        markers: [0, 4, 8, 12, 16, 20, 24],
        stickToMarkers: true
    },
    // Premium Border Features
    enableBorders: {
        type: OptionType.BOOLEAN,
        description: "Enable custom border styling for tiles.",
        default: true
    },
    borderColor: {
        type: OptionType.STRING,
        description: "Primary border color (HEX).",
        default: "#7289da"
    },
    borderColorEnd: {
        type: OptionType.STRING,
        description: "Gradient end color (HEX).",
        default: "#5b6eae"
    },
    enableGradients: {
        type: OptionType.BOOLEAN,
        description: "Enable gradient borders.",
        default: true
    },
    gradientType: {
        type: OptionType.SELECT,
        description: "Gradient direction.",
        options: [
            { label: "Horizontal", value: "horizontal", default: true },
            { label: "Vertical", value: "vertical" },
            { label: "Diagonal", value: "diagonal" }
        ]
    },
    animatedBorder: {
        type: OptionType.BOOLEAN,
        description: "Animate gradient borders (flowing effect).",
        default: true
    },
    animationSpeed: {
        type: OptionType.SLIDER,
        description: "Animation speed (higher = faster).",
        default: 5,
        markers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        stickToMarkers: true
    },
    borderWidth: {
        type: OptionType.SLIDER,
        description: "Border width in pixels.",
        default: 3,
        markers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        stickToMarkers: true
    },
    showChannelName: {
        type: OptionType.BOOLEAN,
        description: "Show channel name in tile header.",
        default: true
    },
    ...keybindSettings
});
