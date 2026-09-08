/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings, migratePluginSettings, SettingsStore } from "@api/Settings";
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
import definePlugin, { makeRange, OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModalLazy, React, Select, Slider } from "@webpack/common";

import {
    activityBannerPatches,
    BtnItem,
    devBannerPatches,
    getAllButtons,
    getBtnItems as getDetectedBtnItems,
    getBtnLabel,
    getCanonicalLabel,
    getPanelLayoutPlainSettings,
    getUserAreaOrder,
    getVisibleGameOrRpc,
    initModuleManager,
    LocalActivityStore,
    makeDevBanner,
    markRenderedInEI,
    ModulesContainer,
    ModulesTab,
    musicControlsPatches,
    PresenceStore,
    renderActivityIcon,
    renderActivityInfo,
    renderStreamingGame,
    RunningGameStore,
    S,
    saveRenderer,
    SelfPresenceStore,
    stopModuleManager,
    subscribeModules,
    svgs,
} from "./modules";

migratePluginSettings("deraculpanellayout", "PanelLayout");
migratePluginSettings("deracul-panel-layout", "PanelLayout");

// ─── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
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
    iconSize: { type: OptionType.SLIDER, description: "Icon size (px)", default: 20, markers: makeRange(12, 28, 2), stickToMarkers: false, onChange: () => apply() },
    buttonContainerSize: { type: OptionType.SLIDER, description: "Button overall size (px)", default: 36, markers: makeRange(24, 48, 4), stickToMarkers: false, onChange: () => apply() },
    buttonGap: { type: OptionType.SLIDER, description: "Gap between buttons (px)", default: 6, markers: makeRange(0, 12, 2), stickToMarkers: true, onChange: () => apply() },
    panelOpacity: { type: OptionType.SLIDER, description: "Panel buttons opacity (0-100)", default: 100, markers: makeRange(10, 100, 10), stickToMarkers: false, onChange: () => apply() },
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
    hideChevrons: { type: OptionType.BOOLEAN, default: false, description: "Hide dropdown chevrons next to Mute and Deafen", onChange: () => apply() },
    lockButtonPosition: { type: OptionType.BOOLEAN, default: false, description: "Lock Button Position (prevents buttons dropping down on long status)", onChange: () => apply() },
    callCompact: { type: OptionType.BOOLEAN, default: false, description: "Compact mode for call control buttons", onChange: () => apply() },
    hideDisconnect: { type: OptionType.BOOLEAN, default: false, description: "Hide the disconnect button", onChange: () => apply() },
    hideVoiceStatus: { type: OptionType.BOOLEAN, default: false, description: "Hide the 'Voice Connected' status text and channel name", onChange: () => apply() },
    hidePingIcon: { type: OptionType.BOOLEAN, default: false, description: "Hide the ping/connection quality icon", onChange: () => apply() },
    hideMute: { type: OptionType.BOOLEAN, default: false, description: "Hide Mute button", onChange: () => apply() },
    hideDeafen: { type: OptionType.BOOLEAN, default: false, description: "Hide Deafen button", onChange: () => apply() },
    hideSettings: { type: OptionType.BOOLEAN, default: false, description: "Hide User Settings button", onChange: () => apply() },
    hideCamera: { type: OptionType.BOOLEAN, default: false, description: "Hide camera button in call controls", onChange: () => apply() },
    hideScreenShare: { type: OptionType.BOOLEAN, default: false, description: "Hide screen share button in call controls", onChange: () => apply() },
    hideActivity: { type: OptionType.BOOLEAN, default: false, description: "Hide activity button in call controls", onChange: () => apply() },
    hideLine: { type: OptionType.BOOLEAN, default: true, description: "Hide the line between user and buttons", onChange: () => apply() },
    fixProfileNameplate: { type: OptionType.BOOLEAN, default: false, description: "Fixes the rounding of the profile nameplate", onChange: () => apply() },
});

// ─── Selectors & Constants ────────────────────────────────────────────────────

const NATIVE_BUTTON_LABELS = new Set([
    "Mute", "Deafen", "User Settings", "Input Options", "Output Options",
]);

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
    linkedTo?: string[];
}

const BUTTON_CONFIG_KEY = "panel-layout-configs";
const OLD_BUTTON_CONFIG_KEY = "deracul-panel-layout-configs";
let buttonConfigs: Record<string, ButtonConfig> = {};
let configsLoaded = false;
let unsubscribeModules: (() => void) | null = null;

try {
    const initialPlPlain = getPanelLayoutPlainSettings();
    if (initialPlPlain?.buttonConfigs && typeof initialPlPlain.buttonConfigs === "object") {
        buttonConfigs = { ...initialPlPlain.buttonConfigs };
        configsLoaded = true;
    }
} catch { }

let anyLinksConfigured = false;

function rebuildLinkIndex() {
    anyLinksConfigured = Object.values(buttonConfigs).some(cfg => (cfg.linkedTo?.length ?? 0) > 0);
}

rebuildLinkIndex();

async function loadConfigs() {
    try {
        const plPlain = getPanelLayoutPlainSettings();
        const diskConfigs = plPlain?.buttonConfigs;
        const dsConfigs = (await DataStore.get<Record<string, ButtonConfig>>(BUTTON_CONFIG_KEY)) ??
            (await DataStore.get<Record<string, ButtonConfig>>(OLD_BUTTON_CONFIG_KEY));
        buttonConfigs = { ...(diskConfigs ?? {}), ...(dsConfigs ?? {}) };
    } catch {
        buttonConfigs = (await DataStore.get<Record<string, ButtonConfig>>(BUTTON_CONFIG_KEY)) ??
            (await DataStore.get<Record<string, ButtonConfig>>(OLD_BUTTON_CONFIG_KEY)) ?? {};
    }
    configsLoaded = true;
    rebuildLinkIndex();
}

