/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export var QuoteFont;
(function (QuoteFont) {
    QuoteFont["MPlusRounded"] = "M PLUS Rounded 1c";
    QuoteFont["OpenSans"] = "Open Sans";
    QuoteFont["MomoSignature"] = "Momo Signature";
    QuoteFont["Lora"] = "Lora";
    QuoteFont["Merriweather"] = "Merriweather";
})(QuoteFont || (QuoteFont = {}));
export const CANVAS_CONFIG = {
    width: 1200,
    height: 600,
    quoteAreaWidth: 520,
    quoteAreaX: 640,
    maxContentHeight: 480
};
export const FONT_SIZES = {
    initial: 42,
    minimum: 18,
    decrement: 2,
    lineHeightMultiplier: 1.25,
    authorMultiplier: 0.60,
    usernameMultiplier: 0.45,
    authorMinimum: 22,
    usernameMinimum: 18,
    watermark: 18
};
export const SPACING = {
    authorTop: 60,
    username: 10,
    gradientStart: 200,
    gradientWidth: 400,
    watermarkPadding: 20
};
