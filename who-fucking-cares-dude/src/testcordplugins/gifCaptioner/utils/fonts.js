/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Load a font from a data URL or URL
export async function addFont(fontData, fontFamily) {
    try {
        let fontSource;
        if (typeof fontData === "string") {
            fontSource = fontData;
        }
        else {
            // Convert ArrayBuffer to data URL
            const blob = new Blob([fontData], { type: "font/otf" });
            fontSource = URL.createObjectURL(blob);
        }
        const font = new FontFace(fontFamily, `url(${fontSource})`);
        await font.load();
        document.fonts.add(font);
    }
    catch (error) {
        console.error(`Failed to load font ${fontFamily}:`, error);
    }
}