function saveConfigs() {
    try {
        const plPlain = getPanelLayoutPlainSettings();
        plPlain.buttonConfigs = buttonConfigs;
        SettingsStore.markAsChanged();
    } catch { }

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

function cssVal(val: string): string {
    return JSON.stringify(val);
}

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

    lines.push(`
        .SubModalButton {
            position: relative;
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 16px;
            padding: 9px 14px;
            border: 1px solid color-mix(in srgb, var(--brand, var(--brand-experiment, var(--background-brand))) 14%, var(--border-subtle));
            border-radius: 8px;
            background: var(--background-base-lower-alt);
            cursor: pointer;
            overflow: hidden;
            box-shadow: 0 1px #ffffff08 inset;
            transition: background-color .12s ease, border-color .12s ease, box-shadow .12s ease, transform .12s ease;
        }

        .SubModalButton:hover {
            background: var(--background-base-low);
            border-color:
                color-mix(in srgb, var(--brand, var(--brand-experiment, var(--background-brand))) 32%, var(--border-subtle));
            box-shadow: var(--elevation-low), 0 1px #ffffff0d inset;
            transform: translateY(-1px);
        }

        .SubModalButton:active {
            box-shadow: none;
            transform: translateY(0) scale(.99);
        }

        .SubModalButton:before {
            content: "";
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 3px;
            border-radius: 8px 0 0 8px;
            background: var(--brand, var(--brand-experiment, var(--background-brand)));
            opacity: .35;
            transform: scaleY(.35);
            transform-origin: center;
            transition: opacity .16s ease, transform .16s ease;
        }

        .SubModalButton:hover:before {
            opacity: 1;
            transform: scaleY(1);
        }
    `);
    lines.push(`
        .deracul-scrollbar::-webkit-scrollbar,
        .panellayout-scrollbar::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
        .deracul-scrollbar::-webkit-scrollbar-track,
        .panellayout-scrollbar::-webkit-scrollbar-track { background: var(--scrollbar-thin-track, transparent) !important; border-radius: 4px !important; }
        .deracul-scrollbar::-webkit-scrollbar-thumb,
        .panellayout-scrollbar::-webkit-scrollbar-thumb { background: var(--scrollbar-thin-thumb, var(--background-tertiary, var(--background-surface-highest))) !important; border-radius: 4px !important; }
        .deracul-scrollbar,
        .panellayout-scrollbar { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thin-thumb, var(--background-tertiary, var(--background-surface-highest))) transparent; }
    `);

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

    lines.push(`${S.panelContainer} { height: auto !important; min-height: unset !important; }`);

    lines.push(`
        .deracul-btn-preview svg, .deracul-btn-preview [class*="lottieIcon"] {
            width: 22px !important; height: 22px !important;
            color: var(--interactive-normal, var(--interactive-text-default)) !important; fill: currentColor !important;
        }
    `);

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
            lines.push(`${S.panelButtons} ${S.panelButton}, ${S.previewButtonContainer} ${S.previewButton} { background: transparent !important; }
                        ${S.panelButtons} ${S.panelButton}:hover, ${S.previewButtonContainer} ${S.previewButton}:hover { background: transparent !important; }`);
            break;
    }

    // Opacity
    if (st.panelOpacity !== 100) {
        lines.push(`${S.panelButtons} { opacity: ${st.panelOpacity / 100} !important; transition: opacity 0.2s !important; }`);
        lines.push(`${S.panelButtons}:hover { opacity: 1 !important; }`);
    }

    if (st.panelBackgroundColor) {
        lines.push(`${S.panelContainer} { background-color: ${st.panelBackgroundColor} !important; }`);
    }

    switch (st.hoverEffect) {
        case "scale": lines.push(`${S.panelButtons} ${S.panelButton}:hover, ${S.previewButton}:hover { transform: scale(1.15) !important; transition: transform 0.15s ease !important; }`); break;
        case "glow": lines.push(`${S.panelButtons} ${S.panelButton}:hover, ${S.previewButton}:hover { filter: drop-shadow(0 0 6px ${st.glowColor}) !important; transition: filter 0.15s ease !important; }`); break;
        case "bright": lines.push(`${S.panelButtons} ${S.panelButton}:hover, ${S.previewButton}:hover { filter: brightness(1.3) !important; transition: filter 0.15s ease !important; }`); break;
    }

    if ((st.buttonStyle === "outlineold" || st.buttonStyle === "outlined") && st.hoverEffect === "glow") {
        lines.push(`${S.panelButtons} ${S.panelButton}.plated__67645:not(.plateMuted__67645):hover { background: transparent !important }`);
    }

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

    lines.push(`
        section[class*="panels_"],
        .panels__5e434 {
            display: flex !important;
            flex-direction: column !important;
        }
    `);

    try {
        const userAreaOrder = getUserAreaOrder();
        userAreaOrder.forEach((item, idx) => {
            const orderVal = (idx + 1) * 10;
            const hiddenStyle = !item.enabled ? "display: none !important;" : "";

            if (item.type === "voice-connected") {
                lines.push(`
                    section[class*="panels_"] > ${S.callContainer},
                    section[class*="panels_"] > [class*="container_e131a9"],
                    section[class*="panels_"] > div:has(${S.callControls}) {
                        order: ${orderVal} !important;
                        ${hiddenStyle}
                    }
                `);
            } else if (item.type === "native-activity-banner" || item.id === "activity-banner" || item.moduleId === "activity-banner") {
                lines.push(`
                    section[class*="panels_"] > [class*="activityPanel_"],
                    section[class*="panels_"] > div:has([class*="activityPanel_"]),
                    .vc-panel-module-item[data-module-id="activity-banner"] {
                        order: ${orderVal} !important;
                        ${hiddenStyle}
                    }
                `);
            } else if (item.type === "account-panel") {
                lines.push(`
                    section[class*="panels_"] > ${S.panelContainer},
                    section[class*="panels_"] > [class*="container__37e49"] {
                        order: ${orderVal} !important;
                        ${hiddenStyle}
                    }
                `);
            } else if (item.type === "module" && item.moduleId) {
                lines.push(`
                    .vc-panel-module-item[data-module-id="${item.moduleId}"] {
                        order: ${orderVal} !important;
                        ${hiddenStyle}
                    }
                `);
            }
        });
    } catch { }

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

        if (cfg.colorfulActiveButton) {
            const baseColor = cfg.color || "#5865f2";
            const alpha = Math.round(((cfg.opacity ?? 100) / 100) * 255).toString(16).padStart(2, "0");
            const finalColor = `${baseColor.slice(0, 7)}${alpha}`;
            const finalRadius = cfg.radius != null ? `${cfg.radius}px` : "10px";

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

        if (cfg.colorfulInActiveButton) {
            const baseColor = cfg.colorOff || "#000000";
            const alpha = Math.round(((cfg.opacityOff ?? 22) / 100) * 255).toString(16).padStart(2, "0");
            const finalColor = `${baseColor.slice(0, 7)}${alpha}`;
            const finalColorHovered = `${baseColor.slice(0, 7)}${alpha + 0.11}`;
            const finalRadius = cfg.radiusOff != null ? `${cfg.radiusOff}px` : "10px";

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

    lines.push(`
        .vc-pl-subtab {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            margin-bottom: -1px;
            cursor: pointer;
            border-radius: 6px 6px 0 0;
            border-bottom: 2px solid transparent;
            background-color: transparent !important;
            transition: background-color 0.15s ease, border-color 0.15s ease;
            user-select: none;
        }
        .vc-pl-subtab:hover {
            background-color: var(--background-modifier-hover, var(--background-mod-subtle)) !important;
        }
        .vc-pl-subtab.active,
        .vc-pl-subtab.active:hover {
            border-bottom: 2px solid var(--brand-experiment, var(--background-brand)) !important;
            background-color: transparent !important;
        }
    `);

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

const MODAL_BODY_HEIGHT = 440;

// ─── Native-styled helper components ─────────────────────────────────────────

function SliderRow({ label, value, min, max, unit = "px", onChange, resetKey }: {
    label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void; resetKey?: number;
}) {
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

// ─── Color conversion helpers ────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace("#", "").trim();
    const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean.padEnd(6, "0").slice(0, 6);
    const n = parseInt(full, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
    const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
    return "#" + [r, g, b].map(v => clamp(v).toString(16).padStart(2, "0")).join("");
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    s /= 100; v /= 100;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rgb: [number, number, number];
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

function isValidHex(v: string): boolean {
    return /^#?[0-9a-fA-F]{6}$/.test(v.trim());
}

const COLOR_PRESETS = [
    "#EB459E", "#ED4245", "#FEE75C",
    "#57F287", "#00C7D9", "#FFFFFF", "#23272A",
];

// ─── Custom color picker ──────────────────────────────────────────────────────

function ColorPickerPanel({ value, onChange, preset }: { value: string; onChange: (hex: string) => void; preset: string; }) {
    const hsvRef = React.useRef<[number, number, number]>(rgbToHsv(...hexToRgb(value)));
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [hexInput, setHexInput] = React.useState(value.toUpperCase());
    const svRef = React.useRef<HTMLDivElement>(null);
    const hueRef = React.useRef<HTMLDivElement>(null);
    const draggingRef = React.useRef<"sv" | "hue" | null>(null);

    React.useEffect(() => {
        if (draggingRef.current) return;
        hsvRef.current = rgbToHsv(...hexToRgb(value));
        setHexInput(value.toUpperCase());
        forceUpdate();
    }, [value]);

    const commit = (h: number, s: number, v: number) => {
        hsvRef.current = [h, s, v];
        const hex = rgbToHex(...hsvToRgb(h, s, v));
        setHexInput(hex.toUpperCase());
        onChange(hex);
        forceUpdate();
    };

    const fromSvPointer = (clientX: number, clientY: number) => {
        const rect = svRef.current!.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
        commit(hsvRef.current[0], x * 100, (1 - y) * 100);
    };

    const fromHuePointer = (clientX: number) => {
        const rect = hueRef.current!.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        commit(x * 360, hsvRef.current[1], hsvRef.current[2]);
    };

    React.useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (draggingRef.current === "sv") fromSvPointer(e.clientX, e.clientY);
            else if (draggingRef.current === "hue") fromHuePointer(e.clientX);
        };
        const onUp = () => { draggingRef.current = null; };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
    }, []);

    const [h, s, v] = hsvRef.current;

    return (
        <div
            style={{
                marginTop: "10px", padding: "12px", borderRadius: "10px",
                background: "var(--background-secondary, var(--background-base-lower))",
                border: "1px solid var(--background-modifier-accent, var(--border-muted))",
            }}
            onMouseDown={e => e.stopPropagation()}
        >
            <div
                ref={svRef}
                onMouseDown={e => { draggingRef.current = "sv"; fromSvPointer(e.clientX, e.clientY); }}
                style={{
                    position: "relative", width: "100%", height: "120px", borderRadius: "8px",
                    cursor: "crosshair", userSelect: "none",
                    background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), hsl(${h}, 100%, 50%)`,
                }}
            >
                <div style={{
                    position: "absolute", left: `${s}%`, top: `${100 - v}%`,
                    width: "14px", height: "14px", borderRadius: "50%",
                    transform: "translate(-50%, -50%)",
                    border: "2px solid white", boxShadow: "0 0 0 1px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.4)",
                    background: value, pointerEvents: "none",
                }} />
            </div>

            <div
                ref={hueRef}
                onMouseDown={e => { draggingRef.current = "hue"; fromHuePointer(e.clientX); }}
                style={{
                    position: "relative", width: "100%", height: "12px", borderRadius: "6px",
                    marginTop: "10px", cursor: "pointer", userSelect: "none",
                    background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
                }}
            >
                <div style={{
                    position: "absolute", left: `${(h / 360) * 100}%`, top: "50%",
                    width: "8px", height: "16px", borderRadius: "3px",
                    transform: "translate(-50%, -50%)",
                    border: "2px solid white", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                    background: `hsl(${h}, 100%, 50%)`, pointerEvents: "none",
                }} />
            </div>

            <Flex alignItems="center" gap={8} style={{ marginTop: "10px" }}>
                <div style={{
                    width: "28px", height: "28px", borderRadius: "6px", flexShrink: 0,
                    background: value, border: "1px solid var(--background-modifier-accent, var(--border-muted))",
                }} />
                <input
                    value={hexInput}
                    onChange={e => {
                        const val = e.target.value;
                        setHexInput(val);
                        if (isValidHex(val)) {
                            const hex = val.startsWith("#") ? val : `#${val}`;
                            hsvRef.current = rgbToHsv(...hexToRgb(hex));
                            onChange(hex.toLowerCase());
                            forceUpdate();
                        }
                    }}
                    onBlur={() => {
                        if (!isValidHex(hexInput)) {
                            setHexInput(value.toUpperCase());
                        }
                    }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    spellCheck={false}
                    style={{
                        flex: 1, height: "28px", padding: "0 8px", borderRadius: "6px",
                        border: "1px solid var(--background-modifier-accent, var(--border-muted))",
                        background: "var(--background-secondary-alt, var(--background-mod-subtle))",
                        color: "var(--text-default)", fontFamily: "var(--font-code, monospace)",
                        fontSize: "12px", textTransform: "uppercase",
                    }}
                />
            </Flex>

            <Flex gap={6} style={{ marginTop: "10px", flexWrap: "wrap" }}>
                <div
                    key={preset}
                    onClick={() => {
                        hsvRef.current = rgbToHsv(...hexToRgb(preset));
                        setHexInput(preset.toUpperCase());
                        onChange(preset);
                        forceUpdate();
                    }}
                    title={preset}
                    style={{
                        width: "20px", height: "20px", borderRadius: "5px", cursor: "pointer",
                        background: preset,
                    }}
                />

                {COLOR_PRESETS.map(preset => (
                    <div
                        key={preset}
                        onClick={() => {
                            hsvRef.current = rgbToHsv(...hexToRgb(preset));
                            setHexInput(preset.toUpperCase());
                            onChange(preset);
                            forceUpdate();
                        }}
                        title={preset}
                        style={{
                            width: "20px", height: "20px", borderRadius: "5px", cursor: "pointer",
                            background: preset,
                        }}
                    />
                ))}
            </Flex>
        </div>
    );
}

