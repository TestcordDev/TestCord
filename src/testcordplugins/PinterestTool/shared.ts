/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * Pinterest Tool modifications Copyright (c) 2026 szaleniec1327
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@utils/css";
import { makeRange, OptionType, PluginNative } from "@utils/types";

export type SearchTarget = "IMAGE" | "ALL" | "AVATAR" | "BANNER";
export type SearchKind = Exclude<SearchTarget, "ALL">;
export type MediaFilter = "ALL" | "GIFS" | "STATIC";


export const PINTEREST_THEMES = [
    { label: "Pinterest", value: "pinterest", accent: "#e60023", accentHover: "#ff2446", soft: "rgba(230, 0, 35, .16)" },
    { label: "Blurple", value: "blurple", accent: "#5865f2", accentHover: "#7380ff", soft: "rgba(88, 101, 242, .18)" },
    { label: "Violet", value: "violet", accent: "#8b5cf6", accentHover: "#a179ff", soft: "rgba(139, 92, 246, .18)" },
    { label: "Cyan", value: "cyan", accent: "#0891b2", accentHover: "#06b6d4", soft: "rgba(8, 145, 178, .18)" },
    { label: "Emerald", value: "emerald", accent: "#059669", accentHover: "#10b981", soft: "rgba(5, 150, 105, .18)" }
] as const;

export type PinterestTheme = typeof PINTEREST_THEMES[number]["value"] | "custom";

function normalizeHexColor(value: string) {
    const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    return match ? `#${match[1].toLowerCase()}` : "#f59e0b";
}

function hexToRgb(hex: string) {
    const normalized = normalizeHexColor(hex).slice(1);
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    };
}

function mixWithWhite(hex: string, amount = 0.18) {
    const { r, g, b } = hexToRgb(hex);
    const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function getContrastText(hex: string) {
    const { r, g, b } = hexToRgb(hex);
    // YIQ gives a predictable UI contrast choice for very light custom colours.
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 165 ? "#111214" : "#ffffff";
}

export function getPinterestThemeStyle(theme: PinterestTheme, customAccent = "#f59e0b") {
    if (theme === "custom") {
        const accent = normalizeHexColor(customAccent);
        const { r, g, b } = hexToRgb(accent);

        return {
            "--pt-accent": accent,
            "--pt-accent-hover": mixWithWhite(accent),
            "--pt-accent-soft": `rgba(${r}, ${g}, ${b}, .18)`,
            "--pt-accent-contrast": getContrastText(accent)
        } as Record<string, string>;
    }

    const selected = PINTEREST_THEMES.find(option => option.value === theme) ?? PINTEREST_THEMES[0];
    return {
        "--pt-accent": selected.accent,
        "--pt-accent-hover": selected.accentHover,
        "--pt-accent-soft": selected.soft,
        "--pt-accent-contrast": getContrastText(selected.accent)
    } as Record<string, string>;
}

export interface PinterestGuide {
    label: string;
    query: string;
}

export interface PinterestImageResult {
    id: string;
    title: string;
    description: string;
    url: string;
    width: number;
    height: number;
    dominantColor: string | null;
    pinterestUrl: string | null;
    isGif: boolean;
}

export interface PinterestSearchPayload {
    query: string;
    guides: PinterestGuide[];
    results: PinterestImageResult[];
    bookmark: string[] | null;
}

export interface NativeMediaResult {
    data: ArrayBuffer;
    dataUrl: string;
    type: string;
    filename: string;
}

export interface SearchBucketState {
    data: PinterestSearchPayload | null;
    activeQuery: string;
    bookmark: string[] | null;
    page: number;
    loadingNextPage: boolean;
    error: string;
}

export interface PinterestPickerProps {
    onSelectItem: (item: { url: string; }) => void;
}

export interface ManaSearchBarProps {
    autoFocus?: boolean;
    placeholder?: string;
    query?: string;
    onChange?: (query: string) => void;
    onClear?: () => void;
}

export const cl = classNameFactory("vc-pinterest-tool-");

export const settings = definePluginSettings({
    // Kept internally for compatibility with existing saved settings, but the
    // profile picker now intentionally uses fixed page sizes (8 avatars / 4 banners).
    avatarSlots: {
        type: OptionType.SLIDER,
        description: "Legacy avatar results-per-page setting",
        markers: makeRange(1, 12),
        default: 8,
        hidden: true
    },
    bannerSlots: {
        type: OptionType.SLIDER,
        description: "Legacy banner results-per-page setting",
        markers: makeRange(1, 6),
        default: 2,
        hidden: true
    },
    colorTheme: {
        type: OptionType.SELECT,
        description: "Color theme used by Pinterest Tool",
        options: [
            ...PINTEREST_THEMES.map(theme => ({
                label: theme.label,
                value: theme.value,
                default: theme.value === "pinterest"
            })),
            {
                label: "Custom",
                value: "custom"
            }
        ]
    },
    customAccent: {
        type: OptionType.STRING,
        description: "Custom Pinterest Tool accent color (hex)",
        default: "#f59e0b",
        placeholder: "#f59e0b"
    },
    editBeforeApply: {
        type: OptionType.BOOLEAN,
        description: "Open Discord's image editor before applying a Pinterest avatar or banner",
        default: true
    }
});

export const Native = VencordNative.pluginHelpers["Pinterest Tool"] as PluginNative<typeof import("./native")>;
