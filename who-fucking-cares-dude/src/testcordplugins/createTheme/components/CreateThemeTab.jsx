/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./createTheme.css";
import { ErrorCard } from "@components/ErrorCard";
import { Paragraph } from "@components/Paragraph";
// relativeLuminance inlined (clientTheme removed)
function relativeLuminance(hex) {
    const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    const r = toLinear(parseInt(hex.slice(0, 2), 16) / 255);
    const g = toLinear(parseInt(hex.slice(2, 4), 16) / 255);
    const b = toLinear(parseInt(hex.slice(4, 6), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { findByCodeLazy, findStoreLazy } from "@webpack";
import { Button, React, ThemeStore, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";
const saveClientTheme = findByCodeLazy('type:"UNSYNCED_USER_SETTINGS_UPDATE', '"system"===');
const NitroThemeStore = findStoreLazy("ClientThemesBackgroundStore");
const cl = classNameFactory("vc-ct-");
const colorPresets = [
    "#1E1514", "#172019", "#13171B", "#1C1C28", "#402D2D",
    "#3A483D", "#344242", "#313D4B", "#2D2F47", "#322B42",
    "#3C2E42", "#422938", "#b6908f", "#bfa088", "#d3c77d",
    "#86ac86", "#88aab3", "#8693b5", "#8a89ba", "#ad94bb",
];
// ── Storage key ──────────────────────────────────────────
const STORAGE_KEY = "vc-create-theme-settings";
const defaultSettings = {
    color: "313338",
    bgImage: null,
    bgBlur: 0,
    bgSize: "cover",
    transparency: 0,
    panelBlur: 0,
    enabled: false,
    windowMaterial: "none",
};
function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return { ...defaultSettings };
        return { ...defaultSettings, ...JSON.parse(raw) };
    }
    catch {
        return { ...defaultSettings };
    }
}
function saveSettings(s) {
    try {
        // Don't save the base64 image in localStorage (too large) — save everything else
        const toSave = { ...s, bgImage: null };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    }
    catch { /* ignore */ }
}
// ── Style injection IDs ──────────────────────────────────
const ID_VARS = "vc-ct-vars";
const ID_OVERRIDES = "vc-ct-overrides";
const ID_BG = "vc-ct-bg";
const ID_GLASS = "vc-ct-glass";
// ── Helpers ──────────────────────────────────────────────
function hexToHSL(hex) {
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const cMax = Math.max(r, g, b), cMin = Math.min(r, g, b);
    const delta = cMax - cMin;
    let hue = 0, saturation = 0;
    const lightness = (cMax + cMin) / 2;
    if (delta !== 0) {
        saturation = delta / (1 - Math.abs(2 * lightness - 1));
        if (cMax === r)
            hue = ((g - b) / delta) % 6;
        else if (cMax === g)
            hue = (b - r) / delta + 2;
        else
            hue = (r - g) / delta + 4;
        hue *= 60;
        if (hue < 0)
            hue += 360;
    }
    return { hue, saturation: saturation * 100, lightness: lightness * 100 };
}
function getStyle(id) {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement("style");
        el.id = id;
        document.head.appendChild(el);
    }
    return el;
}
function removeStyle(id) {
    document.getElementById(id)?.remove();
}
async function getDiscordStyles() {
    const links = document.querySelectorAll("link[rel=\"stylesheet\"]");
    const texts = await Promise.all(Array.from(links, async (n) => {
        if (!n.href)
            return null;
        try {
            return await fetch(n.href).then(r => r.text());
        }
        catch {
            return null;
        }
    }));
    return texts.filter(Boolean).join("\n");
}
const NEUTRAL_REGEX = /(--neutral-\d{1,3}?-hsl):.+?([\d.]+?)%;/g;
function buildColorOverrides(discordCSS, hue, sat, lit) {
    const map = {};
    for (const [, name, l] of discordCSS.matchAll(NEUTRAL_REGEX))
        map[name] = parseFloat(l);
    const darkBase = map["--neutral-69-hsl"] ?? 18.04;
    const lightBase = map["--neutral-2-hsl"] ?? 97.65;
    const makeVars = (base) => Object.entries(map).map(([name, l]) => {
        const off = l - base;
        const pm = off >= 0 ? "+" : "-";
        return `${name}: var(--theme-h) var(--theme-s) calc(var(--theme-l) ${pm} ${Math.abs(off).toFixed(2)}%);`;
    }).join("\n");
    return [
        `.theme-dark  {\n${makeVars(darkBase)}\n}`,
        `.theme-light {\n${makeVars(lightBase)}\n}`,
    ].join("\n\n");
}
let cachedDiscordCSS = null;
function applyColorVars(hex) {
    const { hue, saturation, lightness } = hexToHSL(hex);
    getStyle(ID_VARS).textContent = `:root {
        --theme-h: ${hue};
        --theme-s: ${saturation}%;
        --theme-l: ${lightness}%;
    }`;
}
async function applyColorOverrides(hex) {
    if (!cachedDiscordCSS)
        cachedDiscordCSS = await getDiscordStyles();
    const { hue, saturation, lightness } = hexToHSL(hex);
    getStyle(ID_OVERRIDES).textContent = buildColorOverrides(cachedDiscordCSS, hue, saturation, lightness);
}
function applyBackground(image, blur, size) {
    if (!image) {
        removeStyle(ID_BG);
        return;
    }
    const bgCss = blur > 0
        ? `background-image: url("${image}") !important;
  background-size: ${size} !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;
  filter: blur(${blur}px) brightness(0.85) !important;`
        : `background-image: url("${image}") !important;
  background-size: ${size} !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;`;
    getStyle(ID_BG).textContent = `
/* Set image directly on html element */
html {
  ${bgCss}
}
/* Make all Discord root layers transparent so image shows through */
[class*="baseLayer_"],
[class*="app_"],
[class*="bg_"],
[class*="layers_"],
[class*="layer_"] {
  background: transparent !important;
  background-color: transparent !important;
}
`.trim();
}
function applyGlass(transparency, blur) {
    if (transparency === 0 && blur === 0) {
        removeStyle(ID_GLASS);
        return;
    }
    const a = (1 - transparency / 100).toFixed(2);
    const blurLine = blur > 0
        ? `backdrop-filter: blur(${blur}px) saturate(180%) !important; -webkit-backdrop-filter: blur(${blur}px) saturate(180%) !important;`
        : "";
    getStyle(ID_GLASS).textContent = `
[class*="guilds_"]      { background: rgba(30,31,34,${a}) !important; ${blurLine} }
[class*="sidebar_"]     { background: rgba(43,45,49,${a}) !important; ${blurLine} }
[class*="chat_"]        { background: rgba(49,51,56,${a}) !important; ${blurLine} }
[class*="membersWrap_"] { background: rgba(43,45,49,${a}) !important; ${blurLine} }
[class*="panels_"]      { background: rgba(30,31,34,${a}) !important; ${blurLine} }
`.trim();
}
export function applyFullTheme(s) {
    applyColorVars(s.color);
    applyColorOverrides(s.color).catch(console.error);
    applyBackground(s.bgImage, s.bgBlur, s.bgSize);
    applyGlass(s.transparency, s.panelBlur);
}
export function removeAll() {
    [ID_VARS, ID_OVERRIDES, ID_BG, ID_GLASS].forEach(removeStyle);
}
// ── Auto-apply on load if previously enabled ─────────────
(function initOnLoad() {
    // Always clean up residual styles on startup
    [ID_VARS, ID_OVERRIDES, ID_BG, ID_GLASS].forEach(id => document.getElementById(id)?.remove());
    // Re-appliquer seulement si enabled
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return;
        const s = { ...defaultSettings, ...JSON.parse(raw) };
        if (s.enabled) {
            applyColorVars(s.color);
            applyColorOverrides(s.color).catch(console.error);
            // Don't apply glass/bg on startup to avoid visual artifacts
        }
    }
    catch { /* ignore */ }
})();
// ── Main Tab ─────────────────────────────────────────────
export function CreateThemeTab() {
    const [settings, setSettingsState] = useState(() => loadSettings());
    const fileRef = useRef(null);
    // ClientTheme warnings
    const currentTheme = useStateFromStores([ThemeStore], () => ThemeStore.theme);
    const isLightTheme = currentTheme === "light";
    const oppositeTheme = isLightTheme ? "Dark" : "Light";
    const nitroThemeEnabled = useStateFromStores([NitroThemeStore], () => NitroThemeStore.gradientPreset != null);
    const selectedLuminance = relativeLuminance(settings.color);
    let contrastWarning = false, fixableContrast = true;
    if ((isLightTheme && selectedLuminance < 0.26) || (!isLightTheme && selectedLuminance > 0.12))
        contrastWarning = true;
    if (selectedLuminance < 0.26 && selectedLuminance > 0.12)
        fixableContrast = false;
    if (isLightTheme && selectedLuminance > 0.65) {
        contrastWarning = true;
        fixableContrast = false;
    }
    function setDiscordTheme(theme) { saveClientTheme({ theme }); }
    // Update a single field, save and re-apply
    function update(key, val) {
        setSettingsState(prev => {
            const next = { ...prev, [key]: val };
            saveSettings(next);
            // Always apply color/glass when enabled, always apply bg-related when image exists
            if (next.enabled) {
                applyColorVars(next.color);
                applyColorOverrides(next.color).catch(console.error);
                applyGlass(next.transparency, next.panelBlur);
            }
            // Apply background immediately if image present (regardless of enabled)
            if (next.bgImage)
                applyBackground(next.bgImage, next.bgBlur, next.bgSize);
            else
                removeStyle(ID_BG);
            return next;
        });
    }
    // Toggle enabled
    function toggleEnabled(enabled) {
        setSettingsState(prev => {
            const next = { ...prev, enabled };
            saveSettings(next);
            if (enabled)
                applyFullTheme(next);
            else
                removeAll();
            return next;
        });
    }
    async function applyWindowMaterial(material) {
        if (IS_WEB)
            return;
        // Save to Equicord settings so patcher.ts reads it on next Discord start
        try {
            const s = VencordNative.settings.get();
            s.windowMaterial = material;
            await VencordNative.settings.set(s);
        }
        catch (e) {
            console.error("[CreateTheme] save windowMaterial failed", e);
        }
        // Apply immediately to current window via IPC
        if (VencordNative.window?.setBackgroundMaterial) {
            VencordNative.window.setBackgroundMaterial(material).catch(console.error);
        }
    }
    // Apply on mount
    useEffect(() => {
        if (settings.enabled) {
            applyColorVars(settings.color);
            applyColorOverrides(settings.color).catch(console.error);
            applyGlass(settings.transparency, settings.panelBlur);
        }
        // Always restore bg if image exists in state
        if (settings.bgImage)
            applyBackground(settings.bgImage, settings.bgBlur, settings.bgSize);
        // Restore window material
        if (settings.windowMaterial !== "none")
            applyWindowMaterial(settings.windowMaterial);
    }, []);
    function handleImage(e) {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = ev => {
            const img = ev.target?.result;
            setSettingsState(prev => {
                const next = { ...prev, bgImage: img };
                // Don't save image to localStorage (too large)
                saveSettings({ ...next, bgImage: null });
                // Always apply background immediately, regardless of enabled toggle
                applyBackground(img, next.bgBlur, next.bgSize);
                return next;
            });
        };
        reader.readAsDataURL(file);
    }
    function removeImage() {
        setSettingsState(prev => {
            const next = { ...prev, bgImage: null };
            saveSettings(next);
            applyBackground(null, 0, "cover");
            return next;
        });
        if (fileRef.current)
            fileRef.current.value = "";
    }
    return (<div className={cl("root")}>

            {/* ── Color Section ── */}
            <div className={cl("section")}>
                <div className={cl("section-title")}>Theme Color</div>
                <div className={cl("color-row")} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className={cl("color-labels")} style={{ flex: 1 }}>
                        <span className={cl("label")} style={{ fontWeight: 600, display: "block" }}>Color</span>
                        <span className={cl("sublabel")} style={{ fontSize: 12, opacity: 0.7 }}>Tints every panel, button and link</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="color" value={"#" + settings.color} onChange={e => update("color", e.target.value.replace("#", ""))} style={{
            width: 40,
            height: 32,
            padding: 0,
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            backgroundColor: "transparent"
        }}/>
                        <input type="text" value={"#" + settings.color} onChange={e => {
            const val = e.target.value.replace("#", "");
            if (/^[0-9A-Fa-f]{0,6}$/.test(val)) {
                if (val.length === 6)
                    update("color", val);
            }
        }} style={{
            width: 80,
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid var(--border-medium)",
            backgroundColor: "var(--input-background)",
            color: "var(--text-normal)",
            fontSize: 14
        }}/>
                    </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                    {colorPresets.map(preset => (<div key={preset} onClick={() => update("color", preset.replace("#", ""))} style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                backgroundColor: preset,
                cursor: "pointer",
                border: settings.color === preset.replace("#", "") ? "2px solid white" : "1px solid rgba(255,255,255,0.2)"
            }}/>))}
                </div>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} look={Button.Looks.FILLED} onClick={() => update("color", "313338")} style={{ marginTop: 12, width: "fit-content" }}>
                    Reset Color
                </Button>

                {(contrastWarning || nitroThemeEnabled) && (<ErrorCard className={Margins.top8}>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Your theme won't look good!</div>
                        {contrastWarning && <Paragraph>› Selected color won't contrast well with text</Paragraph>}
                        {nitroThemeEnabled && <Paragraph>› Nitro themes aren't supported</Paragraph>}
                        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                            {contrastWarning && fixableContrast &&
                <Button onClick={() => setDiscordTheme(oppositeTheme)} color={Button.Colors.RED} size={Button.Sizes.SMALL}>
                                    Switch to {oppositeTheme} mode
                                </Button>}
                            {nitroThemeEnabled &&
                <Button onClick={() => setDiscordTheme(currentTheme)} color={Button.Colors.RED} size={Button.Sizes.SMALL}>
                                    Disable Nitro Theme
                                </Button>}
                        </div>
                    </ErrorCard>)}
            </div>

            {/* Background Image, Glass Effect and Window Effect removed */}

            {/* ── Enable toggle ── */}
            <div className={cl("section")}>
                <label className={cl("live-toggle")}>
                    <input type="checkbox" checked={settings.enabled} onChange={e => toggleEnabled(e.target.checked)}/>
                    <span>Enable theme</span>
                </label>
                <div className={cl("section-desc")}>
                    When enabled, your theme stays active even after closing this tab or restarting Discord
                    (color &amp; glass only — background image must be re-uploaded each session).
                </div>
            </div>

        </div>);
}
