/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const settings = definePluginSettings({
    receivedInput: {
        type: 0 /* OptionType.STRING */,
        description: "Language that received messages should be translated from",
        default: "auto",
        hidden: true
    },
    receivedOutput: {
        type: 0 /* OptionType.STRING */,
        description: "Language that received messages should be translated to",
        default: "en",
        hidden: true
    },
    sentInput: {
        type: 0 /* OptionType.STRING */,
        description: "Language that your own messages should be translated from",
        default: "auto",
        hidden: true
    },
    sentOutput: {
        type: 0 /* OptionType.STRING */,
        description: "Language that your own messages should be translated to",
        default: "en",
        hidden: true
    },
    service: {
        type: 4 /* OptionType.SELECT */,
        description: IS_WEB ? "Translation service (Not supported on Web!)" : "Translation service",
        disabled: () => IS_WEB,
        options: [
            { label: "Google Translate", value: "google", default: true },
            { label: "DeepL Free", value: "deepl" },
            { label: "DeepL Pro", value: "deepl-pro" }
        ],
        onChange: resetLanguageDefaults
    },
    deeplApiKey: {
        type: 0 /* OptionType.STRING */,
        description: "DeepL API key",
        default: "",
        placeholder: "Get your API key from https://deepl.com/your-account",
        disabled: () => IS_WEB
    },
    autoTranslate: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Automatically translate your messages before sending",
        default: false
    },
    showAutoTranslateTooltip: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a tooltip on the ChatBar button whenever a message is automatically translated",
        default: true
    }
}).withPrivateSettings();
export function resetLanguageDefaults() {
    if (IS_WEB || settings.store.service === "google") {
        settings.store.receivedInput = "auto";
        settings.store.receivedOutput = "en";
        settings.store.sentInput = "auto";
        settings.store.sentOutput = "en";
    }
    else {
        settings.store.receivedInput = "";
        settings.store.receivedOutput = "en-us";
        settings.store.sentInput = "";
        settings.store.sentOutput = "en-us";
    }
}
