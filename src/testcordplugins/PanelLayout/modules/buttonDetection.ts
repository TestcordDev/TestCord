/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getPanelLayoutPlainSettings } from "./registry";

export interface BtnItem {
    id: string;
    label: string;
    iconHTML: string;
}

export const S = {
    previewButtonContainer: ".previewButtonContainer",
    previewButton: ".buttonPreview",
    previewButtonOn: ".previewButtonOn",
    previewButtonOff: ".previewButtonOff",
    panelContainer: ".container__37e49",
    panelButtons: ".buttons__37e49",
    panelButton: ".button__201d5",
    audioParent: ".audioButtonParent__5e764",
    chevron: ".buttonChevron__5e764",
    callContainer: ".container_e131a9",
    callControls: ".actionButtons_e131a9",
    callButton: ".button_e131a9",
    voiceStatus: ".rtcConnectionStatus__06d62",
    pingIcon: ".clickablePing__06d62",
    disconnect: ".voiceButtonsContainer_e131a9",
    accountWrapper: ".accountPopoutButtonWrapper__37e49",
};

export const TOGGLE_LABELS: Record<string, string[]> = {
    "Mute": ["Mute", "Unmute"],
    "Deafen": ["Deafen", "Undeafen"],
    "Camera": ["Turn On Camera", "Turn Off Camera"],
    "Screen Share": ["Share Your Screen", "Stop Sharing", "Stop Screen Sharing"],
    "Activity": ["Start An Activity", "End Activity", "Stop Activity"],
    "Game Activity": ["Enable Game Activity", "Disable Game Activity", "Game Activity"],
    "Spotify Activity": ["Turn on Spotify activity", "Turn off Spotify activity"],
    "Soundboard": ["Soundboard disabled when deafened", "Open Soundboard"],
};

// Both of these used to be rebuilt inside `getCanonicalLabel`, which the 1Hz panel poll
// calls once per button per tick. `Object.entries(TOGGLE_LABELS)` allocated an 8-tuple
// array (plus 8 sub-arrays) per call, and the prefix list another one.
const TOGGLE_LABEL_ENTRIES = Object.entries(TOGGLE_LABELS);
const PREFIXES = [
    "Enable ", "Disable ",
    "Turn On ", "Turn Off ",
    "Start ", "Stop ", "End "
];

export function getCanonicalLabel(label: string): string {
    for (const [canonical, aliases] of TOGGLE_LABEL_ENTRIES) {
        if (aliases.includes(label)) return canonical;
    }

    let cleaned = label;
    for (const prefix of PREFIXES) {
        if (cleaned.startsWith(prefix)) {
            cleaned = cleaned.slice(prefix.length);
            break;
        }
    }
    return cleaned;
}

export function getLabelFromDescribedBy(el: HTMLElement): string | null {
    const target = el.hasAttribute("aria-describedby") ? el : el.querySelector("[aria-describedby]");
    const describedBy = target?.getAttribute("aria-describedby");
    if (!describedBy) return null;

    for (const id of describedBy.split(/\s+/)) {
        const text = document.getElementById(id)?.textContent?.trim();
        if (text) return text;
    }
    return null;
}

export function getBtnLabelWithCallButtons(el: HTMLElement): string | null {
    return (
        el.getAttribute("aria-label") ||
        el.querySelector("button")?.getAttribute("aria-label") ||
        el.querySelector("[aria-label]")?.getAttribute("aria-label") ||
        getLabelFromDescribedBy(el) ||
        null
    );
}

export function getBtnLabel(el: HTMLElement): string | null {
    return (
        el.getAttribute("aria-label") ||
        el.querySelector("button")?.getAttribute("aria-label") ||
        el.querySelector("[aria-label]")?.getAttribute("aria-label") ||
        null
    );
}

export function getAllButtons(): HTMLElement[] {
    const out: HTMLElement[] = [];
    const pBtns = document.querySelector(S.panelButtons) as HTMLElement | null;
    const cBtns = document.querySelector(S.callControls) as HTMLElement | null;
    if (pBtns) out.push(...(Array.from(pBtns.children) as HTMLElement[]));
    if (cBtns) out.push(...(Array.from(cBtns.children) as HTMLElement[]));
    return out;
}

let btnItemsCache: BtnItem[] | null = null;
let btnItemsCacheKey = "";

export function clearBtnItemsCache() {
    btnItemsCache = null;
    btnItemsCacheKey = "";
}

export function getBtnItems(orderResolver?: (id: string) => number, withCallButtons: boolean = false): BtnItem[] {
    const buttons = getAllButtons();

    const resolveRawLabel = withCallButtons ? getBtnLabelWithCallButtons : getBtnLabel;

    const key = buttons.map(el => getCanonicalLabel(resolveRawLabel(el) ?? "")).join("|");
    if (btnItemsCache && key === btnItemsCacheKey) {
        if (orderResolver) {
            return [...btnItemsCache].sort((a, b) => (orderResolver(a.id) ?? 0) - (orderResolver(b.id) ?? 0));
        }
        return btnItemsCache;
    }

    const seen = new Set<string>();
    const out: BtnItem[] = [];
    for (const el of buttons) {
        const rawLabel = resolveRawLabel(el);
        if (!rawLabel) continue;
        const label = getCanonicalLabel(rawLabel);
        if (seen.has(label)) continue;
        seen.add(label);

        let iconHTML = "";
        const svg = el.querySelector("svg");
        if (svg) {
            const clone = svg.cloneNode(true) as SVGElement;
            clone.removeAttribute("style");

            clone.querySelectorAll("defs, mask, [clip-path]").forEach(node => {
                if (node.id && node.id.includes("__lottie_element")) {
                    node.remove();
                }
            });
            clone.querySelectorAll('[style*="display: none"]').forEach(node => node.remove());

            const uniqueSuffix = Math.random().toString(36).substring(2, 7);
            const idNodes = clone.querySelectorAll("[id]");
            if (idNodes.length) {
                const idMap = new Map<string, string>();
                idNodes.forEach(node => {
                    const newId = `${node.id}-${uniqueSuffix}`;
                    idMap.set(node.id, newId);
                    node.id = newId;
                });
                clone.querySelectorAll("*").forEach(child => {
                    ["mask", "fill", "clip-path", "filter"].forEach(attr => {
                        const val = child.getAttribute(attr);
                        if (!val) return;
                        for (const [oldId, newId] of idMap) {
                            if (val === `url(#${oldId})` || val === `url('#${oldId}')` || val === `url("#${oldId}")`) {
                                child.setAttribute(attr, `url(#${newId})`);
                                break;
                            }
                        }
                    });
                });
            }

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

    const resolver = orderResolver ?? (id => {
        try {
            const configs = getPanelLayoutPlainSettings()?.buttonConfigs;
            return configs?.[id]?.order ?? 0;
        } catch {
            return 0;
        }
    });
    out.sort((a, b) => (resolver(a.id) ?? 0) - (resolver(b.id) ?? 0));
    btnItemsCache = out;
    btnItemsCacheKey = key;
    return out;
}
