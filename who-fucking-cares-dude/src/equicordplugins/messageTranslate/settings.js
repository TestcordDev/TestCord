/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { makeRange } from "@utils/types";
export const settings = definePluginSettings({
    targetLanguage: {
        type: 0 /* OptionType.STRING */,
        description: "Target language code for translations (e.g. en, es, fr, de, ja).",
        default: "en",
    },
    excludedLanguages: {
        type: 0 /* OptionType.STRING */,
        description: "Language codes to exclude from translation (e.g. en, es, fr, de, ja).",
        default: "en",
    },
    confidenceRequirement: {
        type: 5 /* OptionType.SLIDER */,
        description: "Minimum confidence (0 to 1) required to show a translation.",
        markers: makeRange(0, 1, 0.1),
        default: 0.8,
    },
    autoTranslate: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Automatically translate messages as they appear.",
        default: true,
    },
    skipOwnMessages: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Do not translate your own messages.",
        default: true,
    },
    skipBotMessages: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Do not translate bot messages.",
        default: false,
    },
    ignoredGuilds: {
        type: 0 /* OptionType.STRING */,
        description: "Comma-separated list of server IDs to not translate in.",
        default: "",
    },
    ignoredChannels: {
        type: 0 /* OptionType.STRING */,
        description: "Comma-separated list of channel IDs to not translate in.",
        default: "",
    },
    ignoredUsers: {
        type: 0 /* OptionType.STRING */,
        description: "Comma-separated list of user IDs to not translate.",
        default: "",
    },
    showIndicator: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Append a small (translated) indicator to translated messages.",
        default: true,
    },
    showOriginal: {
        type: 4 /* OptionType.SELECT */,
        description: "Show the original and translated text.",
        options: [
            {
                label: "Don't show original.",
                value: "no-orig",
                default: true,
            },
            {
                label: "Show original in subtext",
                value: "orig-in-subtext",
            },
            {
                label: "Show original message, translation in subtext",
                value: "trans-in-subtext",
            },
        ]
    },
});
function parseList(value) {
    return new Set(value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
}
export function getExcludedLanguages() {
    return parseList(settings.store.excludedLanguages);
}
export function getIgnoredGuilds() {
    return parseList(settings.store.ignoredGuilds);
}
export function getIgnoredChannels() {
    return parseList(settings.store.ignoredChannels);
}
export function getIgnoredUsers() {
    return parseList(settings.store.ignoredUsers);
}
