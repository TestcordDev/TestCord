/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import * as DataStore from "@api/DataStore";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { BaseText } from "@components/BaseText";
import { Flex } from "@components/Flex";
import { Card } from "@components/Card";
import { FormSwitch } from "@components/FormSwitch";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { Button, React, Select, Slider } from "@webpack/common";

// ─── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    // Layout
    userPanelLayout: {
        type: OptionType.SELECT,
        description: "Layout for user panel buttons",
        options: [
            { label: "Default", value: "default", default: true },
            { label: "2-column grid", value: "grid2" },
            { label: "3-column grid", value: "grid3" },
            { label: "Vertical stack", value: "vertical" },
            { label: "Plugins Top (Row)", value: "split_row" },
            { label: "Plugins Top (2-col Grid)", value: "split_grid2" },
            { label: "Plugins Top (3-col Grid)", value: "split_grid3" },
            { label: "Plugins Top (4-col Grid)", value: "split_grid4" },
            { label: "All Buttons Top", value: "all_top" },
            { label: "Hidden", value: "hidden" },
        ],
        onChange: () => apply()
    },
    callControlsLayout: {
        type: OptionType.SELECT,
        description: "Layout for call control buttons",
        options: [
            { label: "Default", value: "default", default: true },
            { label: "2-column grid", value: "grid2" },
            { label: "Vertical stack", value: "vertical" },
            { label: "Hidden", value: "hidden" },
        ],
        onChange: () => apply()
    },
    // Sizing
    iconSize: { type: OptionType.SLIDER, description: "Icon size (px)", default: 20, markers: makeRange(12, 28, 2), stickToMarkers: false, onChange: () => apply() },
    buttonContainerSize: { type: OptionType.SLIDER, description: "Button overall size (px)", default: 36, markers: makeRange(24, 48, 4), stickToMarkers: false, onChange: () => apply() },
    buttonGap: { type: OptionType.SLIDER, description: "Gap between buttons (px)", default: 6, markers: makeRange(0, 12, 2), stickToMarkers: true, onChange: () => apply() },
    panelOpacity: { type: OptionType.SLIDER, description: "Panel buttons opacity (0-100)", default: 100, markers: makeRange(10, 100, 10), stickToMarkers: false, onChange: () => apply() },
    // Button styling
    buttonStyle: {
        type: OptionType.SELECT,
        description: "Visual style of panel buttons",
        options: [
            { label: "Default (no background)", value: "default", default: true },
            { label: "Rounded filled", value: "filled" },
            { label: "Outlined", value: "outlined" },
            { label: "Pill", value: "pill" },
            { label: "Square filled", value: "square" },
        ],
        onChange: () => apply()
    },
    hoverEffect: {
        type: OptionType.SELECT,
        description: "Hover effect on panel buttons",
        options: [
            { label: "Default", value: "default", default: true },
            { label: "Scale up", value: "scale" },
            { label: "Glow", value: "glow" },
            { label: "Bright", value: "bright" },
            { label: "None", value: "none" },
        ],
        onChange: () => apply()
    },
    panelBackgroundColor: { type: OptionType.STRING, description: "Panel background color", default: "#0e1852", onChange: () => apply() },
    colorfulActiveButtons: { type: OptionType.BOOLEAN, default: true, description: "Use distinct colored blobs for active plugin buttons", onChange: () => apply() },
    // Chevrons
    hideChevrons: { type: OptionType.BOOLEAN, default: false, description: "Hide dropdown chevrons next to Mute and Deafen", onChange: () => apply() },
    // Call controls
    callCompact: { type: OptionType.BOOLEAN, default: false, description: "Compact mode for call control buttons", onChange: () => apply() },
    hideDisconnect: { type: OptionType.BOOLEAN, default: false, description: "Hide the disconnect button", onChange: () => apply() },
    hideVoiceStatus: { type: OptionType.BOOLEAN, default: false, description: "Hide the 'Voice Connected' status text and channel name", onChange: () => apply() },
    hidePingIcon: { type: OptionType.BOOLEAN, default: false, description: "Hide the ping/connection quality icon", onChange: () => apply() },
    // Per-button visibility
    hideMute: { type: OptionType.BOOLEAN, default: false, description: "Hide Mute button", onChange: () => apply() },
    hideDeafen: { type: OptionType.BOOLEAN, default: false, description: "Hide Deafen button", onChange: () => apply() },
    hideSettings: { type: OptionType.BOOLEAN, default: false, description: "Hide User Settings button", onChange: () => apply() },
    hideCamera: { type: OptionType.BOOLEAN, default: false, description: "Hide camera button in call controls", onChange: () => apply() },
    hideScreenShare: { type: OptionType.BOOLEAN, default: false, description: "Hide screen share button in call controls", onChange: () => apply() },
    hideActivity: { type: OptionType.BOOLEAN, default: false, description: "Hide activity button in call controls", onChange: () => apply() },
});

// ─── Selectors & Constants ────────────────────────────────────────────────────

const S = {
    panelContainer: ".container__37e49",
    panelButtons:   ".buttons__37e49",
    panelButton:    ".button__201d5",
    audioParent:    ".audioButtonParent__5e764",
    chevron:        ".buttonChevron__5e764",
    callContainer:  ".container_e131a9",
    callControls:   ".actionButtons_e131a9",
    callButton:     ".button_e131a9",
    voiceStatus:    ".rtcConnectionStatus__06d62",
    pingIcon:       ".clickablePing__06d62",
    disconnect:     ".voiceButtonsContainer_e131a9",
    accountWrapper: ".accountPopoutButtonWrapper__37e49",
};

const NATIVE_BUTTON_LABELS = new Set([
    "Mute", "Deafen", "User Settings", "Input Options", "Output Options",
]);

