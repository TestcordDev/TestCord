/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings, SettingsStore } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { getTestcordIconColor, ICON_COLOR_FALLBACK } from "@testcordplugins/TestcordHelper/iconColors";
import { TestcordDevs } from "@utils/constants";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal, RenderModalProps } from "@utils/modal";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { React, Select, Slider } from "@webpack/common";

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
            { label: "Outlined (old)", value: "outlineold" },
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
    glowColor: { type: OptionType.STRING, description: "Glow hover color", default: "#ffffff", onChange: () => apply() },
    forceNativeButtonColor: { type: OptionType.BOOLEAN, default: false, description: "Force the icon color on Discord's native buttons (Mute, Deafen, Settings) even when no custom icon color is set", onChange: () => apply() },
    // Chevrons & Lock
    hideChevrons: { type: OptionType.BOOLEAN, default: false, description: "Hide dropdown chevrons next to Mute and Deafen", onChange: () => apply() },
    lockButtonPosition: { type: OptionType.BOOLEAN, default: false, description: "Lock Button Position (prevents buttons dropping down on long status)", onChange: () => apply() },
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
    // Line
    hideLine: { type: OptionType.BOOLEAN, default: true, description: "Hide the line between user and buttons", onChange: () => apply() },
    // Profile Nameplate
    fixProfileNameplate: { type: OptionType.BOOLEAN, default: false, description: "Fixes the rounding of the profile nameplate", onChange: () => apply() },
});

// ─── Selectors & Constants ────────────────────────────────────────────────────

const S = {
    previewButtonContainer: ".previewButtonContainer",
    previewButton: ".buttonPreview",
    previewButtonOn: ".previewButtonOn",
    previewButtonOff: ".previewButtonOff",
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

const svgs = {
    settings: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"var(--interactive-icon-default)\" fill-rule=\"evenodd\" d=\"M10.56 1.1c-.46.05-.7.53-.64.98.18 1.16-.19 2.2-.98 2.53-.8.33-1.79-.15-2.49-1.1-.27-.36-.78-.52-1.14-.24-.77.59-1.45 1.27-2.04 2.04-.28.36-.12.87.24 1.14.96.7 1.43 1.7 1.1 2.49-.33.8-1.37 1.16-2.53.98-.45-.07-.93.18-.99.64a11.1 11.1 0 0 0 0 2.88c.06.46.54.7.99.64 1.16-.18 2.2.19 2.53.98.33.8-.14 1.79-1.1 2.49-.36.27-.52.78-.24 1.14.59.77 1.27 1.45 2.04 2.04.36.28.87.12 1.14-.24.7-.95 1.7-1.43 2.49-1.1.8.33 1.16 1.37.98 2.53-.07.45.18.93.64.99a11.1 11.1 0 0 0 2.88 0c.46-.06.7-.54.64-.99-.18-1.16.19-2.2.98-2.53.8-.33 1.79.14 2.49 1.1.27.36.78.52 1.14.24.77-.59 1.45-1.27 2.04-2.04.28-.36.12-.87-.24-1.14-.96-.7-1.43-1.7-1.1-2.49.33-.8 1.37-1.16 2.53-.98.45.07.93-.18.99-.64a11.1 11.1 0 0 0 0-2.88c-.06-.46-.54-.7-.99-.64-1.16.18-2.2-.19-2.53-.98-.33-.8.14-1.79 1.1-2.49.36-.27.52-.78.24-1.14a11.07 11.07 0 0 0-2.04-2.04c-.36-.28-.87-.12-1.14.24-.7.96-1.7 1.43-2.49 1.1-.8-.33-1.16-1.37-.98-2.53.07-.45-.18-.93-.64-.99a11.1 11.1 0 0 0-2.88 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z\" clip-rule=\"evenodd\" class=\"\"></path></svg>",
    deafenOff: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"var(--interactive-icon-default)\" d=\"M12 3a9 9 0 0 0-8.95 10h1.87a5 5 0 0 1 4.1 2.13l1.37 1.97a3.1 3.1 0 0 1-.17 3.78 2.85 2.85 0 0 1-3.55.74 11 11 0 1 1 10.66 0c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86A9 9 0 0 0 12 3Z\" class=\"\"></path></svg>",
    deafenOn: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path class=\"audioIcon\" fill=\"var(--icon-voice-muted)\" d=\"M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4l20-20ZM17.06 2.94a.48.48 0 0 0-.11-.77A11 11 0 0 0 2.18 16.94c.14.3.53.35.76.12l3.2-3.2c.25-.25.15-.68-.2-.76a5 5 0 0 0-1.02-.1H3.05a9 9 0 0 1 12.66-9.2c.2.09.44.05.59-.1l.76-.76ZM20.2 8.28a.52.52 0 0 1 .1-.58l.76-.76a.48.48 0 0 1 .77.11 11 11 0 0 1-4.5 14.57c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86a9.1 9.1 0 0 0-.75-4.72ZM10.1 17.9c.25-.25.65-.18.74.14a3.1 3.1 0 0 1-.62 2.84 2.85 2.85 0 0 1-3.55.74.16.16 0 0 1-.04-.25l3.48-3.48Z\" class=\"\"></path></svg>",
    muteOff: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"var(--interactive-icon-default)\" d=\"M12 2a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Z\" class=\"\"></path><path fill=\"var(--interactive-icon-default)\" d=\"M6 10a1 1 0 0 0-2 0 8 8 0 0 0 7 7.94V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 10a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z\" class=\"\"></path></svg>",
    muteOn: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path class=\"audioIcon\" fill=\"var(--icon-voice-muted)\" d=\"m2.7 22.7 20-20a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4ZM10.8 17.32c-.21.21-.1.58.2.62V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 10a1 1 0 0 0-2 0c0 1.45-.52 2.79-1.38 3.83l-.02.02A5.99 5.99 0 0 1 12.32 16a.52.52 0 0 0-.34.15l-1.18 1.18ZM15.36 4.52c.15-.15.19-.38.08-.56A4 4 0 0 0 8 6v4c0 .3.03.58.1.86.07.34.49.43.74.18l6.52-6.52ZM5.06 13.98c.16.28.53.31.75.09l.75-.75c.16-.16.19-.4.08-.61A5.97 5.97 0 0 1 6 10a1 1 0 0 0-2 0c0 1.45.39 2.81 1.06 3.98Z\" class=\"\"></path></svg>",
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
    "Spotify Activity": ["Turn on Spotify activity", "Turn off Spotify activity"],
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
    color: string;
    opacity: number;
    radius: number;
    colorOff: string;
    opacityOff: number;
    radiusOff: number;
    colorfulActiveButton: boolean;
    colorfulInActiveButton: boolean;
    groupId?: string | null;
    linkedTo?: string[];
}

const BUTTON_CONFIG_KEY = "deracul-panel-layout-configs";
let buttonConfigs: Record<string, ButtonConfig> = {};
let configsLoaded = false;

let anyLinksConfigured = false;

function rebuildLinkIndex() {
    anyLinksConfigured = Object.values(buttonConfigs).some(cfg => (cfg.linkedTo?.length ?? 0) > 0);
}

function migrateLegacyGroups() {
    const byGroup = new Map<string, string[]>();
    for (const cfg of Object.values(buttonConfigs)) {
        if (!cfg.groupId) continue;
        const members = byGroup.get(cfg.groupId);
        if (members) members.push(cfg.label);
        else byGroup.set(cfg.groupId, [cfg.label]);
    }
    if (byGroup.size === 0) return;

    for (const members of byGroup.values()) {
        for (const label of members) {
            const others = members.filter(l => l !== label);
            const existing = new Set(getBtnCfg(label).linkedTo ?? []);
            for (const o of others) existing.add(o);
            buttonConfigs[label] = { ...getBtnCfg(label), label, linkedTo: Array.from(existing), groupId: null };
        }
    }
    saveConfigs();
}

async function loadConfigs() {
    buttonConfigs = (await DataStore.get<Record<string, ButtonConfig>>(BUTTON_CONFIG_KEY)) ?? {};
    configsLoaded = true;
    migrateLegacyGroups();
    rebuildLinkIndex();
}

function saveConfigs() {
    DataStore.set(BUTTON_CONFIG_KEY, buttonConfigs);
    rebuildLinkIndex();
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
    const { key } = e;
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
                const wasActive = isBtnActive(cfg.label);
                clickable.click();
                syncLinkedPartners(cfg.label, wasActive);
            }
        }
    }
}

