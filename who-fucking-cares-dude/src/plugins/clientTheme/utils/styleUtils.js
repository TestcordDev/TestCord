/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { managedStyleRootNode } from "@api/Styles";
import { createAndAppendStyle } from "@utils/css";
import { hexToHSL } from "./colorUtils";
const VARS_STYLE_ID = "vc-clientTheme-vars";
const OVERRIDES_STYLE_ID = "vc-clientTheme-overrides";
const styleCache = {};
export function createOrUpdateThemeColorVars(color) {
    const { hue, saturation, lightness } = hexToHSL(color);
    createOrUpdateStyle(VARS_STYLE_ID, `:root {
        --theme-h: ${hue};
        --theme-s: ${saturation}%;
        --theme-l: ${lightness}%;
    }`);
}
export async function startClientTheme(color) {
    createOrUpdateThemeColorVars(color);
    createColorsOverrides(await getDiscordStyles());
}
export function disableClientTheme() {
    styleCache[VARS_STYLE_ID]?.remove();
    styleCache[OVERRIDES_STYLE_ID]?.remove();
    styleCache[VARS_STYLE_ID] = null;
    styleCache[OVERRIDES_STYLE_ID] = null;
}
function getOrCreateStyle(styleId) {
    if (!styleCache[styleId]) {
        styleCache[styleId] = createAndAppendStyle(styleId, managedStyleRootNode);
    }
    return styleCache[styleId];
}
function createOrUpdateStyle(styleId, css) {
    const style = getOrCreateStyle(styleId);
    style.textContent = css;
}
/**
 * @returns A string containing all the CSS styles from the Discord client.
 */
async function getDiscordStyles() {
    const styleLinkNodes = document.querySelectorAll('link[rel="stylesheet"]');
    const cssTexts = await Promise.all(Array.from(styleLinkNodes, async (node) => {
        if (!node.href)
            return null;
        return fetch(node.href).then(res => res.text());
    }));
    return cssTexts.filter(Boolean).join("\n");
}
const VISUAL_REFRESH_COLORS_VARIABLES_REGEX = /(--neutral-\d{1,3}?-hsl):.+?([\d.]+?)%;/g;
function createColorsOverrides(styles) {
    const visualRefreshColorsLightness = {};
    for (const [, colorVariableName, lightness] of styles.matchAll(VISUAL_REFRESH_COLORS_VARIABLES_REGEX)) {
        visualRefreshColorsLightness[colorVariableName] = parseFloat(lightness);
    }
    const lightThemeBaseLightness = visualRefreshColorsLightness["--neutral-2-hsl"];
    const darkThemeBaseLightness = visualRefreshColorsLightness["--neutral-69-hsl"];
    createOrUpdateStyle(OVERRIDES_STYLE_ID, [
        `.theme-light {\n ${generateNewColorVars(visualRefreshColorsLightness, lightThemeBaseLightness)} \n}`,
        `.theme-dark {\n ${generateNewColorVars(visualRefreshColorsLightness, darkThemeBaseLightness)} \n}`,
    ].join("\n\n"));
}
function generateNewColorVars(colorsLightess, baseLightness) {
    return Object.entries(colorsLightess).map(([colorVariableName, lightness]) => {
        const lightnessOffset = lightness - baseLightness;
        const plusOrMinus = lightnessOffset >= 0 ? "+" : "-";
        return `${colorVariableName}: var(--theme-h) var(--theme-s) calc(var(--theme-l) ${plusOrMinus} ${Math.abs(lightnessOffset).toFixed(2)}%);`;
    }).join("\n");
}
