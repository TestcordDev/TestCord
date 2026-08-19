/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { addMessagePreSendListener, removeMessagePreSendListener, } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
const settings = definePluginSettings({
    autoCapitalization: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Auto Capitalization to the first letter",
    },
    autoPunctuation: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Auto Punctuation at the end of a sentence",
    },
    autoWordReplacement: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Auto Capitalizes the first letter",
    },
});
const getPresend = dictionary => {
    const presendObject = (_, msg) => {
        msg.content = msg.content.trim();
        if (!msg.content.includes("```") && /\w/.test(msg.content.charAt(0))) {
            if (settings.store.autoWordReplacement) {
                const re = new RegExp(`(^|(?<=[^A-Z0-9]+))(${Object.keys(dictionary)
                    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                    .join("|")})((?=[^A-Z0-9]+)|$)`, "gi");
                if (re !== null) {
                    msg.content = msg.content.replace(re, match => {
                        return dictionary[match.toLowerCase()] || match;
                    });
                }
            }
            if (settings.store.autoPunctuation) {
                if (/[A-Z0-9]/i.test(msg.content.charAt(msg.content.length - 1))) {
                    if (!msg.content.startsWith("http", msg.content.lastIndexOf(" ") + 1))
                        msg.content += ".";
                }
            }
            // Ensure sentences are capitalized after punctuation
            if (settings.store.autoCapitalization) {
                msg.content = msg.content.replace(/([.!?])\s*(\w)/g, match => match.toUpperCase());
                // Ensure the first character of the entire message is capitalized
                if (!msg.content.startsWith("http")) {
                    msg.content =
                        msg.content.charAt(0).toUpperCase() +
                            msg.content.slice(1);
                }
            }
        }
    };
    return presendObject;
};
export default definePlugin({
    name: "GrammarFix",
    description: "Automatic punctuation, capitalization and word replacement",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessageEventsAPI"],
    settings,
    _presendListener: null,
    _abortController: null,
    _generation: 0,
    async start() {
        const generation = ++this._generation;
        const abortController = new AbortController();
        this._abortController = abortController;
        try {
            const response = await fetch("https://raw.githubusercontent.com/wont-stream/dictionary/6b9d2f06a1d89103fb7249f41de4db6811e3d374/index.min.json", { signal: abortController.signal });
            const dictionary = await response.json();
            if (abortController.signal.aborted || generation !== this._generation)
                return;
            this._presendListener = getPresend(dictionary);
            addMessagePreSendListener(this._presendListener);
        }
        catch (e) {
            if (!abortController.signal.aborted)
                throw e;
        }
    },
    stop() {
        this._generation++;
        this._abortController?.abort();
        this._abortController = null;
        if (this._presendListener) {
            removeMessagePreSendListener(this._presendListener);
            this._presendListener = null;
        }
    },
});