const TOGGLE_LABELS: Record<string, string[]> = {
    "Mute": ["Mute", "Unmute"],
    "Deafen": ["Deafen", "Undeafen"],
    "Camera": ["Turn On Camera", "Turn Off Camera"],
    "Screen Share": ["Share Your Screen", "Stop Sharing", "Stop Screen Sharing"],
    "Activity": ["Start An Activity", "End Activity", "Stop Activity"],
    "Game Activity": ["Enable Game Activity", "Disable Game Activity", "Game Activity"],
};

function getCanonicalLabel(label: string): string {
    // 1. Direct aliases mapping
    for (const [canonical, aliases] of Object.entries(TOGGLE_LABELS)) {
        if (aliases.includes(label)) return canonical;
    }

    // 2. Normalize prefixes for third-party dynamic toggle buttons
    let cleaned = label;
    const prefixes = [
        "Enable ", "Disable ",
        "Turn On ", "Turn Off ",
        "Start ", "Stop ", "End "
    ];
    for (const prefix of prefixes) {
        if (cleaned.startsWith(prefix)) {
            cleaned = cleaned.slice(prefix.length);
            break;
        }
    }
    return cleaned;
}

// ─── Custom Config Store (Drag & Drop / Keys / Hiding) ────────────────────────

interface ButtonConfig {
    label: string;
    hidden?: boolean;
    keybind?: string | null;
    order?: number;
}

const BUTTON_CONFIG_KEY = "deracul-panel-layout-configs";
let buttonConfigs: Record<string, ButtonConfig> = {};
let configsLoaded = false;

async function loadConfigs() {
    buttonConfigs = (await DataStore.get<Record<string, ButtonConfig>>(BUTTON_CONFIG_KEY)) ?? {};
    configsLoaded = true;
}

function saveConfigs() {
    DataStore.set(BUTTON_CONFIG_KEY, buttonConfigs);
}

function getBtnCfg(id: string): ButtonConfig {
    return buttonConfigs[id] ?? { label: id };
}

function setBtnCfg(id: string, patch: Partial<ButtonConfig>) {
    buttonConfigs[id] = { ...getBtnCfg(id), label: id, ...patch };
    saveConfigs();
}

function getAllButtons(): HTMLElement[] {
    const out: HTMLElement[] = [];
    const pBtns = document.querySelector(S.panelButtons) as HTMLElement | null;
    const cBtns = document.querySelector(S.callControls) as HTMLElement | null;
    if (pBtns) out.push(...(Array.from(pBtns.children) as HTMLElement[]));
    if (cBtns) out.push(...(Array.from(cBtns.children) as HTMLElement[]));
    return out;
}

function getBtnLabel(el: HTMLElement): string | null {
    return (
        el.getAttribute("aria-label") ||
        el.querySelector("button")?.getAttribute("aria-label") ||
        el.querySelector("[aria-label]")?.getAttribute("aria-label") ||
        null
    );
}

function cssVal(val: string): string {
    return JSON.stringify(val);
}

// Employs a unique data attribute injected dynamically for stable ordering
function getBtnSelector(canonical: string): string {
    return `html body div${S.panelContainer} div:is(${S.panelButtons}, ${S.callControls}) > [data-deracul-label=${cssVal(canonical)}]`;
}

// ─── Global Keybind Logic ─────────────────────────────────────────────────────

function formatKeybind(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    const key = e.key;
    if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
        parts.push(key.length === 1 ? key.toUpperCase() : key);
    }
    return parts.join("+");
}

function onGlobalKeydown(e: KeyboardEvent) {
    if (!configsLoaded) return;
    const combo = formatKeybind(e);
    for (const cfg of Object.values(buttonConfigs)) {
        if (cfg.keybind && cfg.keybind === combo) {
            const el = document.querySelector(getBtnSelector(cfg.label)) as HTMLElement | null;
            const clickable = (el?.querySelector("button") ?? el) as HTMLElement | null;
            if (clickable) {
                e.preventDefault();
                e.stopPropagation();
                clickable.click();
            }
        }
    }
}

// ─── DOM Attribute Injection ──────────────────────────────────────────────────

let observer: MutationObserver | null = null;

function updateDomAttributes() {
    const btns = getAllButtons();
    for (const el of btns) {
        const rawLabel = getBtnLabel(el);
        if (!rawLabel) continue;
        const canonical = getCanonicalLabel(rawLabel);
        if (el.getAttribute("data-deracul-label") !== canonical) {
            el.setAttribute("data-deracul-label", canonical);
        }
    }
}

function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
        updateDomAttributes();
    });
    // Triggers when layout items or labels toggle
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label"]
    });
    updateDomAttributes();
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

// ─── CSS Builders ─────────────────────────────────────────────────────────────

const STYLE_ID = "deracul-panel-layout";
const CUSTOM_STYLE_ID = "deracul-panel-custom";

function gridCSS(selector: string, cols: number, gap: number) {
    return `
        ${selector} {
            display: grid !important;
            grid-template-columns: repeat(${cols}, auto) !important;
            grid-auto-rows: auto !important;
            gap: ${gap}px !important;
            height: auto !important;
            width: auto !important;
            align-items: center !important;
            justify-content: start !important;
            flex-shrink: 0 !important;
        }
        ${selector} .audioButtonParent__5e764 {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            grid-column: span 1 !important;
        }
    `;
}

function verticalCSS(selector: string, gap: number, audioParent: string, button: string) {
    return `
        ${selector} {
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            gap: ${gap}px !important;
            height: auto !important;
            flex-shrink: 0 !important;
            overflow: visible !important;
        }
        ${selector} ${audioParent} {
            display: flex !important;
            flex-direction: row !important;
            width: 100% !important;
            flex-shrink: 0 !important;
        }
        ${selector} ${audioParent} ${button} {
            flex: 1 !important;
            justify-content: center !important;
            min-width: 0 !important;
        }
    `;
}

