/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const settings = definePluginSettings({
    renderType: {
        type: 4 /* OptionType.SELECT */,
        description: "How to render colors",
        options: [
            {
                label: "Text color",
                value: 1 /* RenderType.FOREGROUND */,
                default: true,
            },
            {
                label: "Block nearby",
                value: 0 /* RenderType.BLOCK */,
            },
            {
                label: "Background color",
                value: 2 /* RenderType.BACKGROUND */
            },
        ]
    },
    enableShortHexCodes: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable 3 char hex-code like #39f",
        default: true,
        // Regex are created on the start, so without restart nothing would change
        restartNeeded: true
    },
    blockView: {
        type: 4 /* OptionType.SELECT */,
        disabled: () => settings.store.renderType !== 0 /* RenderType.BLOCK */,
        description: "Where to display colored block",
        options: [
            {
                label: "Right side",
                value: 1 /* BlockDisplayType.RIGHT */,
                default: true
            },
            {
                label: "Left side",
                value: 0 /* BlockDisplayType.LEFT */
            },
            {
                label: "Both sides",
                value: 2 /* BlockDisplayType.BOTH */
            }
        ]
    }
});
// It's sooo hard to read regex without this, it makes it at least somewhat bearable
export const replaceRegexp = (reg) => {
    const n = new RegExp(reg
        // \c - 'comma'
        // \v - 'value'
        // \f - 'float'
        .replaceAll("\\f", "[+-]?([0-9]*[.])?[0-9]+")
        .replaceAll("\\c", "(?:,|\\s)")
        .replaceAll("\\v", "\\s*?\\d+?\\s*?"), "g");
    return n;
};
export const regex = [
    { reg: /rgb\(\v\c\v\c\v\)/g, type: 0 /* ColorType.RGB */ },
    { reg: /rgba\(\v\c\v\c\v(\c|\/?)\s*\f\)/g, type: 1 /* ColorType.RGBA */ },
    { reg: /hsl\(\v°?\c\s*?\d+%?\s*?\c\s*?\d+%?\s*?\)/g, type: 3 /* ColorType.HSL */ },
].map(v => { v.reg = replaceRegexp(v.reg.source); return v; });
