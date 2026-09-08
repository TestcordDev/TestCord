/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { migratePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { defineModuleSettings } from "../../moduleSettings";
import { FormatSetting } from ".";

migratePluginSettings("discordDevBanner", "DiscordDevBanner", "devBanner");

export const settings = defineModuleSettings("discordDevBanner", {
    format: {
        component: ({ setValue }) => FormatSetting(setValue),
        type: OptionType.COMPONENT,
        default: "{testcordIcon} Testcord {testcordVersion} ({testcordHash})",
        restartNeeded: true
    },
    color: {
        type: OptionType.STRING,
        description: "Text color for the Developer Banner",
        default: "var(--text-muted)",
    },
    backgroundColor: {
        type: OptionType.STRING,
        description: "Background color for the Developer Banner",
        default: "",
    },
    fontSize: {
        type: OptionType.SLIDER,
        description: "Font size in pixels",
        default: 11,
        markers: [9, 10, 11, 12, 13, 14, 15, 16],
    },
    textAlign: {
        type: OptionType.SELECT,
        description: "Text alignment",
        options: [
            { label: "Center", value: "center", default: true },
            { label: "Left", value: "left" },
            { label: "Right", value: "right" },
        ],
    },
});

export const names: Record<string, string> = {
    stable: "Stable",
    ptb: "PTB",
    canary: "Canary",
    staging: "Staging"
};

export const settingVariables = [
    "Discord Variables:",
    "{discordIcon} - Discord icon",
    "{devbannerIcon} - Dev banner icon",
    "{buildChannel} - Discord build channel (e.g. Stable)",
    "{buildNumber} - Discord build number (e.g. 123456)",
    "{buildHash} - Discord build hash (e.g. 123456789)",
    "",
    "Testcord Variables:",
    "{testcordIcon} - Testcord icon",
    "{testcordName} - Testcord name (Testcord)",
    "{testcordVersion} - Version of Testcord (e.g. 1.0.0)",
    "{testcordHash} - Testcord build hash (e.g. 123456789)",
    "{testcordPlatform} - Platform Testcord is running on (e.g. Dev Build)",
    "",
    "Equibop Specific Variables:",
    "{equibopHash} - Equibop build hash (e.g. 123456789)",
    "{equibopPlatform} - Platform Equibop is running on (e.g. Dev Build)",
    "",
    "Client Variables:",
    "{clientIcon} - Desktop icon",
    "{clientName} - The name of your current client",
    "{clientVersion} - Version of your client (e.g. 1.0.0)",
    "",
    "Electron Variables:",
    "{electronIcon} - Electron icon",
    "{electronVersion} - Electron runtime version (e.g. 25.0.0)",
    "",
    "Chromium Variables:",
    "{chromiumIcon} - Chromium icon",
    "{chromiumVersion} - Chromium engine version (e.g. 125.0.0.0)",
    "",
    "Miscellaneous Variables:",
    "{newline} or \\n - Newline character",
    "",
];