function buildCSS(): string {
    const st = settings.store;
    const gap = st.buttonGap ?? 4;
    const lines: string[] = [];

    // Native custom scrollbars
    lines.push(`
        .deracul-scrollbar::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
        .deracul-scrollbar::-webkit-scrollbar-track { background: var(--scrollbar-thin-track, transparent) !important; border-radius: 4px !important; }
        .deracul-scrollbar::-webkit-scrollbar-thumb { background: var(--scrollbar-thin-thumb, var(--background-tertiary)) !important; border-radius: 4px !important; }
        .deracul-scrollbar { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thin-thumb, var(--background-tertiary)) transparent; }
    `);

    // Base fixes
    lines.push(`${S.panelContainer} { height: auto !important; min-height: unset !important; }`);

    // Ensure cloned config SVGs display correctly
    lines.push(`
        .deracul-btn-preview svg, .deracul-btn-preview [class*="lottieIcon"] {
            width: 22px !important; height: 22px !important;
            color: var(--interactive-normal) !important; fill: currentColor !important;
        }
    `);

    // User Panel Layout
    switch (st.userPanelLayout) {
        case "grid2": lines.push(gridCSS(S.panelButtons, 2, gap)); break;
        case "grid3": lines.push(gridCSS(S.panelButtons, 3, gap)); break;
        case "vertical":
            lines.push(verticalCSS(S.panelButtons, gap, S.audioParent, S.panelButton));
            lines.push(`${S.panelContainer} { flex-wrap: wrap !important; align-items: flex-start !important; padding-bottom: 6px !important; }`);
            break;
        case "split_row":
        case "split_grid2":
        case "split_grid3":
        case "split_grid4": {
            let flexSize = "1 1 auto";
            if (st.userPanelLayout === "split_grid2") flexSize = `0 0 calc(50% - (${gap}px / 2))`;
            if (st.userPanelLayout === "split_grid3") flexSize = `0 0 calc(33.333% - (${gap}px * 2 / 3))`;
            if (st.userPanelLayout === "split_grid4") flexSize = `0 0 calc(25% - (${gap}px * 3 / 4))`;

            // Note: Massive flex order gaps (10000, 20000) allow custom Drag and Drop orders to inject safely in between.
            lines.push(`
                ${S.panelContainer} {
                    display: flex !important; flex-wrap: wrap !important; gap: ${gap}px !important;
                    height: auto !important; padding: 8px !important; align-items: center !important;
                }
                ${S.panelContainer}::before {
                    content: "" !important; order: 20000 !important; width: 100% !important;
                    height: 1px !important; background: var(--background-modifier-accent) !important; margin: 2px 0 !important;
                }
                ${S.accountWrapper} {
                    order: 30000 !important; flex: 1 1 auto !important; min-width: 0 !important; margin-right: auto !important;
                }
                ${S.panelButtons} { display: contents !important; }
                ${S.panelButtons} > *:not(${S.audioParent}):not([data-deracul-label="User Settings"]) {
                    order: 10000 !important; display: flex !important; justify-content: center !important; align-items: center !important; flex: ${flexSize} !important;
                }
                ${S.panelButtons} > *:not(${S.audioParent}):not([data-deracul-label="User Settings"]) > button {
                    width: 100% !important; display: flex !important; justify-content: center !important; align-items: center !important;
                }
                ${S.panelButtons} > ${S.audioParent},
                ${S.panelButtons} > [data-deracul-label="User Settings"] {
                    order: 40000 !important; margin: 0 !important;
                }
            `);
            break;
        }
        case "all_top":
            lines.push(`
                ${S.panelContainer} { display: flex !important; flex-wrap: wrap !important; gap: ${gap}px !important; height: auto !important; padding: 8px !important; }
                ${S.panelContainer}::before { content: "" !important; flex-basis: 100% !important; order: 2 !important; height: 0 !important; margin: 0 !important; }
                ${S.accountWrapper} { order: 3 !important; flex: 1 1 auto !important; min-width: 0 !important; margin-right: auto !important; }
                ${S.panelButtons} { display: flex !important; flex-wrap: wrap !important; order: 1 !important; gap: ${gap}px !important; width: 100% !important; }
            `);
            break;
        case "hidden": lines.push(`${S.panelButtons} { display: none !important; }`); break;
        default:
            if (gap !== 4) lines.push(`${S.panelButtons} { gap: ${gap}px !important; }`);
            break;
    }

    // Call controls layout
    switch (st.callControlsLayout) {
        case "grid2": lines.push(gridCSS(S.callControls, 2, gap)); break;
        case "vertical":
            lines.push(`
                ${S.callControls} { display: flex !important; flex-direction: column !important; gap: ${gap}px !important; height: auto !important; align-items: stretch !important; }
                ${S.callContainer} { height: auto !important; align-items: flex-start !important; flex-wrap: wrap !important; }
            `);
            break;
        case "hidden": lines.push(`${S.callControls} { display: none !important; }`); break;
        default:
            if (gap !== 4) lines.push(`${S.callControls} { gap: ${gap}px !important; }`);
            break;
    }

    // Icon & Button size
    if (st.iconSize !== 20) {
        lines.push(`${S.panelButtons} ${S.panelButton} svg, ${S.panelButtons} ${S.panelButton} .lottieIcon__5eb9b { width: ${st.iconSize}px !important; height: ${st.iconSize}px !important; }`);
    }
    if (st.buttonContainerSize !== 32) {
        lines.push(`
            ${S.panelButtons} ${S.panelButton} {
                width: ${st.buttonContainerSize}px !important; height: ${st.buttonContainerSize}px !important;
                min-width: unset !important; min-height: unset !important; padding: 0 !important;
                display: flex !important; align-items: center !important; justify-content: center !important;
            }
            ${S.panelButtons} ${S.panelButton} .contents__201d5 { display: flex !important; align-items: center !important; justify-content: center !important; }
        `);
    }

    // Button Base style
    switch (st.buttonStyle) {
        case "filled":
            lines.push(`${S.panelButtons} ${S.panelButton} { background: var(--background-modifier-hover) !important; border-radius: 8px !important; }
                        ${S.panelButtons} ${S.panelButton}:hover { background: var(--background-modifier-active) !important; }`);
            break;
        case "outlined":
            lines.push(`${S.panelButtons} ${S.panelButton} { border: 1.5px solid var(--background-modifier-accent) !important; border-radius: 8px !important; }
                        ${S.panelButtons} ${S.panelButton}:hover { border-color: var(--interactive-normal) !important; background: var(--background-modifier-hover) !important; }`);
            break;
        case "pill":
            lines.push(`${S.panelButtons} ${S.panelButton} { background: var(--background-modifier-hover) !important; border-radius: 20px !important; }
                        ${S.panelButtons} ${S.panelButton}:hover { background: var(--background-modifier-active) !important; }`);
            break;
        case "square":
            lines.push(`${S.panelButtons} ${S.panelButton} { background: var(--background-modifier-hover) !important; border-radius: 2px !important; }
                        ${S.panelButtons} ${S.panelButton}:hover { background: var(--background-modifier-active) !important; }`);
            break;
    }

    // Colorful Active Buttons
    if (st.colorfulActiveButtons) {
        lines.push(`
            ${S.panelButtons} button[role="switch"][aria-checked="true"] { background-color: var(--brand-experiment, #5865F2) !important; color: white !important; border-radius: 10px !important; }
            ${S.panelButtons} button[role="switch"][aria-checked="true"] svg { fill: white !important; color: white !important; }
            ${S.panelButtons} [data-deracul-label="Game Activity"] button[aria-checked="true"], ${S.panelButtons} [data-deracul-label="Ban all in VC"] button { background-color: var(--status-danger, #DA373C) !important; color: white !important; border-radius: 10px !important; }
            ${S.panelButtons} [data-deracul-label="Game Activity"] button[aria-checked="true"] svg, ${S.panelButtons} [data-deracul-label="Ban all in VC"] button svg { color: white !important; fill: white !important; }
            ${S.panelButtons} [data-deracul-label="Fake States"] button[aria-checked="true"] { background-color: var(--status-positive, #23A559) !important; color: white !important; border-radius: 10px !important; }
            ${S.panelButtons} [data-deracul-label="Fake States"] button[aria-checked="true"] svg { color: white !important; fill: white !important; }
            ${S.panelButtons} [data-deracul-label="Mute"] button[role="switch"][aria-checked="true"], ${S.panelButtons} [data-deracul-label="Deafen"] button[role="switch"][aria-checked="true"] { background-color: transparent !important; color: var(--status-danger, #DA373C) !important; }
        `);
    }

    // Opacity
    if (st.panelOpacity !== 100) {
        lines.push(`${S.panelButtons} { opacity: ${st.panelOpacity / 100} !important; transition: opacity 0.2s !important; }`);
        lines.push(`${S.panelButtons}:hover { opacity: 1 !important; }`);
    }

    // Panel Background
    if (st.panelBackgroundColor) {
        lines.push(`${S.panelContainer} { background-color: ${st.panelBackgroundColor} !important; }`);
    }

    // Hover
    switch (st.hoverEffect) {
        case "scale": lines.push(`${S.panelButtons} ${S.panelButton}:hover { transform: scale(1.15) !important; transition: transform 0.15s ease !important; }`); break;
        case "glow": lines.push(`${S.panelButtons} ${S.panelButton}:hover { filter: drop-shadow(0 0 6px var(--brand-experiment, #5865f2)) !important; transition: filter 0.15s ease !important; }`); break;
        case "bright": lines.push(`${S.panelButtons} ${S.panelButton}:hover { filter: brightness(1.3) !important; transition: filter 0.15s ease !important; }`); break;
    }

    // Visibility toggles
    if (st.hideChevrons) lines.push(`${S.panelButtons} ${S.chevron} { display: none !important; }`);
    if (st.hideDisconnect) lines.push(`${S.disconnect} { display: none !important; }`);
    if (st.hideVoiceStatus) lines.push(`${S.voiceStatus} { display: none !important; }`);
    if (st.hidePingIcon) lines.push(`${S.pingIcon} { display: none !important; }`);
    if (st.callCompact) {
        lines.push(`${S.callControls} ${S.callButton} { min-width: unset !important; padding: 4px 8px !important; flex: unset !important; }`);
        lines.push(`${S.callControls} ${S.callButton} .lottieIcon__5eb9b, ${S.callControls} ${S.callButton} svg { width: 18px !important; height: 18px !important; }`);
    }
    if (st.hideMute) lines.push(`${getBtnSelector("Mute")} { display: none !important; }`);
    if (st.hideDeafen) lines.push(`${getBtnSelector("Deafen")} { display: none !important; }`);
    if (st.hideSettings) lines.push(`${getBtnSelector("User Settings")} { display: none !important; }`);
    if (st.hideCamera) lines.push(`${getBtnSelector("Camera")} { display: none !important; }`);
    if (st.hideScreenShare) lines.push(`${getBtnSelector("Screen Share")} { display: none !important; }`);
    if (st.hideActivity) lines.push(`${getBtnSelector("Activity")} { display: none !important; }`);

    return lines.join("\n");
}