function isBtnActive(label: string): boolean | null {
    const el = document.querySelector(getBtnSelector(label)) as HTMLElement | null;
    if (!el) return null;
    const scope = (el.querySelector("button") ?? el) as HTMLElement;

    const ariaChecked = scope.getAttribute("aria-checked") ?? el.getAttribute("aria-checked");
    if (ariaChecked === "true") return true;
    if (ariaChecked === "false") return false;

    const ariaPressed = scope.getAttribute("aria-pressed") ?? el.getAttribute("aria-pressed");
    if (ariaPressed === "true") return true;
    if (ariaPressed === "false") return false;

    if (el.classList.contains("plateMuted__67645") || scope.classList.contains("plateMuted__67645")) return true;

    return null;
}

function syncLinkedPartners(label: string, wasActive: boolean | null) {
    const partners = buttonConfigs[label]?.linkedTo;
    if (!partners?.length) return;

    const newActive = wasActive === null ? null : !wasActive;

    for (const other of partners) {
        if (other === label) continue;

        if (newActive !== null) {
            const partnerActive = isBtnActive(other);
            if (partnerActive === newActive) continue;
        }

        const el = document.querySelector(getBtnSelector(other)) as HTMLElement | null;
        const clickable = (el?.querySelector("button") ?? el) as HTMLElement | null;
        clickable?.click();
    }
}

function onGlobalClick(e: MouseEvent) {
    // Cheapest possible bail-out first: skip entirely (no DOM walk, no lookup)
    // whenever the user hasn't linked any buttons at all.
    if (!configsLoaded || !e.isTrusted || !anyLinksConfigured) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    const btnEl = target.closest<HTMLElement>("[data-deracul-label]");
    if (!btnEl) return;

    const label = btnEl.getAttribute("data-deracul-label");
    if (!label) return;

    const cfg = buttonConfigs[label];
    if (!cfg?.linkedTo?.length) return;

    const wasActive = isBtnActive(label);
    syncLinkedPartners(label, wasActive);
}

function isLinked(labelA: string, labelB: string): boolean {
    return getBtnCfg(labelA).linkedTo?.includes(labelB) ?? false;
}

function toggleGroupLink(labelA: string, labelB: string, linked: boolean) {
    const listA = new Set(getBtnCfg(labelA).linkedTo ?? []);
    const listB = new Set(getBtnCfg(labelB).linkedTo ?? []);

    if (linked) {
        listA.add(labelB);
        listB.add(labelA);
    } else {
        listA.delete(labelB);
        listB.delete(labelA);
    }

    setBtnCfg(labelA, { linkedTo: Array.from(listA) });
    setBtnCfg(labelB, { linkedTo: Array.from(listB) });
}

function getButtonLabel(button: HTMLElement): string | null {
    const customLabel = button.getAttribute("data-deracul-label");
    if (customLabel) return customLabel;

    const aria = button.getAttribute("aria-label")?.toLowerCase() || "";
    if (aria.includes("mute")) return "Mute";
    if (aria.includes("deafen")) return "Deafen";
    if (aria.includes("user settings")) return "User Settings";

    return null;
}

// ─── DOM Attribute Injection ──────────────────────────────────────────────────

let observer: ReturnType<typeof setInterval> | null = null;
let updateQueued = false;
let updateFrame = 0;

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
    observer = setInterval(() => {
        if (updateQueued) return;
        updateQueued = true;
        updateFrame = requestAnimationFrame(() => {
            updateQueued = false;
            updateFrame = 0;
            updateDomAttributes();
        });
    }, 1000);
    updateDomAttributes();
}

