/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { addMessagePreSendListener, removeMessagePreSendListener, } from "@api/MessageEvents";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
const settings = definePluginSettings({
    enabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Abbreviation plugin",
        default: true,
    },
    showNotifications: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show notifications during expansion",
        default: false,
    },
    caseSensitive: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Respect abbreviation case",
        default: false,
    },
    debugMode: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Debug mode (detailed logs)",
        default: false,
    },
    toggleKeybind: {
        type: 0 /* OptionType.STRING */,
        description: "Keyboard shortcut to enable/disable the plugin (e.g: ctrl+shift+a)",
        default: "ctrl+shift+a",
    },
    showToggleNotification: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a notification when toggling via keybind",
        default: true,
    },
    abbreviations: {
        type: 0 /* OptionType.STRING */,
        description: "Abbreviations (format: abbrev1=full text1|abbrev2=full text2)",
        default: "btw=by the way|omg=oh my god|brb=be right back|afk=away from keyboard|imo=in my opinion|tbh=to be honest|lol=laughing out loud|wtf=what the f*ck|nvm=never mind|thx=thanks|pls=please|u=you|ur=your|bc=because|rn=right now|irl=in real life|fyi=for your information|asap=as soon as possible|ttyl=talk to you later|gtg=got to go|idk=I don't know|ikr=I know right|smh=shaking my head|dm=direct message|gm=good morning|gn=good night|gl=good luck|hf=have fun|wp=well played|gg=good game|ez=easy|op=overpowered|nerf=reduce power|buff=increase power|meta=most effective tactics available",
    },
    customAbbreviations: {
        type: 0 /* OptionType.STRING */,
        description: "Custom abbreviations (same format as above)",
        default: "",
    },
});
// Plugin state (can be different from setting for temporary toggle)
let isPluginActive = true;
// Log function with prefix
function log(message, level = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[Abbreviation ${timestamp}]`;
    switch (level) {
        case "warn":
            console.warn(prefix, message);
            break;
        case "error":
            console.error(prefix, message);
            break;
        default:
            console.log(prefix, message);
    }
}
// Debug log
function debugLog(message) {
    if (settings.store.debugMode) {
        log(`🔍 ${message}`, "info");
    }
}
// Function to parse a keybind
function parseKeybind(keybind) {
    const parts = keybind.toLowerCase().split("+");
    const result = {
        ctrl: false,
        shift: false,
        alt: false,
        key: "",
    };
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed === "ctrl" || trimmed === "control") {
            result.ctrl = true;
        }
        else if (trimmed === "shift") {
            result.shift = true;
        }
        else if (trimmed === "alt") {
            result.alt = true;
        }
        else {
            result.key = trimmed;
        }
    }
    return result;
}
// Function to toggle plugin state
function togglePlugin() {
    isPluginActive = !isPluginActive;
    const status = isPluginActive ? "enabled" : "disabled";
    const emoji = isPluginActive ? "✅" : "❌";
    log(`${emoji} Plugin ${status} via keybind`);
    if (settings.store.showToggleNotification) {
        showNotification({
            title: `${emoji} Abbreviation ${status}`,
            body: isPluginActive
                ? "Abbreviations will be expanded"
                : "Abbreviations will no longer be expanded",
            icon: undefined,
        });
    }
}
// Keyboard event handler
function handleKeyDown(event) {
    const keybind = parseKeybind(settings.store.toggleKeybind);
    // Check if the keybind matches
    if (event.ctrlKey === keybind.ctrl &&
        event.shiftKey === keybind.shift &&
        event.altKey === keybind.alt &&
        event.key.toLowerCase() === keybind.key) {
        event.preventDefault();
        event.stopPropagation();
        togglePlugin();
    }
}
// Abbreviation parser
function parseAbbreviations(abbreviationsString) {
    const abbrevMap = new Map();
    if (!abbreviationsString.trim())
        return abbrevMap;
    const pairs = abbreviationsString.split("|");
    for (const pair of pairs) {
        const [abbrev, expansion] = pair.split("=");
        if (abbrev && expansion) {
            const key = settings.store.caseSensitive
                ? abbrev.trim()
                : abbrev.trim().toLowerCase();
            abbrevMap.set(key, expansion.trim());
        }
    }
    return abbrevMap;
}
// Function to get all abbreviations
function getAllAbbreviations() {
    const defaultAbbrevs = parseAbbreviations(settings.store.abbreviations);
    const customAbbrevs = parseAbbreviations(settings.store.customAbbreviations);
    // Merge the two maps (custom ones have priority)
    const combined = new Map([...defaultAbbrevs, ...customAbbrevs]);
    return combined;
}
// Function to expand abbreviations in text
function expandAbbreviations(text) {
    if (!text.trim()) {
        return { newText: text, expansions: [] };
    }
    const abbreviations = getAllAbbreviations();
    const expansions = [];
    // Split text into words, preserving spaces and punctuation
    const words = text.split(/(\s+)/);
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        // Ignore spaces
        if (/^\s+$/.test(word))
            continue;
        // Extract word without punctuation for verification
        const cleanWord = word.replace(/[^\w]/g, "");
        if (!cleanWord)
            continue;
        // Check if it's an abbreviation
        const searchKey = settings.store.caseSensitive
            ? cleanWord
            : cleanWord.toLowerCase();
        const expansion = abbreviations.get(searchKey);
        if (expansion) {
            // Preserve original punctuation
            const punctuation = word.replace(cleanWord, "");
            words[i] = expansion + punctuation;
            expansions.push({
                abbrev: cleanWord,
                expansion: expansion,
            });
            debugLog(`Expansion found: "${cleanWord}" → "${expansion}"`);
        }
    }
    return {
        newText: words.join(""),
        expansions: expansions,
    };
}
// Listener for messages before sending
const messagePreSendListener = (channelId, messageObj, extra) => {
    // Check if plugin is enabled (global state AND temporary state)
    if (!settings.store.enabled || !isPluginActive) {
        return;
    }
    const originalContent = messageObj.content;
    if (!originalContent || !originalContent.trim()) {
        return;
    }
    const { newText, expansions } = expandAbbreviations(originalContent);
    if (expansions.length > 0) {
        messageObj.content = newText;
        log(`✨ ${expansions.length} expansion(s) performed`);
        for (const { abbrev, expansion } of expansions) {
            log(`   "${abbrev}" → "${expansion}"`);
        }
        if (settings.store.showNotifications) {
            const expansionText = expansions
                .map(e => `"${e.abbrev}" → "${e.expansion}"`)
                .join(", ");
            showNotification({
                title: "📝 Abbreviation",
                body: `Expansions: ${expansionText}`,
                icon: undefined,
            });
        }
    }
};
export default definePlugin({
    name: "Abbreviation",
    description: "Automatically transforms abbreviations into full text when sending messages",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessageEventsAPI"],
    settings,
    start() {
        log("🚀 Abbreviation plugin started");
        // Reset active state
        isPluginActive = settings.store.enabled;
        const abbreviations = getAllAbbreviations();
        log(`📚 ${abbreviations.size} abbreviations loaded`);
        log(`⌨️ Keybind configured: ${settings.store.toggleKeybind}`);
        // Add listener for messages before sending
        addMessagePreSendListener(messagePreSendListener);
        // Add listener for keyboard events
        document.addEventListener("keydown", handleKeyDown, true);
        debugLog(`Debug mode: ${settings.store.debugMode ? "ENABLED" : "DISABLED"}`);
        if (settings.store.showNotifications) {
            showNotification({
                title: "📝 Abbreviation enabled",
                body: `${abbreviations.size} abbreviations available. Toggle: ${settings.store.toggleKeybind}`,
                icon: undefined,
            });
        }
    },
    stop() {
        log("🛑 Abbreviation plugin stopped");
        // Remove listeners
        removeMessagePreSendListener(messagePreSendListener);
        document.removeEventListener("keydown", handleKeyDown, true);
        if (settings.store.showNotifications) {
            showNotification({
                title: "📝 Abbreviation disabled",
                body: "Plugin stopped",
                icon: undefined,
            });
        }
    },
});