function buildCustomCSS(): string {
    const lines: string[] = [];
    const layout = settings.store.userPanelLayout;
    const isSplit = ["split_row", "split_grid2", "split_grid3", "split_grid4"].includes(layout);

    for (const cfg of Object.values(buttonConfigs)) {
        if (!cfg.label) continue;
        const sel = getBtnSelector(cfg.label);

        if (cfg.hidden) lines.push(`${sel} { display: none !important; }`);

        if (cfg.order != null) {
            let orderVal = cfg.order;
            if (isSplit) {
                // If it's a split layout, automatically push native buttons to the bottom tier.
                const isNative = NATIVE_BUTTON_LABELS.has(getCanonicalLabel(cfg.label));
                orderVal = isNative ? (40000 + cfg.order) : (10000 + cfg.order);
            }
            lines.push(`${sel} { order: ${orderVal} !important; }`);
        }
    }
    return lines.join("\n");
}

function apply() {
    updateDomAttributes();

    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CUSTOM_STYLE_ID)?.remove();

    const css = buildCSS();
    if (css.trim()) {
        const el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = css;
        document.head.appendChild(el);
    }

    const custom = buildCustomCSS();
    if (custom.trim()) {
        const cEl = document.createElement("style");
        cEl.id = CUSTOM_STYLE_ID;
        cEl.textContent = custom;
        document.head.appendChild(cEl);
    }
}