function stopObserver() {
    if (observer) {
        clearInterval(observer);
        observer = null;
    }
    if (updateFrame) {
        cancelAnimationFrame(updateFrame);
        updateFrame = 0;
    }
    updateQueued = false;
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

    // Modal
    lines.push(`
        .PanelLayoutModal { min-height: 0 !important; }
    `);

    // Native custom scrollbars
    lines.push(`
        .deracul-scrollbar::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
        .deracul-scrollbar::-webkit-scrollbar-track { background: var(--scrollbar-thin-track, transparent) !important; border-radius: 4px !important; }
        .deracul-scrollbar::-webkit-scrollbar-thumb { background: var(--scrollbar-thin-thumb, var(--background-tertiary, var(--background-surface-highest))) !important; border-radius: 4px !important; }
        .deracul-scrollbar { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thin-thumb, var(--background-tertiary, var(--background-surface-highest))) transparent; }
    `);

    // Icon color theming
    lines.push(`
        [title="Soundboard disabled when deafened"] *,
        [title="Open Soundboard"] *,
        [title="User Settings"] *,
        [title="Deafen"] *,
        [title="Mute"] * {
            fill: var(--background-brand);
        }

        [title="Soundboard disabled when deafened"] [stroke="rgb(88,101,242)"],
        [title="Open Soundboard"] [stroke="rgb(88,101,242)"],
        [title="User Settings"] [stroke="rgb(88,101,242)"],
        [title="Deafen"] [stroke="rgb(88,101,242)"],
        [title="Mute"] [stroke="rgb(88,101,242)"] {
            stroke: var(--background-brand);
        }
    `);
    // When a custom icon color is chosen (TestcordHelper -> user area buttons),
    // cascade it to the whole panel via --vc-plugin-icon-color so both plugin
    // buttons and native Mute/Deafen/Settings icons honor it. When no custom
    // color is set, leave the panel untouched so buttons keep their theme's
    // default colors. forceNativeButtonColor extends the same coloring to the
    // native buttons even without a custom color, using the icon color fallback.
    const iconColor = getTestcordIconColor("userAreaButtonIconColor");
    if (iconColor || st.forceNativeButtonColor) {
        const color = iconColor ?? ICON_COLOR_FALLBACK;
        lines.push(`
            ${S.panelContainer} { --vc-plugin-icon-color: ${color}; }

            [title="Soundboard disabled when deafened"] *,
            [title="Open Soundboard"] *,
            [title="User Settings"] *,
            [title="Deafen"] *,
            [title="Mute"] * {
                fill: currentColor;
            }

            [title="Soundboard disabled when deafened"] [stroke="rgb(88,101,242)"],
            [title="Open Soundboard"] [stroke="rgb(88,101,242)"],
            [title="User Settings"] [stroke="rgb(88,101,242)"],
            [title="Deafen"] [stroke="rgb(88,101,242)"],
            [title="Mute"] [stroke="rgb(88,101,242)"] {
                stroke: currentColor;
            }
        `);
    }

    // Base fixes
    lines.push(`${S.panelContainer} { height: auto !important; min-height: unset !important; }`);

    // Ensure cloned config SVGs display correctly
    lines.push(`
        .deracul-btn-preview svg, .deracul-btn-preview [class*="lottieIcon"] {
            width: 22px !important; height: 22px !important;
            color: var(--interactive-normal, var(--interactive-text-default)) !important; fill: currentColor !important;
        }
    `);

    // Preview icon color fix
    lines.push(`
        .icon-color-fix svg, .icon-color-fix svg * {
            color: var(--vc-plugin-icon-color, var(--interactive-normal, var(--header-secondary))) !important;
        }

        /* Added .whiteMaskRect to the :not() exclusions below */
        .icon-color-fix svg [fill]:not([fill=none], [fill=currentColor], .whiteMaskRect, .audioIcon) {
            fill: var(--vc-plugin-icon-color, var(--interactive-normal, var(--header-secondary))) !important;
        }

        .icon-color-fix svg [stroke]:not([stroke=none],[stroke=currentColor],.blackLine) {
            stroke: var(--vc-plugin-icon-color, var(--interactive-normal, var(--header-secondary))) !important;
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
                    height: 1px !important; background: var(--background-modifier-accent, var(--border-muted)) !important; margin: 2px 0 !important;
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

            if (settings.store.hideLine) {
                lines.push(`
                    ${S.panelContainer}::before {
                        opacity: 0
                    }
                `);
            }
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
    // Neutralize Discord's nameplate backdrop blur / status fills on panel buttons
    // (plateMuted / plateState classes paint them even with transparent background).
    lines.push(`${S.panelButtons} ${S.panelButton} { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }`);
    switch (st.buttonStyle) {
        case "filled":
            lines.push(`${S.panelButtons} ${S.panelButton}, ${S.previewButtonContainer} ${S.previewButton} { background: var(--background-modifier-hover, var(--background-mod-normal)) !important; border-radius: 8px !important; }
                        ${S.panelButtons} ${S.panelButton}:hover, ${S.previewButtonContainer} ${S.previewButton}:hover { background: var(--background-modifier-active, var(--background-mod-strong)) !important; }`);
            break;
        case "outlined":
            lines.push(`${S.panelButtons} ${S.panelButton}, ${S.previewButtonContainer} ${S.previewButton} { border: 1.5px solid var(--background-modifier-accent, var(--border-muted)) !important; border-radius: 8px !important; }`);
            break;
        case "outlineold":
            // Pre-fallback replica: relies on var(--background-modifier-accent) which
            // new Discord tokens dropped, so the border doesn't actually render.
            // People liked that buggy look, so it's kept as its own option.
            lines.push(`${S.panelButtons} ${S.panelButton}, ${S.previewButtonContainer} ${S.previewButton} { border: 1.5px solid var(--background-modifier-accent) !important; border-radius: 8px !important; }`);
            break;
        case "pill":
            lines.push(`${S.panelButtons} ${S.panelButton}, ${S.previewButtonContainer} ${S.previewButton} { background: var(--bplateStateackground-modifier-hover, var(--background-mod-normal)) !important; border-radius: 20px !important; }
                        ${S.panelButtons} ${S.panelButton}.plateState:hover, ${S.previewButtonContainer} ${S.previewButton}.plateState:hover { background: var(--background-modifier-active, var(--background-mod-strong)) !important; }`);
            break;
        case "square":
            lines.push(`${S.panelButtons} ${S.panelButton}, ${S.previewButtonContainer} ${S.previewButton} { background: var(--background-modifier-hover, var(--background-mod-normal)) !important; border-radius: 2px !important; }
                        ${S.panelButtons} ${S.panelButton}:hover, ${S.previewButtonContainer} ${S.previewButton}:hover { background: var(--background-modifier-active, var(--background-mod-strong)) !important; }`);
            break;
        default:
            // Keep plugin toggle buttons from showing Discord's own fill (colorBrand
            // hover background) underneath the glow/scale hover effects.
            lines.push(`${S.panelButtons} ${S.panelButton}, ${S.previewButtonContainer} ${S.previewButton} { background: transparent !important; }
                        ${S.panelButtons} ${S.panelButton}:hover, ${S.previewButtonContainer} ${S.previewButton}:hover { background: transparent !important; }`);
            break;
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
        case "scale": lines.push(`${S.panelButtons} ${S.panelButton}:hover, ${S.previewButton}:hover { transform: scale(1.15) !important; transition: transform 0.15s ease !important; }`); break;
        case "glow": lines.push(`${S.panelButtons} ${S.panelButton}:hover, ${S.previewButton}:hover { filter: drop-shadow(0 0 6px ${st.glowColor}) !important; transition: filter 0.15s ease !important; }`); break;
        case "bright": lines.push(`${S.panelButtons} ${S.panelButton}:hover, ${S.previewButton}:hover { filter: brightness(1.3) !important; transition: filter 0.15s ease !important; }`); break;
    }

    if ((st.buttonStyle === "outlineold" || st.buttonStyle === "outlined") && st.hoverEffect === "glow") {
        lines.push(`${S.panelButtons} ${S.panelButton}.plated__67645:not(.plateMuted__67645):hover { background: transparent !important }`);
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

    // Lock Button Positions logic (prevents long status text or screen sharing from pushing buttons down to a new row) max-width: calc(100% - 140px) !important;
    if (st.lockButtonPosition) {
        const isSplit = ["split_row", "split_grid2", "split_grid3", "split_grid4", "all_top"].includes(st.userPanelLayout);
        if (!isSplit) {
            lines.push(`${S.panelContainer} { flex-wrap: nowrap !important; }`);
            lines.push(`${S.panelButtons} { flex-wrap: nowrap !important; flex-shrink: 0 !important; }`);
        }
        lines.push(`
            ${S.accountWrapper} {
                max-width: 100% !important;
                flex: 1 !important;
            }
        `);
    }

    if (st.fixProfileNameplate) {
        lines.push(`
            ${S.panelContainer} .container_df39b2 { border-radius: 0px !important; }
            ${S.panelContainer} { border-radius: 0px !important; }
            .panels__5e434 { overflow: hidden !important; }
        `);
    }

    lines.push(`
        /* Fix active effect background pill visibility when hovering with scale up */
        ${S.panelContainer} [class*="item"]:hover [class*="pill"],
        ${S.panelContainer} [class*="wrapper"]:hover [class*="pill"],
        ${S.panelContainer} [class*="pill_"]:hover,
        ${S.panelContainer} [class*="pill"] > [class*="item"] {
            opacity: 1 !important;
            visibility: visible !important;
            z-index: 10 !important;
        }
    `);

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
                const isNative = NATIVE_BUTTON_LABELS.has(getCanonicalLabel(cfg.label));
                orderVal = isNative ? (40000 + cfg.order) : (10000 + cfg.order);
            }
            lines.push(`${sel} { order: ${orderVal} !important; }`);
        }

        // Custom Active Blob Color & Opacity per button
        if (cfg.colorfulActiveButton) {
            const baseColor = cfg.color || "#5865f2";
            const alpha = Math.round(((cfg.opacity ?? 100) / 100) * 255).toString(16).padStart(2, "0");
            const finalColor = `${baseColor.slice(0, 7)}${alpha}`;
            const finalRadius= cfg.radius != null ? `${cfg.radius}px` : "10px";

            // We add :hover overrides here so the active custom color isn't erased when interacting!
            lines.push(`
                ${S.previewButtonOn}[data-deracul-label="${cfg.label}"]:hover,
                ${S.previewButtonOn}[data-deracul-label="${cfg.label}"],
                ${sel} button[role="switch"][aria-checked="true"]:hover,
                ${sel} button[role="switch"][aria-checked="true"],
                ${sel} button[aria-checked="true"]:hover,
                ${sel} button[aria-checked="true"],
                ${sel}[aria-checked="true"]:hover,
                ${sel}[aria-checked="true"] {
                    background-color: ${finalColor} !important;
                    color: white !important;
                    border-radius: ${finalRadius} !important;
                }

                ${S.previewButtonOn}[data-deracul-label="${cfg.label}"] svg,
                ${sel} button[role="switch"][aria-checked="true"] svg,
                ${sel} button[aria-checked="true"] svg,
                ${sel}[aria-checked="true"] svg {
                    fill: white !important;
                    color: white !important;
                }
            `);
        }

        // Custom InActive Blob Color & Opacity per button
        if (cfg.colorfulInActiveButton) {
            const baseColor = cfg.colorOff || "#000000";
            const alpha = Math.round(((cfg.opacityOff ?? 22) / 100) * 255).toString(16).padStart(2, "0");
            const finalColor = `${baseColor.slice(0, 7)}${alpha}`;
            const finalColorHovered = `${baseColor.slice(0, 7)}${alpha + 0.11}`;
            const finalRadius= cfg.radiusOff != null ? `${cfg.radiusOff}px` : "10px";

            // We add :hover overrides here so the active custom color isn't erased when interacting!
            lines.push(`
                ${S.previewButtonOff}[data-deracul-label="${cfg.label}"],
                ${sel} button[role="switch"][aria-checked="false"],
                ${sel} button[aria-checked="false"],
                ${sel}[aria-checked="false"] {
                    --custom-nameplate-neutral-hovered: ${finalColorHovered} !important;
                    --custom-nameplate-neutral: ${finalColor} !important;
                    background-color: ${finalColor} !important;
                    border-radius: ${finalRadius} !important;
                }

                ${S.previewButtonOff}[data-deracul-label="${cfg.label}"]:hover,
                ${sel} button[role="switch"][aria-checked="false"]:hover,
                ${sel} button[aria-checked="false"]:hover,
                ${sel}[aria-checked="false"]:hover {
                    --custom-nameplate-neutral-hovered: ${finalColorHovered} !important;
                    --custom-nameplate-neutral: ${finalColor} !important;
                    background-color: ${finalColorHovered} !important;
                    border-radius: ${finalRadius} !important;
                }
            `);
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
    { value: "outlined", label: "Outlined" }, { value: "outlineold", label: "Outlined (old)" },
    { value: "pill", label: "Pill Shape" },
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

function ColorRow({ label, value, onChange, onBlur, }: { label: string; value: string; onChange: (v: string) => void; onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void; }) {
    return (
        <Flex flexDirection="column" gap={8} style={{ width: "100%" }}>
            <BaseText size="md" weight="medium" color="text-default">{label}</BaseText>
            <input
                type="color"
                value={value}
                onBlur={onBlur}
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
                backgroundColor: value ? "var(--brand-experiment, var(--switch-background-selected-default))" : "var(--background-modifier-accent, var(--border-muted))",
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

            // --- FIX: Remove broken Lottie masks and hidden layers ---
            clone.querySelectorAll("defs, mask, [clip-path]").forEach(node => {
                // Keep standard structural defs if needed, but strip Lottie runtime masks
                if (node.id && node.id.includes("__lottie_element")) {
                    node.remove();
                }
            });
            clone.querySelectorAll('[style*="display: none"]').forEach(node => node.remove());
            // ---------------------------------------------------------

            // --- FIX: Prevent SVG ID Collisions ---
            const uniqueSuffix = Math.random().toString(36).substring(2, 7);
            clone.querySelectorAll("[id]").forEach(node => {
                const oldId = node.id;
                const newId = `${oldId}-${uniqueSuffix}`;
                node.id = newId;

                clone.querySelectorAll("*").forEach(child => {
                    ["mask", "fill", "clip-path", "filter"].forEach(attr => {
                        const val = child.getAttribute(attr);
                        if (val && (val.includes(`url(#${oldId})`) || val.includes(`url('#${oldId}')`) || val.includes(`url("#${oldId}")`))) {
                            child.setAttribute(attr, `url(#${newId})`);
                        }
                    });
                });
            });
            // --------------------------------------

            iconHTML = clone.outerHTML;
        } else {
            const lottie = el.querySelector('[class*="lottieIcon"]');
            if (lottie) {
                const clone = lottie.cloneNode(true) as HTMLElement;
                iconHTML = clone.outerHTML;
            }
        }

        if (!iconHTML) {
            iconHTML = `<span style="font-size:11px;font-weight:bold;color:var(--text-muted);">${label.slice(0, 2).toUpperCase()}</span>`;
        }

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
        dragFromIndex.current = null;
        setActiveDragIndex(null);
        setDragOverIndex(null);
    };

    return (
        <Flex flexDirection="column" gap={16} style={{ paddingBottom: "12px" }}>
            <Paragraph style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                Drag a square left or right to change its order. Use the switches to show or hide them.
                Click the chips under "Group with" on a button's card to link it with others — activating one activates the rest.
            </Paragraph>

            {items.length === 0 ? (
                <BaseText size="sm" color="text-muted">No buttons detected. Open this tab again once buttons load.</BaseText>
            ) : (
                <>
                    <div style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: "12px",
                        backgroundColor: "var(--background-secondary, var(--background-surface-higher))",
                        borderRadius: "12px",
                        border: "1px solid var(--background-modifier-accent, var(--border-muted))",
                        padding: "16px",
                        position: "relative"
                    }}>
                        <div className="deracul-scrollbar" style={{
                            display: "flex",
                            flexDirection: "row",
                            gap: "12px",
                            overflowX: "auto",
                            flex: 1,
                            minWidth: 0,
                            alignItems: "center"
                        }}>
                            {items.map((item, index) => {
                                const cfg = getBtnCfg(item.id);
                                const isDragging = activeDragIndex === index;
                                const isOver = dragOverIndex === index && activeDragIndex !== index;
                                const canonical = getCanonicalLabel(item.label);
                                const isMute = canonical === "Mute";
                                const isDeafen = canonical === "Deafen";

                                return (
                                    <div
                                        key={item.id}
                                        draggable
                                        onDragStart={e => handleDragStart(e, index)}
                                        onDragOver={e => handleDragOver(e, index)}
                                        onDragLeave={() => { if (dragOverIndex === index) setDragOverIndex(null); } }
                                        onDrop={e => handleDrop(e, index)}
                                        onDragEnd={handleDragEnd}
                                        style={{
                                            display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
                                            cursor: isDragging ? "grabbing" : "grab",
                                            opacity: isDragging ? 0.35 : 1,
                                            transform: isDragging ? "scale(0.94)" : "scale(1)",
                                            borderLeft: isOver ? "3px solid var(--brand-experiment, var(--background-brand))" : "3px solid transparent",
                                            paddingLeft: isOver ? "6px" : "0px",
                                            transition: "border 0.1s ease, padding 0.1s ease, opacity 0.1s ease, transform 0.1s ease",
                                        }}
                                        title={item.label}
                                    >
                                        {isMute && (
                                            <div
                                                className="deracul-btn-preview"
                                                dangerouslySetInnerHTML={{ __html: svgs.muteOff }}
                                                style={{
                                                    width: "36px", height: "36px", borderRadius: "8px", backgroundColor: "var(--background-tertiary, var(--background-surface-highest))",
                                                    display: "flex", alignItems: "center", justifyContent: "center", color: item.id === "Game Activity" ? "var(--status-danger)" : "var(--text-default)",
                                                    boxShadow: "0 2px 4px rgba(0,0,0,0.15)", pointerEvents: "none"
                                                }} />
                                        )}

                                        {isDeafen && (
                                            <div
                                                className="deracul-btn-preview"
                                                dangerouslySetInnerHTML={{ __html: svgs.deafenOff }}
                                                style={{
                                                    width: "36px", height: "36px", borderRadius: "8px", backgroundColor: "var(--background-tertiary, var(--background-surface-highest))",
                                                    display: "flex", alignItems: "center", justifyContent: "center", color: item.id === "Game Activity" ? "var(--status-danger)" : "var(--text-default)",
                                                    boxShadow: "0 2px 4px rgba(0,0,0,0.15)", pointerEvents: "none"
                                                }} />
                                        )}

                                        {!isMute && !isDeafen && (
                                            <div
                                                className="deracul-btn-preview"
                                                dangerouslySetInnerHTML={{ __html: item.iconHTML }}
                                                style={{
                                                    width: "36px", height: "36px", borderRadius: "8px", backgroundColor: "var(--background-tertiary, var(--background-surface-highest))",
                                                    display: "flex", alignItems: "center", justifyContent: "center", color: item.id === "Game Activity" ? "var(--status-danger)" : "var(--text-default)",
                                                    boxShadow: "0 2px 4px rgba(0,0,0,0.15)", pointerEvents: "none"
                                                }} />
                                        )}

                                        <MiniToggle
                                            value={!cfg.hidden}
                                            onChange={v => {
                                                setBtnCfg(item.id, { hidden: !v });
                                                apply(); forceUpdate();
                                            } } />
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ position: "relative", flexShrink: 0 }}>
                            <button
                                onClick={() => {
                                    openModal(modalProps => (
                                        <SettingsModal modalProps={modalProps} />
                                    ));
                                } }
                                title="Button customization"
                                style={{
                                    width: "36px",
                                    height: "36px",
                                    borderRadius: "8px",
                                    border: "1px solid rgba(255, 255, 255, 0.1)",
                                    backgroundColor: "var(--background-tertiary, var(--background-surface-highest))",
                                    color: "var(--interactive-normal)",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "16px",
                                    transition: "background-color 0.15s ease, color 0.15s ease",
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = "var(--interactive-active)"}
                                onMouseLeave={e => e.currentTarget.style.color = "var(--interactive-normal)"}
                            >
                                <span dangerouslySetInnerHTML={{ __html: svgs.settings }} className="icon-color-fix" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                            </button>
                        </div>
                    </div>

                    <div className="deracul-scrollbar" style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        overflowX: "auto",
                        flex: 1,
                        minWidth: 0,
                    }}>
                        {items.map(item => {
                            const cfg = getBtnCfg(item.id);
                            const canonical = getCanonicalLabel(item.label);
                            const isMute = canonical === "Mute";
                            const isDeafen = canonical === "Deafen";
                            const listening = listeningId === item.id;

                            return (
                                <div key={item.id} style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "12px",
                                    backgroundColor: "var(--background-secondary, var(--background-surface-higher))",
                                    borderRadius: "12px",
                                    border: "1px solid var(--background-modifier-accent, var(--border-muted))",
                                    padding: "16px",
                                    position: "relative"
                                }}>
                                    <BaseText size="sm" color="text-muted" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        {isMute && (
                                            <span dangerouslySetInnerHTML={{ __html: svgs.muteOff }} className="icon-color-fix" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                                        )}

                                        {isDeafen && (
                                            <span dangerouslySetInnerHTML={{ __html: svgs.deafenOff }} className="icon-color-fix" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                                        )}

                                        {!isMute && !isDeafen && (
                                            <SvgPreview icon={item.iconHTML} enabled={true} />
                                        )}

                                        {cfg.label}
                                    </BaseText>
                                    <div style={{ display: "flex", gap: "8px", alignItems: "center", minHeight: "32px" }}>
                                        <Button
                                            size="small"
                                            variant="secondary"
                                            onClick={() => setListeningId(listening ? null : item.id)}
                                            style={{
                                                flex: 1,
                                                height: "32px",
                                                display: "inline-flex",
                                                alignItems: "center",
                                                justifyContent: "center"
                                            }}
                                        >
                                            {listening ? "Press key..." : (cfg.keybind || "Assign Key")}
                                        </Button>
                                        {cfg.keybind && (
                                            <Button
                                                size="small"
                                                variant="secondary"
                                                onClick={() => {
                                                    setBtnCfg(item.id, { keybind: null });
                                                    apply();
                                                    forceUpdate();
                                                }}
                                                style={{
                                                    width: "32px",
                                                    height: "32px",
                                                    minWidth: "32px",
                                                    padding: 0,
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    flexShrink: 0
                                                }}
                                            >
                                                ✕
                                            </Button>
                                        )}
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                        <BaseText size="xs" color="text-muted">Group with (click one activates the others)</BaseText>
                                        {items.length <= 1 ? (
                                            <BaseText size="xs" color="text-muted">No other buttons to group with.</BaseText>
                                        ) : (
                                            <div style={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                gap: "6px",
                                            }}>
                                                {items.filter(other => other.id !== item.id).map(other => {
                                                    const linked = isLinked(item.id, other.id);
                                                    return (
                                                        <button
                                                            key={other.id}
                                                            type="button"
                                                            onClick={() => {
                                                                toggleGroupLink(item.id, other.id, !linked);
                                                                apply();
                                                                forceUpdate();
                                                            }}
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: "6px",
                                                                height: "28px",
                                                                padding: "0 10px",
                                                                borderRadius: "14px",
                                                                border: linked
                                                                    ? "1px solid var(--brand-experiment, #5865f2)"
                                                                    : "1px solid var(--background-modifier-accent, var(--border-muted))",
                                                                background: linked
                                                                    ? "var(--brand-experiment, #5865f2)"
                                                                    : "var(--background-secondary-alt, var(--background-mod-subtle))",
                                                                color: linked ? "#fff" : "var(--text-default)",
                                                                fontSize: "12px",
                                                                cursor: "pointer",
                                                            }}
                                                        >
                                                            {linked && <span aria-hidden>✓</span>}
                                                            {other.id}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                    </div>
                </>
            )}
        </Flex>
    );
}

// ─── Modal Implementation ─────────────────────────────────────────────────────

type Tab = "panel" | "call" | "style" | "colors" | "hide" | "drag";

function PanelLayoutIcon({ style, className }: { style?: React.CSSProperties; className?: string; }) {
    return (
        <svg style={style} className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function SvgPreview({ icon, enabled = true }: { icon?: any; enabled?: boolean }) {
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useLayoutEffect(() => {
        if (!containerRef.current) return;
        containerRef.current.innerHTML = "";

        // Helper to extract or parse an SVG element from various inputs (DOM Element, String, or { __html: string })
        const getSvgNode = (input: any): SVGElement | null => {
            if (!input) return null;

            if (input instanceof Element) {
                return input.tagName.toLowerCase() === "svg" ? input as SVGElement : input.querySelector("svg");
            }

            const rawHtml = typeof input === "string" ? input : input.__html;
            if (typeof rawHtml === "string") {
                const doc = new DOMParser().parseFromString(rawHtml, "text/html");
                return doc.querySelector("svg");
            }

            return null;
        };

        const svgNode = getSvgNode(icon);
        if (!svgNode) return;

        const viewBox = svgNode.getAttribute("viewBox") || "0 0 24 24";
        const maskId = `toggleLineMask-${Math.random().toString(36).substring(2, 7)}`;

        // Extract viewBox dimensions
        const viewBoxValues = viewBox.split(/[\s,]+/).map(Number);
        const vbWidth = viewBoxValues[2] || 24;
        const vbHeight = viewBoxValues[3] || 24;

        // Standard proportional coordinates for custom strike-through line
        const lineCoords = {
            x1: String(Number((vbWidth * 0.88).toFixed(2))),
            y1: String(Number((vbHeight * 0.12).toFixed(2))),
            x2: String(Number((vbWidth * 0.12).toFixed(2))),
            y2: String(Number((vbHeight * 0.88).toFixed(2))),
        };

        const maskLineWidth = String(Number((vbWidth * 0.22).toFixed(2)));
        const overlayLineWidth = String(Number((vbWidth * 0.08).toFixed(2)));
        const lineCap = "round";

        // enabled = false -> OFF state (show strike-through)
        // enabled = true  -> ON state (clean icon)
        const showStrikeThrough = !enabled;

        // Clone target SVG hierarchy
        const contentClone = svgNode.cloneNode(true) as SVGElement;

        // 1. Remove hidden elements (e.g. Lottie hidden keyframes)
        contentClone.querySelectorAll("*").forEach(el => {
            const style = el.getAttribute("style") || "";
            const isHiddenAttr = el.getAttribute("display") === "none";
            const isHiddenStyle = /display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style);

            if (isHiddenAttr || isHiddenStyle) {
                el.remove();
            }
        });

        // 2. Strip native <line> tags
        contentClone.querySelectorAll("line").forEach(line => line.remove());

        // 3. Strip native diagonal slash <path> tags (e.g., Lottie diagonal slash paths)
        contentClone.querySelectorAll("path").forEach(path => {
            const d = path.getAttribute("d") || "";
            if (/M\s*-?10,\s*10.*10,\s*-10/i.test(d) || /M\s*-?10\s+10.*10\s+-10/i.test(d)) {
                path.remove();
            }
        });

        // 4. Remove all existing mask attributes from cloned nodes
        contentClone.querySelectorAll("[mask]").forEach(el => el.removeAttribute("mask"));

        const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        newSvg.setAttribute("width", "20");
        newSvg.setAttribute("height", "20");
        newSvg.setAttribute("viewBox", viewBox);

        // Preserve defs minus native masks
        contentClone.querySelectorAll("defs").forEach(defs => {
            const defsClone = defs.cloneNode(true) as Element;
            defsClone.querySelectorAll("mask").forEach(m => m.remove());
            newSvg.appendChild(defsClone);
        });

        // 5. Construct mask ONLY when strike-through is needed (enabled = false)
        if (showStrikeThrough) {
            const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs"); // Added defs wrapper
            const mask = document.createElementNS("http://www.w3.org/2000/svg", "mask");
            mask.setAttribute("id", maskId);

            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("width", "100%");
            rect.setAttribute("height", "100%");
            rect.setAttribute("fill", "#ffffff");
            rect.setAttribute("class", "whiteMaskRect"); // Added a specific class

            const maskLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
            maskLine.setAttribute("x1", lineCoords.x1);
            maskLine.setAttribute("y1", lineCoords.y1);
            maskLine.setAttribute("x2", lineCoords.x2);
            maskLine.setAttribute("y2", lineCoords.y2);
            maskLine.setAttribute("stroke", "#000000");
            maskLine.setAttribute("stroke-width", maskLineWidth);
            maskLine.setAttribute("stroke-linecap", lineCap);
            maskLine.setAttribute("class", "blackLine");

            mask.appendChild(rect);
            mask.appendChild(maskLine);

            // Append the mask to defs, and defs to the new SVG
            defs.appendChild(mask);
            newSvg.appendChild(defs);
        }

        // 6. Build Content Group
        const mainGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        mainGroup.setAttribute("fill", "currentColor");

        if (showStrikeThrough) {
            mainGroup.setAttribute("mask", `url(#${maskId})`);
        }

        Array.from(contentClone.childNodes).forEach(node => {
            if (node instanceof Element) {
                const tagName = node.tagName.toLowerCase();
                if (tagName !== "defs" && tagName !== "style" && tagName !== "mask") {
                    mainGroup.appendChild(node.cloneNode(true));
                }
            }
        });

        newSvg.appendChild(mainGroup);

        // 7. Append Overlay Line ONLY when strike-through is active (enabled = false)
        if (showStrikeThrough) {
            const overlayLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
            overlayLine.setAttribute("x1", lineCoords.x1);
            overlayLine.setAttribute("y1", lineCoords.y1);
            overlayLine.setAttribute("x2", lineCoords.x2);
            overlayLine.setAttribute("y2", lineCoords.y2);
            overlayLine.setAttribute("stroke", "currentColor");
            overlayLine.setAttribute("stroke-width", overlayLineWidth);
            overlayLine.setAttribute("stroke-linecap", lineCap);
            newSvg.appendChild(overlayLine);
        }

        containerRef.current.appendChild(newSvg);
    }, [icon, enabled]);

    return (
        <div
            className={"icon-color-fix"}
            ref={containerRef}
            style={{
                width: 20,
                height: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
            }}
        />
    );
}

function SubModalButton({
    item,
    cfg,
    handleOpenSubModal,
}: {
    item: BtnItem;
    cfg: any;
    handleOpenSubModal: (item: BtnItem) => void;
}) {
    const [isHovered, setIsHovered] = React.useState(false);

    const canonical = getCanonicalLabel(item.label);
    const isMute = canonical === "Mute";
    const isDeafen = canonical === "Deafen";

    return (
        <button
            onClick={() => handleOpenSubModal(item)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                padding: "9px 14px",
                border: `1px solid ${
                    isHovered
                        ? "color-mix(in srgb, var(--brand, var(--brand-experiment, var(--background-brand))) 32%, var(--border-subtle))"
                        : "color-mix(in srgb, var(--brand, var(--brand-experiment, var(--background-brand))) 14%, var(--border-subtle))"
                }`,
                borderRadius: "8px",
                background: isHovered ? "var(--background-base-low)" : "var(--background-base-lower-alt)",
                cursor: "pointer",
                overflow: "hidden",
                boxShadow: isHovered
                    ? "var(--elevation-low), 0 1px #ffffff0d inset"
                    : "0 1px #ffffff08 inset",
                transform: isHovered ? "translateY(-1px)" : "none",
                transition: "background-color .12s ease, border-color .12s ease, box-shadow .12s ease, transform .12s ease",
            }}
        >
            <BaseText size="sm" color="text-muted" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {isMute && (
                    <span dangerouslySetInnerHTML={{ __html: svgs.muteOff }} className="icon-color-fix" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                )}

                {isDeafen && (
                    <span dangerouslySetInnerHTML={{ __html: svgs.deafenOff }} className="icon-color-fix" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                )}

                {!isMute && !isDeafen && (
                    <SvgPreview icon={item.iconHTML} enabled={true} />
                )}

                {cfg.label}
            </BaseText>

            <span
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: "3px",
                    borderRadius: "8px 0 0 8px",
                    background: "var(--brand, var(--brand-experiment, var(--background-brand)))",
                    opacity: isHovered ? 1 : 0.35,
                    transform: isHovered ? "scaleY(1)" : "scaleY(.35)",
                    transformOrigin: "center",
                    transition: "opacity .16s ease, transform .16s ease",
                }}
            />
        </button>
    );
}

function SettingsModal({ modalProps }: { modalProps: RenderModalProps }) {
    const [items] = React.useState<BtnItem[]>(getBtnItems());

    const handleOpenSubModal = (item: BtnItem) => {
        openModal((props: RenderModalProps) => (
            <SettingModal modalProps={props} label={item.label} icon={{ __html: item.iconHTML }} />
        ));
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM} className="PanelLayoutModal">
            <ModalHeader>
                <BaseText size="sm" color="text-muted">Button customization</BaseText>
            </ModalHeader>

            <ModalContent>
                {items.length === 0 ? (
                    <BaseText size="sm" color="text-muted">
                        No buttons detected. Open this tab again once buttons load.
                    </BaseText>
                ) : (
                    <div className="deracul-scrollbar" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {(items ?? [])
                            .filter(item => !getBtnCfg(item.id).hidden &&
                                getCanonicalLabel(item.label) !== "Soundboard disabled when deafened" &&
                                getCanonicalLabel(item.label) !== "Open Soundboard" &&
                                getCanonicalLabel(item.label) !== "User Settings" &&
                                getCanonicalLabel(item.label) !== "Panel Layout"
                            )
                            .map(item => {
                                const cfg = getBtnCfg(item.id);

                                return (
                                    <SubModalButton
                                        key={item.id}
                                        item={item}
                                        cfg={cfg}
                                        handleOpenSubModal={handleOpenSubModal}
                                    />
                                );
                            })}
                    </div>
                )}
            </ModalContent>

            <ModalFooter>
                <Flex gap={8} justifyContent="flex-end" style={{ width: "100%" }}>
                    <div style={{ flex: 1 }} />
                    <Button variant="primary" onClick={() => modalProps.onClose()}>
                        Done
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>
    );
}

