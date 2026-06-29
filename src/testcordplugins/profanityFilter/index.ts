/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { escapeRegExp } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import { Toasts } from "@webpack/common";

let wordRegexes: RegExp[] = [];

function compileWords(words: string) {
    wordRegexes = words
        .split(/[\n,]/)
        .map(w => w.trim())
        .filter(Boolean)
        .map(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi"));
}

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Filter outgoing messages (Ctrl+Alt+P toggles this anywhere)",
        default: true
    },
    words: {
        type: OptionType.STRING,
        description: "Words to filter, separated by commas or newlines. Strict whole-word, case-insensitive; combined words (e.g. \"fuckass\") are never matched.",
        default: "",
        onChange: compileWords
    },
    duckOnEmpty: {
        type: OptionType.BOOLEAN,
        description: "Send :duck: when filtering empties a message. Off: an emptied message sends nothing (and never sends a duck alongside attachments).",
        default: true
    }
});

function filter(content: string): string {
    if (wordRegexes.length === 0) return content;

    let result = content;
    for (const regex of wordRegexes) {
        result = result.replace(regex, "");
    }

    return result
        .replace(/[ \t]{2,}/g, " ") // collapse runs of spaces left by removal
        .replace(/\s+([,.!?;:])/g, "$1") // drop space before punctuation
        .trim();
}

function toggleHandler(e: KeyboardEvent) {
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === "KeyP") {
        e.preventDefault();
        settings.store.enabled = !settings.store.enabled;
        Toasts.show({
            message: `Profanity filter: ${settings.store.enabled ? "ON" : "OFF"}`,
            id: Toasts.genId(),
            type: settings.store.enabled ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
        });
    }
}

export default definePlugin({
    name: "ProfanityFilter",
    description: "Strictly removes user-defined words from outgoing messages (whole-word only). Sends :duck: if filtering empties the message.",
    authors: [
        TestcordDevs.sirphantom89,
        { name: "Nepotaku", id: 765468887852515370n }
    ],
    dependencies: ["MessageEventsAPI"],
    tags: ["Utility"],
    settings,

    start() {
        compileWords(settings.store.words);
        document.addEventListener("keydown", toggleHandler);
    },

    stop() {
        document.removeEventListener("keydown", toggleHandler);
    },

    onBeforeMessageSend(_, msg) {
        if (!settings.store.enabled || typeof msg.content !== "string") return;
        const filtered = filter(msg.content);
        const wasFiltered = filtered !== msg.content;

        // No text left (filtered away, or never typed): send a duck if enabled.
        // This fires even on a bare image with an empty caption.
        if (filtered.length === 0) {
            if (settings.store.duckOnEmpty) msg.content = ":duck:";
        } else {
            msg.content = filtered;
        }

        if (wasFiltered) {
            Toasts.show({
                message: "Filtered profanity from message",
                id: Toasts.genId(),
                type: Toasts.Type.MESSAGE
            });
        }
    }
});