// ─── Modal Constants ───────────────────────────────────────────────────────

const PANEL_LAYOUTS = [
    { value: "default", label: "Default" }, { value: "grid2", label: "2-Column Grid" },
    { value: "grid3", label: "3-Column Grid" }, { value: "vertical", label: "Vertical Stack" },
    { value: "split_row", label: "Plugins Top (Row)" }, { value: "split_grid2", label: "Plugins Top (2-Col Grid)" },
    { value: "split_grid3", label: "Plugins Top (3-Col Grid)" }, { value: "split_grid4", label: "Plugins Top (4-Col Grid)" },
    { value: "all_top", label: "All Buttons Top" }, { value: "hidden", label: "Hidden" },
];
const CALL_LAYOUTS = [
    { value: "default", label: "Default" }, { value: "grid2", label: "2-Column Grid" },
    { value: "vertical", label: "Vertical Stack" }, { value: "hidden", label: "Hidden" },
];
const BUTTON_STYLES = [
    { value: "default", label: "Default (None)" }, { value: "filled", label: "Rounded Filled" },
    { value: "outlined", label: "Outlined" }, { value: "pill", label: "Pill Shape" },
    { value: "square", label: "Square Filled" },
];
const HOVER_EFFECTS = [
    { value: "default", label: "Default" }, { value: "scale", label: "Scale Up" },
    { value: "glow", label: "Color Glow" }, { value: "bright", label: "Brighten" },
    { value: "none", label: "None" },
];

// Fixed body height so switching tabs never resizes the modal window.
const MODAL_BODY_HEIGHT = 440;

// ─── Native-styled helper components ─────────────────────────────────────────

function SliderRow({ label, value, min, max, unit = "px", onChange, resetKey }: {
    label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void; resetKey?: number;
}) {
    // One marker per whole unit + stickToMarkers forces the handle to snap to
    // exact integers as it's dragged, instead of free-floating fractional values.
    const stepMarkers = React.useMemo(() => makeRange(min, max, 1), [min, max]);

    return (
        <Flex flexDirection="column" gap={8} style={{ width: "100%" }}>
            <Flex justifyContent="space-between">
                <BaseText size="md" weight="medium" color="text-default">{label}</BaseText>
                <BaseText size="sm" weight="semibold" color="text-muted">{Math.round(value)}{unit}</BaseText>
            </Flex>
            <Slider
                key={`${label}-${resetKey}`}
                minValue={min}
                maxValue={max}
                initialValue={value}
                markers={stepMarkers}
                stickToMarkers
                renderMarker={() => null}
                // asValueChanges fires continuously while dragging (not just on release),
                // so the panel updates live as the handle moves.
                asValueChanges={v => onChange(Math.round(v))}
                onValueRender={v => `${Math.round(v)}${unit}`}
            />
        </Flex>
    );
}

function Dropdown({ label, options, value, onChange }: {
    label: string; options: { value: string; label: string; }[]; value: string; onChange: (v: string) => void;
}) {
    return (
        <Flex flexDirection="column" gap={8} style={{ width: "100%" }}>
            <BaseText size="md" weight="medium" color="text-default">{label}</BaseText>
            <Select
                options={options}
                serialize={v => String(v)}
                select={onChange}
                isSelected={v => v === value}
                closeOnSelect={true}
            />
        </Flex>
    );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
    return (
        <Flex flexDirection="column" gap={8} style={{ width: "100%" }}>
            <BaseText size="md" weight="medium" color="text-default">{label}</BaseText>
            <input
                type="color"
                value={value}
                onChange={e => onChange(e.target.value)}
                style={{ width: "100%", height: "40px", border: "none", borderRadius: "6px", cursor: "pointer", background: "transparent" }}
            />
        </Flex>
    );
}

function MiniToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void; }) {
    return (
        <div
            onClick={() => onChange(!value)}
            style={{
                width: "26px", height: "14px", borderRadius: "7px",
                backgroundColor: value ? "var(--brand-experiment, #5865f2)" : "var(--background-modifier-accent)",
                position: "relative", cursor: "pointer", transition: "background 0.15s ease"
            }}
        >
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "white", position: "absolute", top: "2px", left: value ? "14px" : "2px", transition: "left 0.15s ease" }} />
        </div>
    );
}

// ─── Drag & Drop Tab Component (index-based, no mid-drag array mutation) ──────

interface BtnItem { id: string; label: string; iconHTML: string; }

