/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { openTranslateModal } from "./TranslateModal";
export const settings = definePluginSettings({
    receivedInput: {
        type: 0 /* OptionType.STRING */,
        description: "Language incoming messages are translated from",
        default: "auto",
        hidden: true
    },
    receivedOutput: {
        type: 0 /* OptionType.STRING */,
        description: "Language incoming messages are translated to",
        default: "en",
        hidden: true
    },
    sentInput: {
        type: 0 /* OptionType.STRING */,
        description: "Language your messages are translated from",
        default: "auto",
        hidden: true
    },
    sentOutput: {
        type: 0 /* OptionType.STRING */,
        description: "Language your messages are translated to",
        default: "en",
        hidden: true
    },
    service: {
        type: 4 /* OptionType.SELECT */,
        description: IS_WEB ? "Translation provider (not available on web)" : "Translation provider",
        hidden: IS_WEB,
        options: [
            { label: "Google Translate", value: "google", default: true },
            { label: "DeepL Free - API key required", value: "deepl" },
            { label: "DeepL Pro - API key required", value: "deepl-pro" },
            { label: "Kagi Translate - API key required", value: "kagi" }
        ],
        onChange: resetLanguageDefaults
    },
    deeplApiKey: {
        type: 0 /* OptionType.STRING */,
        displayName: "DeepL API Key",
        description: "Your DeepL API key (from deepl.com/your-account)",
        default: ""
    },
    kagiSession: {
        type: 0 /* OptionType.STRING */,
        description: "Your Kagi session token (from kagi.com/settings?p=user_details)",
        default: ""
    },
    autoTranslate: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Automatically translate your messages before sending. You can also Shift+click or right-click the translate button to toggle this",
        default: false
    },
    showAutoTranslateTooltip: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a tooltip on the chat bar button when a message is auto-translated",
        default: true
    },
    manageTranslateSettings: {
        type: 6 /* OptionType.COMPONENT */,
        component: () => (<Button onClick={openTranslateModal}>
                Customize translation languages & Auto-Translate
            </Button>)
    }
}, {
    deeplApiKey: {
        hidden() { return this.store.service !== "deepl" && this.store.service !== "deepl-pro"; }
    },
    kagiSession: {
        hidden() { return this.store.service !== "kagi"; }
    }
}).withPrivateSettings();
export function resetLanguageDefaults() {
    if (IS_WEB || settings.store.service === "google" || settings.store.service === "kagi") {
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
