/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const settings = definePluginSettings({
    style: {
        type: 4 /* OptionType.SELECT */,
        description: "macOS cursor style",
        options: [
            { label: "Modern with shadow (Sierra+)", value: "modern_shadow", default: true },
            { label: "Modern without shadow (Sierra+)", value: "modern_no_shadow" },
            { label: "Classic with shadow (El Capitan)", value: "classic_shadow" },
            { label: "Classic without shadow (El Capitan)", value: "classic_no_shadow" },
        ]
    },
    size: {
        type: 4 /* OptionType.SELECT */,
        description: "Cursor size",
        options: [
            { label: "Normal", value: "normal", default: true },
            { label: "Large", value: "large" },
            { label: "Extra Large", value: "xl" }
        ]
    }
});
