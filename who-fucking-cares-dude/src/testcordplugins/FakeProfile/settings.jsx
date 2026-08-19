/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const settings = definePluginSettings({
    enableProfileEffects: {
        description: "Allows you to use profile effects",
        type: 3 /* OptionType.BOOLEAN */,
        default: true
    },
    enableNameplate: {
        description: "Allows you to use nameplates",
        type: 3 /* OptionType.BOOLEAN */,
        default: true
    },
    enableProfileThemes: {
        description: "Allows you to use profile themes",
        type: 3 /* OptionType.BOOLEAN */,
        default: true
    },
    enableCustomBadges: {
        description: "Allows you to use custom badges",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        restartNeeded: true
    },
    enableAvatarDecorations: {
        description: "Allows you to use discord avatar decorations",
        type: 3 /* OptionType.BOOLEAN */,
        default: true
    },
    nitroFirst: {
        description: "Banner/Avatar to use if both Nitro and fakeProfile Banner/Avatar are present",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "Nitro", value: true, default: true },
            { label: "fakeProfile", value: false },
        ]
    },
    voiceBackground: {
        description: "Use fakeProfile banners as voice chat backgrounds",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        restartNeeded: true
    },
    fakeStatusEnabled: {
        description: "Show a fake custom status instead of your real one",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
    },
    fakeStatusText: {
        description: "Custom status text",
        type: 0 /* OptionType.STRING */,
        default: "",
    },
    fakeStatusEmojiId: {
        description: "Discord emoji ID (numbers only)",
        type: 0 /* OptionType.STRING */,
        default: "",
    },
    fakeStatusEmojiName: {
        description: "Discord emoji name (e.g. thonk)",
        type: 0 /* OptionType.STRING */,
        default: "",
    },
    fakeStatusEmojiAnimated: {
        description: "Whether the emoji is animated",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
    },
});
