/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";

export const ICON_COLOR_FALLBACK = "#b5bac1";

export const IconColorSettings = {
    userAreaButtonIconColor: {
        label: "User area buttons",
        description: "Default icon color for buttons next to mute, deafen, and settings."
    },
    chatBoxButtonIconColor: {
        label: "Chatbox buttons",
        description: "Default icon color for plugin buttons in the chat input."
    },
    topBarButtonIconColor: {
        label: "Top bar buttons",
        description: "Default icon color for plugin buttons in Discord's top title bar."
    },
    headerBarButtonIconColor: {
        label: "Header bar buttons",
        description: "Default icon color for plugin buttons in channel headers."
    }
} as const;

export type IconColorSettingKey = keyof typeof IconColorSettings;

export function normalizeIconColor(value: unknown) {
    if (typeof value !== "string") return undefined;

    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;

    const match = /^#?([\da-f]{6})$/i.exec(trimmed);
    return match ? `#${match[1].toLowerCase()}` : undefined;
}

export function isIconColorInputValid(value: unknown) {
    return typeof value === "string" && (value.trim().length === 0 || normalizeIconColor(value) != null)
        || "Enter a hex color like #b5bac1.";
}

export function hexToInt(value: string) {
    const normalized = normalizeIconColor(value);
    return normalized ? parseInt(normalized.slice(1), 16) : undefined;
}

export function intToHex(value: number) {
    return `#${value.toString(16).padStart(6, "0")}`;
}

let cachedKey: IconColorSettingKey | "" = "";
let cachedRaw: unknown = undefined;
let cachedResult: string | undefined = undefined;

export function getTestcordIconColor(key: IconColorSettingKey) {
    const raw = Settings.plugins.TestcordHelper?.[key];
    if (key === cachedKey && raw === cachedRaw) return cachedResult;
    cachedKey = key;
    cachedRaw = raw;
    cachedResult = normalizeIconColor(raw);
    return cachedResult;
}