function SettingModal({ modalProps, label, icon }: { modalProps: RenderModalProps; label: any; icon?: any; }) {
    const [targetSize, setTargetSize] = React.useState({ width: "36px", height: "36px" });
    const [listeningId, setListeningId] = React.useState<string | null>(null);
    const [items] = React.useState<BtnItem[]>(getBtnItems());
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [, setResetKey] = React.useState(0);

    function resetDefaults({ id }: { id: any }) {
        for (const partner of getBtnCfg(id).linkedTo ?? []) {
            toggleGroupLink(id, partner, false);
        }

        setBtnCfg(id, {
            color: "#5865f2",
            opacity: 100,
            radius: 10,
            colorOff: "#000000",
            opacityOff: 22,
            radiusOff: 10,
            colorfulActiveButton: false,
            colorfulInActiveButton: false,
            keybind: null,
        });

        setResetKey(prev => prev + 1);
        apply(); forceUpdate();
    }

    React.useEffect(() => {
        if (!listeningId) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === "Escape") {
                setListeningId(null);
                return;
            }

            if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
                return;
            }

            const keys: string[] = [];
            if (e.ctrlKey) keys.push("Ctrl");
            if (e.altKey) keys.push("Alt");
            if (e.shiftKey) keys.push("Shift");
            if (e.metaKey) keys.push("Meta");

            keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
            const keybind = keys.join("+");

            setBtnCfg(listeningId, { keybind });
            apply();
            forceUpdate();
            setListeningId(null);
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [listeningId]);

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE} className="PanelLayoutModal">
            {items.filter(item => item.label === label).map(item => {
                const cfg = getBtnCfg(item.id);
                const canonical = getCanonicalLabel(item.label);
                const isUserSettings = canonical === "User Settings";
                const isPanelLayout = canonical === "Panel Layout";
                const isMute = canonical === "Mute";
                const isDeafen = canonical === "Deafen";

                const activeColor = cfg.color ?? "#5865f2";
                const activeOpacity = (cfg.opacity ?? 100) / 100;
                const activeRadius = (cfg.radius ?? 10);

                const InactiveColor = cfg.colorOff ?? "#000000";
                const InactiveOpacity = (cfg.opacityOff ?? 22) / 100;
                const InactiveRadius = (cfg.radiusOff ?? 10);

                const [{ customNameplateNeutral, customNameplateNeutralHovered }, setNameplateVars] = React.useState<{
                    customNameplateNeutral: string | null;
                    customNameplateNeutralHovered: string | null;
                }>({
                    customNameplateNeutral: null,
                    customNameplateNeutralHovered: null,
                });

                React.useLayoutEffect(() => {
                    // 1. Resolve target element (supports string label, React ref, DOM element, or panel button fallback)
                    let targetEl: Element | null = null;

                    if (typeof label === "string") {
                        targetEl =
                            document.querySelector(`${S.panelContainer} [data-deracul-label="${label}"]`) ||
                            document.querySelector(`${S.panelContainer} ${S.panelButton}`) ||
                            document.querySelector(S.panelButton);
                    } else if (label && "current" in label) {
                        targetEl = (label as React.RefObject<Element>).current;
                    } else if (label instanceof Element) {
                        targetEl = label;
                    } else {
                        targetEl =
                            document.querySelector(`${S.panelContainer} ${S.panelButton}`) ||
                            document.querySelector(S.panelButton);
                    }

                    if (!targetEl) return;

                    // 2. Read computed CSS custom properties after DOM layout
                    const computed = getComputedStyle(targetEl);
                    const neutral = computed.getPropertyValue("--custom-nameplate-neutral").trim();
                    const neutralHovered = computed.getPropertyValue("--custom-nameplate-neutral-hovered").trim();

                    setNameplateVars({
                        customNameplateNeutral: neutral || null,
                        customNameplateNeutralHovered: neutralHovered || null,
                    });

                    if (!label) return;

                    // Build query using S.panelContainer and the data attribute (or S.panelButton)
                    const buttonEl = document.querySelector<HTMLElement>(
                        `${S.panelContainer} [data-deracul-label="${label}"]`
                    ) || document.querySelector<HTMLElement>(
                        `${S.panelContainer} ${S.panelButton}[data-deracul-label="${label}"]`
                    );

                    if (!buttonEl) return;

                    const updateSize = () => {
                        const rect = buttonEl.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            setTargetSize({
                                width: `${rect.width}px`,
                                height: `${rect.height}px`,
                            });
                        }
                    };

                    updateSize();

                    // Recalculate if the button size updates dynamically
                    const observer = new ResizeObserver(updateSize);
                    observer.observe(buttonEl);

                    return () => observer.disconnect();
                }, []);

                function hexToRgba(hex: string, alpha: number) {
                    const cleanHex = hex.replace("#", "");
                    const bigint = parseInt(cleanHex.length === 3 ? cleanHex.split("").map(c => c + c).join("") : cleanHex, 16);
                    const r = (bigint >> 16) & 255;
                    const g = (bigint >> 8) & 255;
                    const b = bigint & 255;
                    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                }

                const isModified =
                    (cfg.color !== undefined && cfg.color !== "#5865f2") ||
                    (cfg.opacity !== undefined && cfg.opacity !== 100) ||
                    (cfg.radius !== undefined && cfg.radius !== 10) ||
                    (cfg.colorOff !== undefined && cfg.colorOff !== "#000000") ||
                    (cfg.opacityOff !== undefined && cfg.opacityOff !== 22) ||
                    (cfg.radiusOff !== undefined && cfg.radiusOff !== 10) ||
                    (cfg.colorfulActiveButton !== undefined && cfg.colorfulActiveButton !== false) ||
                    (cfg.colorfulInActiveButton !== undefined && cfg.colorfulInActiveButton !== false) ||
                    (cfg.keybind !== null);

                return (
                    <React.Fragment key={item.id}>
                        <ModalHeader>
                            <BaseText size="sm" weight="medium" color="text-default">{item.label}</BaseText>
                        </ModalHeader>

                        <ModalContent style={{ padding: "24px" }}>
                            <div className="deracul-scrollbar" style={{ overflow: "visible" }}>
                                <Flex flexDirection="column" gap={16} style={{ overflow: "visible", height: "100%" }}>
                                    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "row-reverse", gap: "24px", overflow: "visible" }}>
                                        <div style={{ flex: 1 }}>
                                            {!isUserSettings && !isPanelLayout && (
                                                <>
                                                    <>
                                                        <FormSwitch title="Colorful InActive button" description={isMute || isDeafen ? "Enable a colorful background when enabled" : "Enable a colorful background when disabled"} value={cfg.colorfulInActiveButton ?? false} onChange={v => {
                                                            setBtnCfg(item.id, { colorfulInActiveButton: v });
                                                            apply(); forceUpdate();
                                                        }} />
                                                        {cfg.colorfulInActiveButton && (
                                                            <>
                                                                <ColorRow
                                                                    label="InActive blob background color"
                                                                    value={cfg.colorOff ?? "#000000"}
                                                                    onChange={e => {
                                                                        setBtnCfg(item.id, { colorOff: e });
                                                                        apply();
                                                                    }}
                                                                    onBlur={() => forceUpdate()}
                                                                />
                                                                <SliderRow
                                                                    label="Opacity"
                                                                    min={0}
                                                                    max={100}
                                                                    value={cfg.opacityOff ?? 22}
                                                                    onChange={v => {
                                                                        setBtnCfg(item.id, { opacityOff: Number(Math.round(v)) });
                                                                        apply(); forceUpdate();
                                                                    }}
                                                                    unit="%"
                                                                />
                                                                <SliderRow
                                                                    label="Radius"
                                                                    min={0}
                                                                    max={20}
                                                                    value={cfg.radiusOff ?? 10}
                                                                    onChange={v => {
                                                                        setBtnCfg(item.id, { radiusOff: Number(Math.round(v)) });
                                                                        apply(); forceUpdate();
                                                                    }}
                                                                    unit="px"
                                                                />
                                                            </>
                                                        )}
                                                    </>
                                                    <FormSwitch title="Colorful active button" description="Enable a colorful background when enabled" value={cfg.colorfulActiveButton ?? false} onChange={v => {
                                                        setBtnCfg(item.id, { colorfulActiveButton: v });
                                                        apply(); forceUpdate();
                                                    }} hideBorder={!cfg.colorfulActiveButton} />
                                                    {cfg.colorfulActiveButton && (
                                                        <>
                                                            <ColorRow
                                                                label="Active blob background color"
                                                                value={cfg.color ?? "#5865f2"}
                                                                onChange={e => {
                                                                    setBtnCfg(item.id, { color: e });
                                                                    apply();
                                                                }}
                                                                onBlur={() => forceUpdate()}
                                                            />
                                                            <SliderRow
                                                                label="Opacity"
                                                                min={0}
                                                                max={100}
                                                                value={cfg.opacity ?? 100}
                                                                onChange={v => {
                                                                    setBtnCfg(item.id, { opacity: Number(Math.round(v)) });
                                                                    apply(); forceUpdate();
                                                                }}
                                                                unit="%"
                                                            />
                                                            <SliderRow
                                                                label="Radius"
                                                                min={0}
                                                                max={20}
                                                                value={cfg.radius ?? 10}
                                                                onChange={v => {
                                                                    setBtnCfg(item.id, { radius: Number(Math.round(v)) });
                                                                    apply(); forceUpdate();
                                                                }}
                                                                unit="px"
                                                            />
                                                        </>
                                                    )}
                                                </>
                                            )}
                                        </div>

                                        {!isPanelLayout && !isUserSettings && (
                                            <div style={{ alignContent: "center", flexShrink: 0, borderRight: "1px solid rgba(255, 255, 255, 0.08)", padding: "12px 20px 12px 12px", overflow: "visible" }}>
                                                <Flex flexDirection="column" alignItems="center" gap={16} className="previewButtonContainer" style={{ overflow: "visible" }}>
                                                    <Flex flexDirection="column" alignItems="center" gap={8}>
                                                        <BaseText size="xs" color="text-muted">OFF State</BaseText>
                                                        <button
                                                            className={!isMute && !isDeafen ? "buttonPreview previewButtonOff plateMuted__67645" : "buttonPreview previewButtonOff"}
                                                            data-deracul-label={cfg.label}
                                                            style={{
                                                                "--custom-nameplate-neutral-hovered": customNameplateNeutralHovered,
                                                                "--custom-nameplate-neutral": customNameplateNeutral,
                                                                width: targetSize.width,
                                                                height: targetSize.height,
                                                                background: "transparent",
                                                                color: "var(--vc-plugin-icon-color, var(--interactive-normal, var(--header-secondary)))",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "center",
                                                                userSelect: "none"
                                                            } as React.CSSProperties}
                                                        >
                                                            {isMute && (
                                                                <span dangerouslySetInnerHTML={{ __html: svgs.muteOff }} className="icon-color-fix" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                                                            )}

                                                            {isDeafen && (
                                                                <span dangerouslySetInnerHTML={{ __html: svgs.deafenOff }} className="icon-color-fix" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
                                                            )}

                                                            {!isMute && !isDeafen && (
                                                                <SvgPreview icon={icon} enabled={false} />
                                                            )}
                                                        </button>
                                                    </Flex>

                                                    <Flex flexDirection="column" alignItems="center" gap={8} className="previewButtonContainer">
                                                        <BaseText size="xs" color="text-muted">ON State</BaseText>
                                                        <button
                                                            className={isMute || isDeafen ? "buttonPreview previewButtonOn button__201d5 lookBlank__201d5 plateMuted__67645" : "buttonPreview previewButtonOn button__201d5 lookBlank__201d5"}
                                                            data-deracul-label={cfg.label}
                                                            style={{
                                                                "--custom-nameplate-neutral-hovered": customNameplateNeutralHovered,
                                                                "--custom-nameplate-neutral": customNameplateNeutral,
                                                                width: targetSize.width,
                                                                height: targetSize.height,
                                                                background: "transparent",
                                                                color: "var(--vc-plugin-icon-color, var(--interactive-normal, var(--header-secondary)))",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "center",
                                                                userSelect: "none"
                                                            } as React.CSSProperties}
                                                        >
                                                            {isMute && (
                                                                <span dangerouslySetInnerHTML={{ __html: svgs.muteOn }} className="icon-color-fix" style={{ display: "flex", alignItems: "center", justifyContent: "center" } as React.CSSProperties} />
                                                            )}

                                                            {isDeafen && (
                                                                <span dangerouslySetInnerHTML={{ __html: svgs.deafenOn }} className="icon-color-fix" style={{ display: "flex", alignItems: "center", justifyContent: "center" } as React.CSSProperties} />
                                                            )}

                                                            {!isMute && !isDeafen && (
                                                                <SvgPreview icon={icon} enabled={true} />
                                                            )}
                                                        </button>
                                                    </Flex>
                                                </Flex>
                                            </div>
                                        )}
                                    </div>
                                </Flex>
                            </div>
                        </ModalContent>

                        <ModalFooter>
                            <Flex gap={8} justifyContent="flex-end" style={{ width: "100%" }}>
                                {isModified && (
                                    <Button variant="secondary" onClick={() => resetDefaults({ id: item.id })}>
                                        Reset to Defaults
                                    </Button>
                                )}

                                <div style={{ flex: 1 }} />
                                <Button variant="primary" onClick={() => modalProps.onClose()}>
                                    Done
                                </Button>
                            </Flex>
                        </ModalFooter>
                    </React.Fragment>
                );
            })}
        </ModalRoot>
    );
}

