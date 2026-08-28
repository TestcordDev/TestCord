/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import {
    activateHints,
    deactivateHints,
    handleHintKey,
    scrollChannelHistory,
    scrollChat } from "./hintEngine";

export const settings = definePluginSettings({
    hintKey: {
        description: "Key to toggle link hints (Vimium style)",
        type: OptionType.STRING,
        default: "f"
    },
    hintCharacters: {
        description: "Characters used to generate hint labels",
        type: OptionType.STRING,
        default: "sadfjklewcmpgh"
    },
    hintMode: {
        description: "Action performed when a hint is activated",
        type: OptionType.SELECT,
        options: [
            { label: "Click", value: "click", default: true },
            { label: "Hover", value: "hover" }
        ]
    },
    scrollDownKey: {
        description: "Key to scroll the chat down",
        type: OptionType.STRING,
        default: "j"
    },
    scrollUpKey: {
        description: "Key to scroll the chat up",
        type: OptionType.STRING,
        default: "k"
    },
    scrollAmount: {
        description: "Pixels scrolled per keypress",
        type: OptionType.NUMBER,
        default: 300
    },
    enableChannelNav: {
        description: "Use h/l to navigate back/forward through channel history",
        type: OptionType.BOOLEAN,
        default: false
    },
    channelBackKey: {
        description: "Key for previous channel",
        type: OptionType.STRING,
        default: "h"
    },
    channelForwardKey: {
        description: "Key for next channel",
        type: OptionType.STRING,
        default: "l"
    },
    disableWhileTyping: {
        description: "Disable all shortcuts while typing in inputs or the message box",
        type: OptionType.BOOLEAN,
        default: true
    }
});

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest("input, textarea, [contenteditable='true'], [role='textbox']") !== null;
}

export default definePlugin({
    name: "Vimium",
    description: "Vimium-like keyboard navigation: press f to overlay letter hints on every clickable element, j/k to scroll, h/l to move between channels.",
    tags: ["Utility", "Shortcuts", "Accessibility"],
    authors: [TestcordDevs.sirphantom89],
    settings,

    start() {
        document.addEventListener("keydown", this.onKeydown as EventListener, true);
        window.addEventListener("blur", this.onBlur);
    },

    stop() {
        document.removeEventListener("keydown", this.onKeydown as EventListener, true);
        window.removeEventListener("blur", this.onBlur);
        deactivateHints();
    },

    onBlur() {
        deactivateHints();
    },

    onKeydown(e: KeyboardEvent) {
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        if (handleHintKey(e)) return;

        if (e.key === "Escape") {
            const typingEl = (e.target instanceof Element
                ? e.target.closest<HTMLElement>("input, textarea, [contenteditable='true'], [role='textbox']")
                : null) ?? (isTypingTarget(document.activeElement) ? (document.activeElement as HTMLElement) : null);

            if (typingEl) {
                typingEl.blur();
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }

        if (settings.store.disableWhileTyping && isTypingTarget(e.target)) return;

        const key = e.key.toLowerCase();

        if (key === settings.store.hintKey.toLowerCase()) {
            e.preventDefault();
            e.stopPropagation();
            activateHints({
                chars: settings.store.hintCharacters,
                mode: settings.store.hintMode as "click" | "hover"
            });
            return;
        }

        if (key === settings.store.scrollDownKey.toLowerCase()) {
            e.preventDefault();
            e.stopPropagation();
            scrollChat(settings.store.scrollAmount, 1);
            return;
        }

        if (key === settings.store.scrollUpKey.toLowerCase()) {
            e.preventDefault();
            e.stopPropagation();
            scrollChat(settings.store.scrollAmount, -1);
            return;
        }

        if (!settings.store.enableChannelNav) return;

        if (key === settings.store.channelBackKey.toLowerCase()) {
            e.preventDefault();
            e.stopPropagation();
            scrollChannelHistory(-1);
            return;
        }

        if (key === settings.store.channelForwardKey.toLowerCase()) {
            e.preventDefault();
            e.stopPropagation();
            scrollChannelHistory(1);
        }
    }
});
