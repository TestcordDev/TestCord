/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const loadedFontFamilies = new Set(["Arial"]);
const loadingFontFamilies = new Map();
const fontObjectUrls = new Set();
export const createGoogleFontUrl = (family, options = "") => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}${options}&display=swap`;
export function getFontFamilyCss(fontFamily) {
    const escaped = fontFamily.trim().replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    return `"${escaped || "Arial"}", sans-serif`;
}
export function getCanvasFont(size, fontFamily) {
    return `${size}px ${getFontFamilyCss(fontFamily)}`;
}
function parseFontFaces(css) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const fontDisplays = new Set(["auto", "block", "fallback", "optional", "swap"]);
    return Array.from(sheet.cssRules)
        .filter((rule) => rule.type === CSSRule.FONT_FACE_RULE)
        .map(rule => {
        const src = rule.style.getPropertyValue("src");
        const url = src.match(/url\((["']?)(.*?)\1\)/)?.[2];
        if (!url)
            return null;
        return {
            descriptors: {
                display: fontDisplays.has(rule.style.getPropertyValue("font-display"))
                    ? rule.style.getPropertyValue("font-display")
                    : "swap",
                stretch: rule.style.getPropertyValue("font-stretch") || undefined,
                style: rule.style.getPropertyValue("font-style") || "normal",
                unicodeRange: rule.style.getPropertyValue("unicode-range") || undefined,
                weight: rule.style.getPropertyValue("font-weight") || "400"
            },
            url
        };
    })
        .filter((face) => face !== null);
}
async function loadFontFace(family, url, descriptors) {
    try {
        const response = await fetch(url);
        if (!response.ok)
            return false;
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        fontObjectUrls.add(objectUrl);
        try {
            const font = new FontFace(family, `url(${objectUrl})`, descriptors);
            await font.load();
            document.fonts.add(font);
            return true;
        }
        catch {
            URL.revokeObjectURL(objectUrl);
            fontObjectUrls.delete(objectUrl);
            return false;
        }
    }
    catch {
        return false;
    }
}
export function loadGoogleFont(fontFamily) {
    const family = fontFamily.trim();
    if (!family || loadedFontFamilies.has(family))
        return Promise.resolve();
    const loading = loadingFontFamilies.get(family);
    if (loading)
        return loading;
    const loadPromise = (async () => {
        try {
            const response = await fetch(createGoogleFontUrl(family));
            if (!response.ok)
                return;
            const css = await response.text();
            if (!css)
                return;
            const faces = parseFontFaces(css);
            const results = await Promise.all(faces.map(face => loadFontFace(family, face.url, face.descriptors)));
            const loaded = results.some(Boolean);
            if (loaded)
                loadedFontFamilies.add(family);
        }
        catch {
            // font load failed silently
        }
    })();
    loadingFontFamilies.set(family, loadPromise);
    return loadPromise;
}
let cachedFonts = null;
let fontsPromise = null;
export async function fetchAllGoogleFonts() {
    if (cachedFonts)
        return cachedFonts;
    if (fontsPromise)
        return fontsPromise;
    fontsPromise = fetch("https://fonts.google.com/$rpc/fonts.fe.catalog.actions.metadata.MetadataService/FontSearch", {
        body: JSON.stringify([["", null, null, null, null, null, 1], [5], null, 400]),
        headers: {
            "content-type": "application/json+protobuf",
            "x-user-agent": "grpc-web-javascript/0.1"
        },
        method: "POST"
    })
        .then(response => response.ok ? response.json() : null)
        .then(data => {
        const rows = Array.isArray(data?.[1]) ? data[1] : [];
        const fonts = [];
        for (const row of rows) {
            if (!Array.isArray(row) || !Array.isArray(row[1]))
                continue;
            const fontData = row[1];
            const family = typeof fontData[0] === "string" ? fontData[0] : "";
            if (!family || family.length > 100 || !/^[a-zA-Z0-9\s\-_']+$/.test(family))
                continue;
            const displayName = typeof fontData[1] === "string" ? fontData[1] : family;
            const authors = Array.isArray(fontData[2])
                ? fontData[2].filter((author) => typeof author === "string")
                : [];
            const category = typeof fontData[3] === "number" ? fontData[3] : undefined;
            const variants = Array.isArray(fontData[6])
                ? fontData[6]
                    .filter((variant) => Array.isArray(variant))
                    .map(variant => {
                    const axesSource = Array.isArray(variant[0]) ? variant[0] : [];
                    const axes = axesSource
                        .filter((axis) => Array.isArray(axis))
                        .map(axis => {
                        const tag = axis[0];
                        const min = axis[1];
                        const max = axis[2];
                        if (typeof tag !== "string" || typeof min !== "number" || typeof max !== "number") {
                            return null;
                        }
                        return { tag, min, max };
                    })
                        .filter((axis) => axis !== null);
                    return { axes };
                })
                : [];
            fonts.push({
                authors,
                category,
                displayName,
                family,
                popularity: 0,
                variants
            });
        }
        fonts.sort((a, b) => a.family.localeCompare(b.family));
        cachedFonts = fonts;
        return fonts;
    })
        .catch(() => {
        cachedFonts = [];
        return cachedFonts;
    });
    return fontsPromise;
}