function PanelLayoutModal({ modalProps }: { modalProps: RenderModalProps; }) {
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
        { id: "call", label: "Call Bar" },
        { id: "style", label: "Style" },
        { id: "colors", label: "Colors" },
        { id: "hide", label: "Visibility" },
        { id: "drag", label: "Buttons" },
    ];

    function resetDefaults() {
        set("userPanelLayout", "default");
        set("callControlsLayout", "default");
        set("buttonContainerSize", 36);
        set("iconSize", 20);
        set("buttonGap", 6);
        set("panelOpacity", 100);
        set("lockButtonPosition", false);
        set("hideLine", true);

        setResetKey(prev => prev + 1);
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader separator={false} style={{ padding: "24px 24px 0 24px", display: "flex", flexDirection: "column", position: "relative" }}>
                <Flex gap={12} alignItems="center" style={{ width: "100%", paddingRight: "36px" }}>
                    <div style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "40px", height: "40px", borderRadius: "12px",
                        background: "var(--brand-experiment, var(--background-brand))", color: "white"
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

                <Flex gap={24} style={{ marginTop: "24px", borderBottom: "1px solid var(--background-modifier-accent, var(--border-muted))", width: "100%" }}>
                    {tabsList.map(t => (
                        <div
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            style={{
                                paddingBottom: "12px",
                                cursor: "pointer",
                                borderBottom: tab === t.id ? "2px solid var(--brand-experiment, var(--background-brand))" : "2px solid transparent",
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
                                <FormSwitch title="Hide Dropdown Chevrons" description="Removes the tiny arrows next to Mute/Deafen." value={s.hideChevrons} onChange={v => set("hideChevrons", v)} />
                                <FormSwitch title="Lock Button Position" description="Prevents Mute, Deafen, and Settings buttons from dropping down to a new row when you have a long status or share screen." value={s.lockButtonPosition} onChange={v => set("lockButtonPosition", v)} />
                                <FormSwitch title="Hide line" description="Hide the line between user and buttons" value={s.hideLine} onChange={v => set("hideLine", v)} />
                                <FormSwitch title="Fix Profile Nameplate" description="Fixes the rounding of the profile nameplate" value={s.fixProfileNameplate} onChange={v => set("fixProfileNameplate", v)} hideBorder />
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
                        </>}

                        {tab === "colors" && <>
                            <Heading tag="h5">Panel Colors</Heading>
                            <Card variant="primary">
                                <ColorRow label="Panel Background Color" value={s.panelBackgroundColor} onChange={v => set("panelBackgroundColor", v)} />

                                {settings.store.hoverEffect === "glow" && <>
                                    <ColorRow label="Glow Hover Color" value={s.glowColor} onChange={v => set("glowColor", v)} />
                                </>}
                            </Card>

                            <Heading tag="h5">Native Buttons</Heading>
                            <Card variant="primary">
                                <FormSwitch title="Force Icon Color" description="Applies the icon color to Discord's native Mute, Deafen, and Settings buttons even when no custom icon color is set in TestcordHelper." value={s.forceNativeButtonColor} onChange={v => set("forceNativeButtonColor", v)} hideBorder />
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
                            <Heading tag="h5">Button Order & Hotkeys & Grouping</Heading>
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
    const handleOpen = () => openModal(modalProps => <PanelLayoutModal modalProps={modalProps} />);

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : "Panel Layout"}
            icon={<PanelLayoutIcon style={{ color: iconForeground }} />}
            role="button"
            plated={nameplate != null}
            onClick={handleOpen}
        />
    );
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "deraculpanellayout",
    description: "Customize the layout, style, and visibility of panel and call buttons.",
    authors: [TestcordDevs.deracul, TestcordDevs.Aviv, TestcordDevs.x2b, TestcordDevs.sirphantom89],
    dependencies: ["UserSettingsAPI"],
    settings,

    userAreaButton: { icon: PanelLayoutIcon, render: PanelLayoutButton },

    async start() {
        await loadConfigs();
        apply();
        startObserver();
        SettingsStore.addChangeListener("plugins.TestcordHelper.userAreaButtonIconColor", apply);
        document.addEventListener("keydown", onGlobalKeydown, true);
        document.addEventListener("click", onGlobalClick, true);
    },
    stop() {
        stopObserver();
        SettingsStore.removeChangeListener("plugins.TestcordHelper.userAreaButtonIconColor", apply);
        document.getElementById(STYLE_ID)?.remove();
        document.getElementById(CUSTOM_STYLE_ID)?.remove();
        document.removeEventListener("keydown", onGlobalKeydown, true);
        document.removeEventListener("click", onGlobalClick, true);
    }
});