function ColorRow({ label, value, onChange, onBlur, preset }: { label: string; value: string; onChange: (v: string) => void; onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void; preset: string; }) {
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const close = () => {
        setOpen(false);
        onBlur?.({} as React.FocusEvent<HTMLInputElement>);
    };

    const handleRealtimeChange = (newHex: string) => {
        onChange(newHex);
        onBlur?.({} as React.FocusEvent<HTMLInputElement>);
    };

    React.useEffect(() => {
        if (!open) return;
        const onDocMouseDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
        };
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
        document.addEventListener("mousedown", onDocMouseDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onDocMouseDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    return (
        <div ref={containerRef} style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            <BaseText size="md" weight="medium" color="text-default">{label}</BaseText>
            <Flex
                alignItems="center" gap={10}
                onClick={() => (open ? close() : setOpen(true))}
                style={{ cursor: "pointer" }}
            >
                <div style={{
                    position: "relative", width: "44px", height: "36px", flexShrink: 0,
                    borderRadius: "8px", overflow: "hidden", background: value,
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
                    transition: "border-color 0.15s ease",
                }} />
                <BaseText
                    size="sm" weight="medium" color="text-muted"
                    style={{
                        fontFamily: "var(--font-code, monospace)",
                        background: "var(--background-secondary-alt, var(--background-mod-subtle))",
                        borderRadius: "6px", padding: "6px 10px", textTransform: "uppercase",
                    }}
                >
                    {value}
                </BaseText>
            </Flex>
            {open && <ColorPickerPanel value={value} onChange={handleRealtimeChange} preset={preset} />}
        </div>
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

function getBtnItems(): BtnItem[] {
    return getDetectedBtnItems(id => getBtnCfg(id).order ?? 0);
}

function ButtonsDragTab() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [items, setItems] = React.useState<BtnItem[]>(() => getBtnItems());
    const [listeningId, setListeningId] = React.useState<string | null>(null);

    const dragFromIndex = React.useRef<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
    const [activeDragIndex, setActiveDragIndex] = React.useState<number | null>(null);
    const [dropPosition, setDropPosition] = React.useState<"before" | "after">("before");

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
        const img = new Image();
        img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
        e.dataTransfer.setDragImage(img, 0, 0);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
        if (dragOverIndex !== index) setDragOverIndex(index);
        if (dropPosition !== pos) setDropPosition(pos);
    };

    const commitDrop = (targetIndex: number) => {
        const fromIndex = dragFromIndex.current;
        if (fromIndex !== null && fromIndex >= 0 && fromIndex < items.length && targetIndex >= 0 && targetIndex < items.length) {
            const desiredSlot = dropPosition === "after" ? targetIndex + 1 : targetIndex;
            const insertIndex = fromIndex < desiredSlot ? desiredSlot - 1 : desiredSlot;
            if (insertIndex !== fromIndex && insertIndex >= 0 && insertIndex < items.length) {
                setItems(prev => {
                    const next = [...prev];
                    const [moved] = next.splice(fromIndex, 1);
                    next.splice(insertIndex, 0, moved);
                    next.forEach((it, idx) => setBtnCfg(it.id, { order: idx * 10 }));
                    apply();
                    return next;
                });
            }
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
            </Paragraph>

            {items.length === 0 ? (
                <BaseText size="sm" color="text-muted">No buttons detected. Open this tab again once buttons load.</BaseText>
            ) : (
                <>
                    <Card>
                        <div style={{
                            display: "flex",
                        }}>
                            <div className="deracul-scrollbar" style={{
                                display: "flex",
                                flexDirection: "row",
                                gap: "12px",
                                overflowX: "auto",
                                flex: 1,
                                minWidth: 0,
                                alignItems: "center",
                                padding: "4px 8px",
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
                                            onDragLeave={e => {
                                                if (!e.currentTarget.contains(e.relatedTarget as Node) && dragOverIndex === index) {
                                                    setDragOverIndex(null);
                                                }
                                            }}
                                            onDrop={e => handleDrop(e, index)}
                                            onDragEnd={handleDragEnd}
                                            style={{
                                                position: "relative",
                                                display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
                                                cursor: isDragging ? "grabbing" : "grab",
                                                opacity: isDragging ? 0.35 : 1,
                                                transform: isDragging ? "scale(0.94)" : "scale(1)",
                                                transition: "opacity 0.1s ease, transform 0.1s ease",
                                            }}
                                            title={item.label}
                                        >
                                            {isOver && (
                                                <div
                                                    style={{
                                                        position: "absolute",
                                                        top: "0px",
                                                        bottom: "0px",
                                                        left: dropPosition === "before" ? "-7px" : undefined,
                                                        right: dropPosition === "after" ? "-7px" : undefined,
                                                        width: "2px",
                                                        borderRadius: "2px",
                                                        backgroundColor: "var(--brand-experiment, var(--background-brand))",
                                                        zIndex: 10,
                                                        pointerEvents: "none",
                                                    }}
                                                />
                                            )}
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
                                                }} />
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ position: "relative", alignContent: "center", flexShrink: 0 }}>
                                <button
                                    onClick={() => {
                                        openModalLazy(async () => modalProps => (
                                            <SettingsModal modalProps={modalProps} />
                                        ));
                                    }}
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
                    </Card>

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
                                <Card key={item.id}>
                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "12px",
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
                                                                    borderRadius: "5vh",
                                                                    border: linked
                                                                        ? "1px solid var(--brand-experiment, var(--background-brand))"
                                                                        : "1px solid var(--background-modifier-accent, var(--border-muted))",
                                                                    background: linked
                                                                        ? "var(--brand-experiment, var(--background-brand))"
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
                                </Card>
                            );
                        })}

                    </div>
                </>
            )}
        </Flex>
    );
}