function getBtnItems(): BtnItem[] {
    const seen = new Set<string>();
    const out: BtnItem[] = [];
    for (const el of getAllButtons()) {
        const rawLabel = getBtnLabel(el);
        if (!rawLabel) continue;
        const label = getCanonicalLabel(rawLabel);
        if (seen.has(label)) continue;
        seen.add(label);

        let iconHTML = "";
        const svg = el.querySelector("svg");
        if (svg) {
            const clone = svg.cloneNode(true) as SVGElement;
            clone.removeAttribute("style");
            clone.removeAttribute("class");
            iconHTML = clone.outerHTML;
        } else {
            const lottie = el.querySelector('[class*="lottieIcon"]');
            if (lottie) {
                const clone = lottie.cloneNode(true) as HTMLElement;
                clone.removeAttribute("style");
                iconHTML = clone.outerHTML;
            }
        }
        if (!iconHTML) iconHTML = `<span style="font-size:11px;font-weight:bold;color:var(--text-muted);">${label.slice(0, 2).toUpperCase()}</span>`;
        out.push({ id: label, label, iconHTML });
    }
    out.sort((a, b) => (getBtnCfg(a.id).order ?? 0) - (getBtnCfg(b.id).order ?? 0));
    return out;
}

function ButtonsDragTab() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [items, setItems] = React.useState<BtnItem[]>(getBtnItems());
    const [listeningId, setListeningId] = React.useState<string | null>(null);

    // Index-based drag state. We never mutate `items` mid-drag — only on drop.
    // This avoids the flicker/glitchiness that comes from re-sorting the array
    // on every dragEnter (which causes the dragged DOM node to unmount/remount
    // and the browser to lose the drag session).
    const dragFromIndex = React.useRef<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
    const [activeDragIndex, setActiveDragIndex] = React.useState<number | null>(null);

    React.useEffect(() => {
        if (!listeningId) return;
        const handler = (e: KeyboardEvent) => {
            if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            setBtnCfg(listeningId, { keybind: formatKeybind(e) });
            apply();
            setListeningId(null); forceUpdate();
        };
        window.addEventListener("keydown", handler, true);
        return () => window.removeEventListener("keydown", handler, true);
    }, [listeningId]);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        dragFromIndex.current = index;
        setActiveDragIndex(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        // Use a transparent 1px drag image so the browser doesn't render the
        // default ghost on top of our own opacity/scale styling, which is
        // what caused the "unreliable" look before.
        const img = new Image();
        img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
        e.dataTransfer.setDragImage(img, 0, 0);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOverIndex !== index) setDragOverIndex(index);
    };

    const commitDrop = (targetIndex: number) => {
        const fromIndex = dragFromIndex.current;
        if (fromIndex !== null && fromIndex !== targetIndex) {
            setItems(prev => {
                const next = [...prev];
                const [moved] = next.splice(fromIndex, 1);
                next.splice(targetIndex, 0, moved);
                next.forEach((it, idx) => setBtnCfg(it.id, { order: idx * 10 }));
                apply();
                return next;
            });
        }
        dragFromIndex.current = null;
        setActiveDragIndex(null);
        setDragOverIndex(null);
    };

    const handleDrop = (e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        commitDrop(targetIndex);
    };

    const handleDragEnd = () => {
        // Fires even if the drop lands outside any valid target — always
        // clears state so a hovering item never gets stuck mid-drag.
        dragFromIndex.current = null;
        setActiveDragIndex(null);
        setDragOverIndex(null);
    };

    return (
        <Flex flexDirection="column" gap={16} style={{ paddingBottom: "12px" }}>
            <Paragraph style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                Drag a square left or right to change its order. Use the switches to show or hide them.
            </Paragraph>

            {items.length === 0 ? (
                <BaseText size="sm" color="text-muted">No buttons detected. Open this tab again once buttons load.</BaseText>
            ) : (
                <div className="deracul-scrollbar" style={{
                    display: "flex", flexDirection: "row", gap: "12px", overflowX: "auto",
                    padding: "16px", backgroundColor: "var(--background-secondary)", borderRadius: "12px",
                    border: "1px solid var(--background-modifier-accent)", position: "relative"
                }}>
                    {items.map((item, index) => {
                        const cfg = getBtnCfg(item.id);
                        const isDragging = activeDragIndex === index;
                        const isOver = dragOverIndex === index && activeDragIndex !== index;

                        return (
                            <div
                                key={item.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragOver={(e) => handleDragOver(e, index)}
                                onDragLeave={() => { if (dragOverIndex === index) setDragOverIndex(null); }}
                                onDrop={(e) => handleDrop(e, index)}
                                onDragEnd={handleDragEnd}
                                style={{
                                    display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
                                    cursor: isDragging ? "grabbing" : "grab",
                                    opacity: isDragging ? 0.35 : 1,
                                    transform: isDragging ? "scale(0.94)" : "scale(1)",
                                    borderLeft: isOver ? "3px solid var(--brand-experiment, #5865f2)" : "3px solid transparent",
                                    paddingLeft: isOver ? "6px" : "0px",
                                    transition: "border 0.1s ease, padding 0.1s ease, opacity 0.1s ease, transform 0.1s ease",
                                }}
                                title={item.label}
                            >
                                <div
                                    className="deracul-btn-preview"
                                    dangerouslySetInnerHTML={{ __html: item.iconHTML }}
                                    style={{
                                        width: "36px", height: "36px", borderRadius: "8px", backgroundColor: "var(--background-tertiary)",
                                        display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-default)",
                                        boxShadow: "0 2px 4px rgba(0,0,0,0.15)", pointerEvents: "none"
                                    }}
                                />
                                <MiniToggle
                                    value={!cfg.hidden}
                                    onChange={(v) => {
                                        setBtnCfg(item.id, { hidden: !v });
                                        apply(); forceUpdate();
                                    }}
                                />
                            </div>
                        );
                    })}
                </div>
            )}

            {items.length > 0 && (
                <Flex flexDirection="column" gap={8} style={{ marginTop: "4px" }}>
                    <Heading tag="h5">Global Keybind Mappings</Heading>
                    <div className="deracul-scrollbar" style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "160px", overflowY: "auto", paddingRight: "4px" }}>
                        {items.map(item => {
                            const cfg = getBtnCfg(item.id);
                            const listening = listeningId === item.id;
                            return (
                                <Flex key={item.id} justifyContent="space-between" alignItems="center" style={{ padding: "8px 12px", backgroundColor: "var(--background-secondary)", borderRadius: "6px" }}>
                                    <BaseText size="sm" weight="medium" color="text-default">{item.label}</BaseText>
                                    <Flex gap={8} alignItems="center">
                                        <Button size="small" variant="secondary" onClick={() => setListeningId(listening ? null : item.id)}>
                                            {listening ? "Press key..." : (cfg.keybind || "Assign Key")}
                                        </Button>
                                        {cfg.keybind && (
                                            <Button size="small" variant="secondary" onClick={() => {
                                                setBtnCfg(item.id, { keybind: null });
                                                apply(); forceUpdate();
                                            }}>✕</Button>
                                        )}
                                    </Flex>
                                </Flex>
                            );
                        })}
                    </div>
                </Flex>
            )}
        </Flex>
    );
}

