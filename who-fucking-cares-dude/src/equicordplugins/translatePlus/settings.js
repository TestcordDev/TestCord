/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const settings = definePluginSettings({
    target: {
        type: 0 /* OptionType.STRING */,
        description: "Target language",
        default: "en",
        restartNeeded: true
    },
    toki: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Toki Pona",
        default: true,
        restartNeeded: true
    },
    sitelen: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Sitelen Pona",
        default: true,
        restartNeeded: true
    },
    shavian: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Shavian",
        default: true,
        restartNeeded: true
    }
});
