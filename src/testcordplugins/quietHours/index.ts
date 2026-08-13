/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";

const logger = new Logger("QuietHours");

const settings = definePluginSettings({
    start: {
        type: OptionType.NUMBER,
        description: "Quiet hours start (24h hour, 0-23)",
        default: 23
    },
    end: {
        type: OptionType.NUMBER,
        description: "Quiet hours end (24h hour, 0-23)",
        default: 8
    }
});

function inQuietHours(): boolean {
    const h = new Date().getHours();
    const { start, end } = settings.store;
    // window may wrap past midnight (e.g. 23 -> 8)
    return start <= end ? (h >= start && h < end) : (h >= start || h < end);
}

let soundModule: any = null;
let originalPlaySound: any = null;

export default definePlugin({
    name: "QuietHours",
    description: "Silences notification sounds during a time window you set (e.g. 23:00–08:00). Visual notifications still show.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Utility"],
    settings,

    start() {
        try {
            soundModule = findByProps("playSound", "createSound");
            if (!soundModule?.playSound) return;
            originalPlaySound = soundModule.playSound;
            soundModule.playSound = function (...args: any[]) {
                if (inQuietHours()) return;
                return originalPlaySound.apply(soundModule, args);
            };
        } catch (e) {
            logger.error("Failed to hook playSound", e);
        }
    },

    stop() {
        if (soundModule && originalPlaySound) soundModule.playSound = originalPlaySound;
        soundModule = null;
        originalPlaySound = null;
    }
});
