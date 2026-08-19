/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { addMessagePreEditListener, addMessagePreSendListener, removeMessagePreEditListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { showToast, Toasts } from "@webpack/common";
const settings = definePluginSettings({
    sanitizeOutgoing: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Sanitize outgoing messages (before sending)",
        default: true
    },
    sanitizeEdits: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Sanitize edited messages too",
        default: true
    },
    showToastOnDetection: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a notification when invisible characters are detected",
        default: true
    },
    verboseLogs: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show detailed logs in console",
        default: false
    }
});
// Tutti i caratteri invisibili usati per fingerprinting
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\u200E\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u00AD]/g;
function log(message) {
    if (!settings.store.verboseLogs)
        return;
    console.log(`[ZeroWidthSanitizer] ${message}`);
}
function sanitize(text) {
    INVISIBLE_CHARS_REGEX.lastIndex = 0;
    const found = INVISIBLE_CHARS_REGEX.test(text);
    INVISIBLE_CHARS_REGEX.lastIndex = 0;
    const result = found ? text.replace(INVISIBLE_CHARS_REGEX, "") : text;
    return { result, found };
}
let preSendListener = null;
let preEditListener = null;
export default definePlugin({
    name: "ZeroWidthSanitizer",
    description: "Removes invisible zero-width characters from messages to prevent fingerprinting and tracking",
    tags: ["Chat", "Utility"],
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,
    // Richiede l'API MessageEvents
    dependencies: ["MessageEventsAPI"],
    start() {
        // Listener per i messaggi in uscita
        preSendListener = (channelId, messageObj) => {
            if (!settings.store.sanitizeOutgoing)
                return;
            if (typeof messageObj.content !== "string")
                return;
            const { result, found } = sanitize(messageObj.content);
            if (found) {
                messageObj.content = result;
                log(`Removed invisible characters from outgoing message in channel ${channelId}`);
                if (settings.store.showToastOnDetection) {
                    showToast("ZeroWidthSanitizer: tracking characters removed from your message", Toasts.Type.MESSAGE);
                }
            }
        };
        // Listener per i messaggi modificati
        preEditListener = (channelId, messageId, messageObj) => {
            if (!settings.store.sanitizeEdits)
                return;
            if (typeof messageObj.content !== "string")
                return;
            const { result, found } = sanitize(messageObj.content);
            if (found) {
                messageObj.content = result;
                log(`Removed invisible characters from edited message ${messageId}`);
                if (settings.store.showToastOnDetection) {
                    showToast("ZeroWidthSanitizer: tracking characters removed from your edit", Toasts.Type.MESSAGE);
                }
            }
        };
        addMessagePreSendListener(preSendListener);
        addMessagePreEditListener(preEditListener);
        log("Plugin started");
        showToast("ZeroWidthSanitizer active", Toasts.Type.SUCCESS);
    },
    stop() {
        if (preSendListener) {
            removeMessagePreSendListener(preSendListener);
            preSendListener = null;
        }
        if (preEditListener) {
            removeMessagePreEditListener(preEditListener);
            preEditListener = null;
        }
        log("Plugin stopped");
    }
});