// ─── Modal Implementation ─────────────────────────────────────────────────────

type Tab = "panel" | "call" | "style" | "colors" | "hide" | "drag" | "modules";

function PanelLayoutIcon({ style, className }: { style?: React.CSSProperties; className?: string; }) {
    return (
        <svg style={style} className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="8" height="10" rx="2" fill="currentColor" />
            <rect x="3" y="15" width="8" height="6" rx="2" fill="currentColor" />
            <rect x="13" y="3" width="8" height="6" rx="2" fill="currentColor" />
            <rect x="13" y="11" width="8" height="10" rx="2" fill="currentColor" />
        </svg>
    );
}

// ─── Tab icons ────────────────────────────────────────────────────────────────

function TabPanelIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="8" height="10" rx="2" fill="currentColor" />
            <rect x="3" y="15" width="8" height="6" rx="2" fill="currentColor" />
            <rect x="13" y="3" width="8" height="6" rx="2" fill="currentColor" />
            <rect x="13" y="11" width="8" height="10" rx="2" fill="currentColor" />
        </svg>
    );
}

function TabCallIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2" y="8" width="20" height="10" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="8" cy="13" r="1.6" fill="currentColor" />
            <circle cx="12" cy="13" r="1.6" fill="currentColor" />
            <circle cx="16" cy="13" r="1.6" fill="currentColor" />
        </svg>
    );
}

function TabStyleIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.35" />
            <path d="M12 3a9 9 0 0 1 0 18 4.5 4.5 0 0 1-1-8.9A2 2 0 0 0 12 8a2 2 0 0 0 0-4 9 9 0 0 1 0-1Z" fill="currentColor" />
        </svg>
    );
}

function TabColorsIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="6" fill="currentColor" fillOpacity="0.55" />
            <circle cx="15" cy="9" r="6" fill="currentColor" fillOpacity="0.55" />
            <circle cx="12" cy="15" r="6" fill="currentColor" fillOpacity="0.55" />
        </svg>
    );
}

function TabVisibilityIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path fillRule="evenodd" clipRule="evenodd" d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3.8A3.2 3.2 0 1 0 12 15.2 3.2 3.2 0 0 0 12 8.8Z" fill="currentColor" />
        </svg>
    );
}

function TabButtonsIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="8" cy="6" r="1.8" fill="currentColor" />
            <circle cx="16" cy="6" r="1.8" fill="currentColor" />
            <circle cx="8" cy="12" r="1.8" fill="currentColor" />
            <circle cx="16" cy="12" r="1.8" fill="currentColor" />
            <circle cx="8" cy="18" r="1.8" fill="currentColor" />
            <circle cx="16" cy="18" r="1.8" fill="currentColor" />
        </svg>
    );
}

function TabModulesIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 4h7v7H4V4zm0 9h7v7H4v-7zm9-9h7v7h-7V4zm0 9h7v7h-7v-7z" fill="currentColor" />
        </svg>
    );
}

const TAB_ICONS: Record<Tab, () => React.ReactElement> = {
    panel: TabPanelIcon,
    call: TabCallIcon,
    style: TabStyleIcon,
    colors: TabColorsIcon,
    hide: TabVisibilityIcon,
    drag: TabButtonsIcon,
    modules: TabModulesIcon,
};

function SectionHeading({ children }: { children: React.ReactNode; }) {
    return (
        <Flex alignItems="center" gap={8} style={{ marginTop: "4px" }}>
            <div style={{
                width: "3px", height: "13px", borderRadius: "2px",
                background: "var(--brand-experiment, var(--background-brand))",
                flexShrink: 0,
            }} />
            <Heading tag="h5" style={{ margin: 0 }}>{children}</Heading>
        </Flex>
    );
}

function SvgPreview({ icon, enabled = true }: { icon?: any; enabled?: boolean; }) {
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useLayoutEffect(() => {
        if (!containerRef.current) return;
        containerRef.current.innerHTML = "";

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

        const viewBoxValues = viewBox.split(/[\s,]+/).map(Number);
        const vbWidth = viewBoxValues[2] || 24;
        const vbHeight = viewBoxValues[3] || 24;

        const lineCoords = {
            x1: String(Number((vbWidth * 0.88).toFixed(2))),
            y1: String(Number((vbHeight * 0.12).toFixed(2))),
            x2: String(Number((vbWidth * 0.12).toFixed(2))),
            y2: String(Number((vbHeight * 0.88).toFixed(2))),
        };

        const maskLineWidth = String(Number((vbWidth * 0.22).toFixed(2)));
        const overlayLineWidth = String(Number((vbWidth * 0.08).toFixed(2)));
        const lineCap = "round";

        const showStrikeThrough = !enabled;

        const contentClone = svgNode.cloneNode(true) as SVGElement;

        contentClone.querySelectorAll("*").forEach(el => {
            const style = el.getAttribute("style") || "";
            const isHiddenAttr = el.getAttribute("display") === "none";
            const isHiddenStyle = /display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style);

            if (isHiddenAttr || isHiddenStyle) {
                el.remove();
            }
        });

        contentClone.querySelectorAll("line").forEach(line => line.remove());

        contentClone.querySelectorAll("path").forEach(path => {
            const d = path.getAttribute("d") || "";
            if (/M\s*-?10,\s*10.*10,\s*-10/i.test(d) || /M\s*-?10\s+10.*10\s+-10/i.test(d)) {
                path.remove();
            }
        });

        contentClone.querySelectorAll("[mask]").forEach(el => el.removeAttribute("mask"));

        const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        newSvg.setAttribute("width", "20");
        newSvg.setAttribute("height", "20");
        newSvg.setAttribute("viewBox", viewBox);

        contentClone.querySelectorAll("defs").forEach(defs => {
            const defsClone = defs.cloneNode(true) as Element;
            defsClone.querySelectorAll("mask").forEach(m => m.remove());
            newSvg.appendChild(defsClone);
        });

        if (showStrikeThrough) {
            const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            const mask = document.createElementNS("http://www.w3.org/2000/svg", "mask");
            mask.setAttribute("id", maskId);

            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("width", "100%");
            rect.setAttribute("height", "100%");
            rect.setAttribute("fill", "#ffffff");
            rect.setAttribute("class", "whiteMaskRect");

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

            defs.appendChild(mask);
            newSvg.appendChild(defs);
        }

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
    const canonical = getCanonicalLabel(item.label);
    const isMute = canonical === "Mute";
    const isDeafen = canonical === "Deafen";

    return (
        <button
            onClick={() => handleOpenSubModal(item)}
            className="SubModalButton"
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
        </button>
    );
}

function SettingsModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [items] = React.useState<BtnItem[]>(getBtnItems());

    const handleOpenSubModal = (item: BtnItem) => {
        openModalLazy(async () => (props: RenderModalProps) => (
            <SettingModal modalProps={props} label={item.label} icon={{ __html: item.iconHTML }} />
        ));
    };

    return (
        <Modal title={<BaseText size="sm" color="text-muted">Button customization</BaseText>} {...modalProps} size="md">
            {items.length === 0 ? (
                <BaseText size="sm" color="text-muted">
                    No buttons detected. Open this tab again once buttons load.
                </BaseText>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", maxHeight: "200px" }}>
                    <div className="deracul-scrollbar" style={{ paddingTop: "1px", overflowY: "auto", paddingRight: "4px" }}>
                        <Flex flexDirection="column" gap={8}>
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
                        </Flex>
                    </div>
                </div>
            )}

            <Flex gap={8} justifyContent="flex-end" style={{ width: "100%", marginTop: "var(--custom-modal-padding-md)" }}>
                <div style={{ flex: 1 }} />
                <Button
                    variant="secondary"
                    style={{ backgroundColor: "#174b71", color: "#fff" }}
                    onClick={() => modalProps.onClose()}
                >
                    Done
                </Button>
            </Flex>
        </Modal>
    );
}