// ─── Modal Implementation ─────────────────────────────────────────────────────

type Tab = "panel" | "call" | "style" | "colors" | "hide" | "drag";

function PanelLayoutIcon({ style }: { style?: React.CSSProperties; }) {
    return (
        <svg style={style} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {/* Top-Left Block */}
            <rect x="3" y="3" width="8" height="10" rx="2" fill="currentColor" />
            {/* Bottom-Left Block */}
            <rect x="3" y="15" width="8" height="6" rx="2" fill="currentColor" />
            {/* Top-Right Block */}
            <rect x="13" y="3" width="8" height="6" rx="2" fill="currentColor" />
            {/* Bottom-Right Block */}
            <rect x="13" y="11" width="8" height="10" rx="2" fill="currentColor" />
        </svg>
    );
}

function PanelLayoutModal({ modalProps }: { modalProps: ModalProps; }) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [tab, setTab] = React.useState<Tab>("panel");
    const [resetKey, setResetKey] = React.useState(0);

    function set<K extends keyof typeof settings.store>(key: K, val: (typeof settings.store)[K]) {
        settings.store[key] = val;
        apply(); forceUpdate();
    }

    const s = settings.store;

    const tabsList: { id: Tab; label: string; }[] = [
        { id: "panel", label: "Panel" },
        { id: "call",  label: "Call Bar" },
        { id: "style", label: "Style" },
        { id: "colors", label: "Colors" },
        { id: "hide",  label: "Visibility" },
        { id: "drag",  label: "Buttons" },
    ];

    function resetDefaults() {
        set("userPanelLayout", "default");
        set("callControlsLayout", "default");
        set("buttonContainerSize", 36);
        set("iconSize", 20);
        set("buttonGap", 6);
        set("panelOpacity", 100);
        setResetKey(prev => prev + 1);
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader separator={false} style={{ padding: "24px 24px 0 24px", display: "flex", flexDirection: "column", position: "relative" }}>
                <Flex gap={12} alignItems="center" style={{ width: "100%", paddingRight: "36px" }}>
                    <div style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "40px", height: "40px", borderRadius: "12px",
                        background: "var(--brand-experiment, #5865f2)", color: "white"
                    }}>
                        <PanelLayoutIcon />
                    </div>
                    <div style={{ flex: 1 }}>
                        <BaseText size="lg" weight="semibold" color="text-strong" tag="h1">
                            Panel Layout
                        </BaseText>
                        <Paragraph style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "2px" }}>
                            Customize the layout, style, and visibility of panel and call buttons.
                        </Paragraph>
                    </div>
                </Flex>

                <Flex gap={24} style={{ marginTop: "24px", borderBottom: "1px solid var(--background-modifier-accent)", width: "100%" }}>
                    {tabsList.map(t => (
                        <div
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            style={{
                                paddingBottom: "12px",
                                cursor: "pointer",
                                borderBottom: tab === t.id ? "2px solid var(--brand-experiment, #5865f2)" : "2px solid transparent",
                                transition: "all 0.15s ease",
                            }}
                        >
                            <BaseText size="md" weight={tab === t.id ? "semibold" : "medium"} color={tab === t.id ? "text-strong" : "text-muted"}>
                                {t.label}
                            </BaseText>
                        </div>
                    ))}
                </Flex>
            </ModalHeader>

            <ModalContent style={{ padding: "24px" }}>
                {/* Fixed-height body — switching tabs changes content, never the modal's footprint */}
                <div className="deracul-scrollbar" style={{ height: `${MODAL_BODY_HEIGHT}px`, overflowY: "auto", paddingRight: "4px" }}>
                    <Flex flexDirection="column" gap={16}>

                        {tab === "panel" && <>
                            <Heading tag="h5">Layout Structure</Heading>
                            <Card variant="primary">
                                <Dropdown label="User Panel Alignment" options={PANEL_LAYOUTS} value={s.userPanelLayout} onChange={v => set("userPanelLayout", v)} />
                            </Card>

                            <Heading tag="h5">Component Dimensions</Heading>
                            <Card variant="primary">
                                <SliderRow label="Button Box Size" value={s.buttonContainerSize} min={24} max={48} onChange={v => set("buttonContainerSize", Math.round(v))} resetKey={resetKey} />
                                <SliderRow label="Vector Icon Size" value={s.iconSize} min={12} max={28} onChange={v => set("iconSize", Math.round(v))} resetKey={resetKey} />
                                <SliderRow label="Margin / Gap" value={s.buttonGap} min={0} max={12} onChange={v => set("buttonGap", Math.round(v))} resetKey={resetKey} />
                                <SliderRow label="Idle Opacity" value={s.panelOpacity} min={10} max={100} unit="%" onChange={v => set("panelOpacity", Math.round(v))} resetKey={resetKey} />
                            </Card>

                            <Heading tag="h5">Extra Features</Heading>
                            <Card variant="primary">
                                <FormSwitch title="Hide Dropdown Chevrons" description="Removes the tiny arrows next to Mute/Deafen." value={s.hideChevrons} onChange={v => set("hideChevrons", v)} hideBorder />
                            </Card>
                        </>}

                        {tab === "call" && <>
                            <Heading tag="h5">Action Bar Layout</Heading>
                            <Card variant="primary">
                                <Dropdown label="Call Controls Alignment" options={CALL_LAYOUTS} value={s.callControlsLayout} onChange={v => set("callControlsLayout", v)} />
                            </Card>

                            <Heading tag="h5">Voice Settings</Heading>
                            <Card variant="primary">
                                <FormSwitch title="Compact Mode" description="Reduces padding inside call buttons to save space." value={s.callCompact} onChange={v => set("callCompact", v)} />
                                <FormSwitch title="Hide Disconnect Button" value={s.hideDisconnect} onChange={v => set("hideDisconnect", v)} />
                                <FormSwitch title="Hide Voice Status Text" description="Removes 'Voice Connected' and channel name details." value={s.hideVoiceStatus} onChange={v => set("hideVoiceStatus", v)} />
                                <FormSwitch title="Hide Network Ping Icon" value={s.hidePingIcon} onChange={v => set("hidePingIcon", v)} hideBorder />
                            </Card>
                        </>}

                        {tab === "style" && <>
                            <Heading tag="h5">Aesthetics</Heading>
                            <Card variant="primary">
                                <Dropdown label="Button Base Style" options={BUTTON_STYLES} value={s.buttonStyle} onChange={v => set("buttonStyle", v)} />
                                <Dropdown label="Interaction Hover Effect" options={HOVER_EFFECTS} value={s.hoverEffect} onChange={v => set("hoverEffect", v)} />
                            </Card>

                            <Heading tag="h5">Colorful Plugins</Heading>
                            <Card variant="primary">
                                <FormSwitch title="Active Button Blobs" description="Gives enabled plugins distinct colored rounded backgrounds (e.g. Red for Game Activity, Green for Fake States)." value={s.colorfulActiveButtons} onChange={v => set("colorfulActiveButtons", v)} hideBorder />
                            </Card>
                        </>}

                        {tab === "colors" && <>
                            <Heading tag="h5">Panel Colors</Heading>
                            <Card variant="primary">
                                <ColorRow label="Panel Background Color" value={s.panelBackgroundColor} onChange={v => set("panelBackgroundColor", v)} />
                            </Card>
                        </>}

                        {tab === "hide" && <>
                            <Heading tag="h5">Standard Buttons</Heading>
                            <Card variant="primary">
                                <FormSwitch title="Hide Mute" value={s.hideMute} onChange={v => set("hideMute", v)} />
                                <FormSwitch title="Hide Deafen" value={s.hideDeafen} onChange={v => set("hideDeafen", v)} />
                                <FormSwitch title="Hide User Settings" value={s.hideSettings} onChange={v => set("hideSettings", v)} hideBorder />
                            </Card>

                            <Heading tag="h5">Call Buttons</Heading>
                            <Card variant="primary">
                                <FormSwitch title="Hide Camera" value={s.hideCamera} onChange={v => set("hideCamera", v)} />
                                <FormSwitch title="Hide Screen Share" value={s.hideScreenShare} onChange={v => set("hideScreenShare", v)} />
                                <FormSwitch title="Hide Activity" value={s.hideActivity} onChange={v => set("hideActivity", v)} hideBorder />
                            </Card>
                        </>}

                        {tab === "drag" && <>
                            <Heading tag="h5">Button Order & Hotkeys</Heading>
                            <ButtonsDragTab />
                        </>}

                    </Flex>
                </div>
            </ModalContent>

            <ModalFooter>
                <Flex gap={8} justifyContent="flex-end" style={{ width: "100%" }}>
                    <Button variant="secondary" onClick={resetDefaults}>
                        Reset to Defaults
                    </Button>
                    <div style={{ flex: 1 }} />
                    <Button variant="primary" onClick={() => modalProps.onClose()}>
                        Done
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>
    );
}

// ─── Panel Button ─────────────────────────────────────────────────────────────

function PanelLayoutButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : "Panel Layout"}
            icon={<PanelLayoutIcon style={{ color: iconForeground }} />}
            role="button"
            plated={nameplate != null}
            onClick={() => openModal(modalProps => <PanelLayoutModal modalProps={modalProps} />)}
        />
    );
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "deraculpanellayout",
    description: "Customize the layout, style, and visibility of panel and call buttons.",
    authors: [{ name: "deracul", id: 1454268753629024529n }],
    dependencies: ["UserSettingsAPI"],
    settings,

    userAreaButton: { icon: PanelLayoutIcon, render: PanelLayoutButton },

    async start() {
        await loadConfigs();
        apply();
        startObserver();
        document.addEventListener("keydown", onGlobalKeydown, true);
    },
    stop()  {
        stopObserver();
        document.getElementById(STYLE_ID)?.remove();
        document.getElementById(CUSTOM_STYLE_ID)?.remove();
        document.removeEventListener("keydown", onGlobalKeydown, true);
    }
});