function SettingModalItem({
    item,
    label,
    icon,
    modalProps,
    resetDefaults,
    forceUpdate
}: {
    item: BtnItem;
    label: any;
    icon?: any;
    modalProps: RenderModalProps;
    resetDefaults: (arg: { id: any; }) => void;
    forceUpdate: () => void;
}) {
    const cfg = getBtnCfg(item.id);
    const canonical = getCanonicalLabel(item.label);
    const isUserSettings = canonical === "User Settings";
    const isPanelLayout = canonical === "Panel Layout";
    const isMute = canonical === "Mute";
    const isDeafen = canonical === "Deafen";

    const [targetSize, setTargetSize] = React.useState({ width: "36px", height: "36px" });
    const [{ customNameplateNeutral, customNameplateNeutralHovered }, setNameplateVars] = React.useState<{
        customNameplateNeutral: string | null;
        customNameplateNeutralHovered: string | null;
    }>({
        customNameplateNeutral: null,
        customNameplateNeutralHovered: null,
    });

    React.useLayoutEffect(() => {
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

        const computed = getComputedStyle(targetEl);
        const neutral = computed.getPropertyValue("--custom-nameplate-neutral").trim();
        const neutralHovered = computed.getPropertyValue("--custom-nameplate-neutral-hovered").trim();

        setNameplateVars({
            customNameplateNeutral: neutral || null,
            customNameplateNeutralHovered: neutralHovered || null,
        });

        if (!label) return;

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

        const observer = new ResizeObserver(updateSize);
        observer.observe(buttonEl);

        return () => observer.disconnect();
    }, [label]);

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
        <Modal
            title={<BaseText size="sm" weight="medium" color="text-default">{item.label}</BaseText>}
            actionBarInput={
                <div style={{ display: "flex", justifyContent: isModified ? "space-between" : "flex-end", width: "100%", alignItems: "center" }}>
                    {isModified ? (
                        <Button
                            variant="secondary"
                            style={{ backgroundColor: "#174b71", color: "#fff" }}
                            onClick={() => resetDefaults({ id: item.id })}
                        >
                            Reset to Defaults
                        </Button>
                    ) : <div />}
                    <Button
                        variant="secondary"
                        style={{ backgroundColor: "#174b71", color: "#fff" }}
                        onClick={() => modalProps.onClose()}
                    >
                        Done
                    </Button>
                </div>
            }
            {...modalProps}
            size="xl"
        >
            <div style={{ display: "flex", flexDirection: "row-reverse", gap: "24px", height: `${MODAL_BODY_HEIGHT}px` }}>
                <div className="deracul-scrollbar" style={{ flex: 1, height: "100%", overflowY: "auto", paddingRight: "4px" }}>
                    <Flex flexDirection="column" gap={16}>
                        {!isUserSettings && !isPanelLayout && (
                            <>
                                <FormSwitch title="Colorful InActive button" description={isMute || isDeafen ? "Enable a colorful background when enabled" : "Enable a colorful background when disabled"} value={cfg.colorfulInActiveButton ?? false} onChange={v => {
                                    setBtnCfg(item.id, { colorfulInActiveButton: v });
                                    apply(); forceUpdate();
                                }} />
                                {cfg.colorfulInActiveButton && (
                                    <div style={{ marginBottom: "16px" }}>
                                        <Card>
                                            <div style={{ display: "grid", gap: "8px" }}>
                                                <ColorRow
                                                    label="InActive blob background color"
                                                    value={cfg.colorOff ?? "#000000"}
                                                    onChange={e => {
                                                        setBtnCfg(item.id, { colorOff: e });
                                                        apply();
                                                    }}
                                                    onBlur={() => forceUpdate()}
                                                    preset="#000000"
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
                                            </div>
                                        </Card>
                                    </div>
                                )}
                                <FormSwitch title="Colorful active button" description="Enable a colorful background when enabled" value={cfg.colorfulActiveButton ?? false} onChange={v => {
                                    setBtnCfg(item.id, { colorfulActiveButton: v });
                                    apply(); forceUpdate();
                                }} hideBorder={!cfg.colorfulActiveButton} />
                                {cfg.colorfulActiveButton && (
                                    <Card>
                                        <div style={{ display: "grid", gap: "8px" }}>
                                            <ColorRow
                                                label="Active blob background color"
                                                value={cfg.color ?? "#5865f2"}
                                                onChange={e => {
                                                    setBtnCfg(item.id, { color: e });
                                                    apply();
                                                }}
                                                onBlur={() => forceUpdate()}
                                                preset="#5865f2"
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
                                        </div>
                                    </Card>
                                )}
                            </>
                        )}
                    </Flex>
                </div>

                {!isPanelLayout && !isUserSettings && (
                    <div style={{ flexShrink: 0, borderRight: "1px solid rgba(255, 255, 255, 0.08)", padding: "12px 20px 12px 12px", display: "flex", alignItems: "center" }}>
                        <Flex flexDirection="column" alignItems="center" gap={16} className="previewButtonContainer">
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

        </Modal>
    );
}

function SettingModal({ modalProps, label, icon }: { modalProps: RenderModalProps; label: any; icon?: any; }) {
    const [listeningId, setListeningId] = React.useState<string | null>(null);
    const [items] = React.useState<BtnItem[]>(getBtnItems());
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [, setResetKey] = React.useState(0);

    function resetDefaults({ id }: { id: any; }) {
        setBtnCfg(id, {
            color: "#5865f2",
            opacity: 100,
            radius: 10,
            colorOff: "#000000",
            opacityOff: 22,
            radiusOff: 10,
            colorfulActiveButton: false,
            colorfulInActiveButton: false,
        });

        setResetKey(prev => prev + 1);
        apply();
        forceUpdate();
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

    const filteredItems = items.filter(item => item.label === label);

    return (
        <>
            {filteredItems.map(item => (
                <SettingModalItem
                    key={item.id}
                    item={item}
                    label={label}
                    icon={icon}
                    modalProps={modalProps}
                    resetDefaults={resetDefaults}
                    forceUpdate={forceUpdate}
                />
            ))}
        </>
    );
}

function PanelLayoutModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [tab, setTab] = React.useState<Tab>("panel");
    const [resetKey, setResetKey] = React.useState(0);

    function set<K extends keyof typeof settings.store>(key: K, val: (typeof settings.store)[K]) {
        settings.store[key] = val;
        try {
            const plPlain = getPanelLayoutPlainSettings();
            plPlain[key] = val;
            SettingsStore.markAsChanged();
        } catch {
        }
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
        { id: "modules", label: "Modules" },
    ];

    function resetDefaults() {
        set("userPanelLayout", "default");
        set("callControlsLayout", "default");
        set("iconSize", 20);
        set("buttonContainerSize", 36);
        set("buttonGap", 6);
        set("panelOpacity", 100);
        set("buttonStyle", "default");
        set("hoverEffect", "default");
        set("panelBackgroundColor", "#0e1852");
        set("glowColor", "#ffffff");
        set("forceNativeButtonColor", false);
        set("hideChevrons", false);
        set("lockButtonPosition", false);
        set("callCompact", false);
        set("hideDisconnect", false);
        set("hideVoiceStatus", false);
        set("hidePingIcon", false);
        set("hideMute", false);
        set("hideDeafen", false);
        set("hideSettings", false);
        set("hideCamera", false);
        set("hideScreenShare", false);
        set("hideActivity", false);
        set("hideLine", true);
        set("fixProfileNameplate", false);

        for (const item of getBtnItems()) {
            const { id } = item;
            const cfg = getBtnCfg(id);

            for (const partner of cfg?.linkedTo ?? []) {
                toggleGroupLink(id, partner, false);
            }

            setBtnCfg(id, {
                keybind: null,
                linkedTo: [],
                hidden: undefined,
                order: undefined,
            });
        }

        setResetKey(prev => prev + 1);
    }

    return (
        <Modal title={
            <>
                <Flex gap={12} alignItems="center" style={{ width: "100%", paddingRight: "36px" }}>
                    <div style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "40px", height: "40px", borderRadius: "12px",
                        background: "linear-gradient(160deg, color-mix(in srgb, var(--brand-experiment, var(--background-brand)) 100%, white 12%), var(--brand-experiment, var(--background-brand)))",
                        color: "white",
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

                <Flex gap={4} style={{ marginTop: "24px", borderBottom: "1px solid var(--background-modifier-accent, var(--border-muted))", width: "100%" }}>
                    {tabsList.map(t => {
                        const Icon = TAB_ICONS[t.id];
                        const active = tab === t.id;
                        return (
                            <div
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                className={`vc-pl-subtab ${active ? "active" : ""}`}
                            >
                                <span style={{ display: "flex", color: active ? "var(--brand-experiment, var(--background-brand))" : "var(--text-muted)", transition: "color 0.15s ease" }}>
                                    <Icon />
                                </span>
                                <BaseText size="md" weight={active ? "semibold" : "medium"} color={active ? "text-strong" : "text-muted"}>
                                    {t.label}
                                </BaseText>
                            </div>
                        );
                    })}
                </Flex>
            </>}
            actionBarInput={
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                    <Button
                        variant="secondary"
                        style={{ backgroundColor: "#174b71", color: "#fff" }}
                        onClick={resetDefaults}
                    >
                        Reset to Defaults
                    </Button>
                    <Button
                        variant="secondary"
                        style={{ backgroundColor: "#174b71", color: "#fff" }}
                        onClick={() => modalProps.onClose()}
                    >
                        Done
                    </Button>
                </div>
            }
            {...modalProps}
            size="xl"
        >
            <div className="deracul-scrollbar" style={{ height: `${MODAL_BODY_HEIGHT}px`, overflowY: "auto", paddingRight: "4px" }}>
                <Flex flexDirection="column" gap={16}>
                    {tab === "panel" && <>
                        <SectionHeading>Layout Structure</SectionHeading>
                        <Card variant="primary">
                            <Dropdown label="User Panel Alignment" options={PANEL_LAYOUTS} value={s.userPanelLayout} onChange={v => set("userPanelLayout", v)} />
                        </Card>

                        <SectionHeading>Component Dimensions</SectionHeading>
                        <Card variant="primary">
                            <SliderRow label="Button Box Size" value={s.buttonContainerSize} min={24} max={48} onChange={v => set("buttonContainerSize", Math.round(v))} resetKey={resetKey} />
                            <SliderRow label="Vector Icon Size" value={s.iconSize} min={12} max={28} onChange={v => set("iconSize", Math.round(v))} resetKey={resetKey} />
                            <SliderRow label="Margin / Gap" value={s.buttonGap} min={0} max={12} onChange={v => set("buttonGap", Math.round(v))} resetKey={resetKey} />
                            <SliderRow label="Idle Opacity" value={s.panelOpacity} min={10} max={100} unit="%" onChange={v => set("panelOpacity", Math.round(v))} resetKey={resetKey} />
                        </Card>

                        <SectionHeading>Extra Features</SectionHeading>
                        <Card variant="primary">
                            <FormSwitch title="Hide Dropdown Chevrons" description="Removes the tiny arrows next to Mute/Deafen." value={s.hideChevrons} onChange={v => set("hideChevrons", v)} />
                            <FormSwitch title="Lock Button Position" description="Prevents Mute, Deafen, and Settings buttons from dropping down to a new row when you have a long status or share screen." value={s.lockButtonPosition} onChange={v => set("lockButtonPosition", v)} />
                            <FormSwitch title="Hide line" description="Hide the line between user and buttons" value={s.hideLine} onChange={v => set("hideLine", v)} />
                            <FormSwitch title="Fix Profile Nameplate" description="Fixes the rounding of the profile nameplate" value={s.fixProfileNameplate} onChange={v => set("fixProfileNameplate", v)} hideBorder />
                        </Card>
                    </>}

                    {tab === "call" && <>
                        <SectionHeading>Action Bar Layout</SectionHeading>
                        <Card variant="primary">
                            <Dropdown label="Call Controls Alignment" options={CALL_LAYOUTS} value={s.callControlsLayout} onChange={v => set("callControlsLayout", v)} />
                        </Card>

                        <SectionHeading>Voice Settings</SectionHeading>
                        <Card variant="primary">
                            <FormSwitch title="Compact Mode" description="Reduces padding inside call buttons to save space." value={s.callCompact} onChange={v => set("callCompact", v)} />
                            <FormSwitch title="Hide Disconnect Button" value={s.hideDisconnect} onChange={v => set("hideDisconnect", v)} />
                            <FormSwitch title="Hide Voice Status Text" description="Removes 'Voice Connected' and channel name details." value={s.hideVoiceStatus} onChange={v => set("hideVoiceStatus", v)} />
                            <FormSwitch title="Hide Network Ping Icon" value={s.hidePingIcon} onChange={v => set("hidePingIcon", v)} hideBorder />
                        </Card>
                    </>}

                    {tab === "style" && <>
                        <SectionHeading>Aesthetics</SectionHeading>
                        <Card variant="primary">
                            <div style={{ display: "grid", gap: "8px" }}>
                                <Dropdown label="Button Base Style" options={BUTTON_STYLES} value={s.buttonStyle} onChange={v => set("buttonStyle", v)} />
                                <Dropdown label="Interaction Hover Effect" options={HOVER_EFFECTS} value={s.hoverEffect} onChange={v => set("hoverEffect", v)} />
                            </div>
                        </Card>
                    </>}

                    {tab === "colors" && <>
                        <SectionHeading>Panel Colors</SectionHeading>
                        <Card variant="primary">
                            <div style={{ display: "grid", gap: "8px" }}>
                                <ColorRow label="Panel Background Color" value={s.panelBackgroundColor} onChange={v => set("panelBackgroundColor", v)} preset="#0e1852" />

                                {settings.store.hoverEffect === "glow" && <>
                                    <ColorRow label="Glow Hover Color" value={s.glowColor} onChange={v => set("glowColor", v)} preset="#ffffff" />
                                </>}
                            </div>
                        </Card>

                        <SectionHeading>Native Buttons</SectionHeading>
                        <Card variant="primary">
                            <FormSwitch title="Force Icon Color" description="Applies the icon color to Discord's native Mute, Deafen, and Settings buttons even when no custom icon color is set in TestcordHelper." value={s.forceNativeButtonColor} onChange={v => set("forceNativeButtonColor", v)} hideBorder />
                        </Card>
                    </>}

                    {tab === "hide" && <>
                        <SectionHeading>Standard Buttons</SectionHeading>
                        <Card variant="primary">
                            <FormSwitch title="Hide Mute" value={s.hideMute} onChange={v => set("hideMute", v)} />
                            <FormSwitch title="Hide Deafen" value={s.hideDeafen} onChange={v => set("hideDeafen", v)} />
                            <FormSwitch title="Hide User Settings" value={s.hideSettings} onChange={v => set("hideSettings", v)} hideBorder />
                        </Card>

                        <SectionHeading>Call Buttons</SectionHeading>
                        <Card variant="primary">
                            <FormSwitch title="Hide Camera" value={s.hideCamera} onChange={v => set("hideCamera", v)} />
                            <FormSwitch title="Hide Screen Share" value={s.hideScreenShare} onChange={v => set("hideScreenShare", v)} />
                            <FormSwitch title="Hide Activity" value={s.hideActivity} onChange={v => set("hideActivity", v)} hideBorder />
                        </Card>
                    </>}

                    {tab === "drag" && <>
                        <SectionHeading>Button Order & Hotkeys & Grouping</SectionHeading>
                        <ButtonsDragTab />
                    </>}

                    {tab === "modules" && (
                        <ModulesTab
                            pluginSettings={s}
                            onOpenButtonCustomizer={() => setTab("drag")}
                            onOpenCallBarSettings={() => setTab("call")}
                        />
                    )}
                </Flex>
            </div>
        </Modal>
    );
}

// ─── Panel Button ─────────────────────────────────────────────────────────────

function PanelLayoutButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const handleOpen = () => openModalLazy(async () => modalProps => <PanelLayoutModal modalProps={modalProps} />);

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
    name: "PanelLayout",
    description: "Customize the layout, style, and visibility of panel and call buttons, and manage user area modules.",
    authors: [TestcordDevs.deracul, TestcordDevs.Aviv, TestcordDevs.x2b, TestcordDevs.sirphantom89],
    dependencies: ["UserSettingsAPI"],
    settings,
    required: true,

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /(?<=\i\.jsxs?\)\()(\i),{(?=[^}]*?userTag:\i,occluded:)/,
                replace: "$self.PanelWrapper,{VencordOriginal:$1,"
            },
        },
        ...musicControlsPatches,
        ...devBannerPatches,
        ...activityBannerPatches,
    ],

    makeDevBanner,

    LocalActivityStore,
    SelfPresenceStore,
    PresenceStore,
    RunningGameStore,

    saveRenderer,
    markRenderedInEI,
    renderStreamingGame,
    getVisibleGameOrRpc,
    renderActivityInfo,
    renderActivityIcon,

    PanelWrapper({ VencordOriginal, ...props }: any) {
        return (
            <>
                <ModulesContainer position="above" />
                <VencordOriginal {...props} />
                <ModulesContainer position="below" />
            </>
        );
    },

    userAreaButton: { icon: PanelLayoutIcon, render: PanelLayoutButton },

    async start() {
        await Promise.all([loadConfigs(), initModuleManager()]);
        apply();
        startObserver();
        unsubscribeModules = subscribeModules(() => apply());
        SettingsStore.addChangeListener("plugins.TestcordHelper.userAreaButtonIconColor", apply);
        document.addEventListener("keydown", onGlobalKeydown, true);
        document.addEventListener("click", onGlobalClick, true);
    },
    stop() {
        unsubscribeModules?.();
        unsubscribeModules = null;
        stopModuleManager();
        stopObserver();
        SettingsStore.removeChangeListener("plugins.TestcordHelper.userAreaButtonIconColor", apply);
        document.getElementById(STYLE_ID)?.remove();
        document.getElementById(CUSTOM_STYLE_ID)?.remove();
        document.removeEventListener("keydown", onGlobalKeydown, true);
        document.removeEventListener("click", onGlobalClick, true);
    }
});

export {
    initModuleManager,
    isModuleEnabled,
    registerModule,
    stopModuleManager,
    unregisterModule,
    useModules,
} from "./modules";
