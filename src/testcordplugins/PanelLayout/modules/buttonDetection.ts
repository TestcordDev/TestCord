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

export const svgs = {
    settings: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"var(--interactive-icon-default)\" fill-rule=\"evenodd\" d=\"M10.56 1.1c-.46.05-.7.53-.64.98.18 1.16-.19 2.2-.98 2.53-.8.33-1.79-.15-2.49-1.1-.27-.36-.78-.52-1.14-.24-.77.59-1.45 1.27-2.04 2.04-.28.36-.12.87.24 1.14.96.7 1.43 1.7 1.1 2.49-.33.8-1.37 1.16-2.53.98-.45-.07-.93.18-.99.64a11.1 11.1 0 0 0 0 2.88c.06.46.54.7.99.64 1.16-.18 2.2.19 2.53.98.33.8-.14 1.79-1.1 2.49-.36.27-.52.78-.24 1.14.59.77 1.27 1.45 2.04 2.04.36.28.87.12 1.14-.24.7-.95 1.7-1.43 2.49-1.1.8.33 1.16 1.37.98 2.53-.07.45.18.93.64.99a11.1 11.1 0 0 0 2.88 0c.46-.06.7-.54.64-.99-.18-1.16.19-2.2.98-2.53.8-.33 1.79.14 2.49 1.1.27.36.78.52 1.14.24.77-.59 1.45-1.27 2.04-2.04.28-.36.12-.87-.24-1.14-.96-.7-1.43-1.7-1.1-2.49.33-.8 1.37-1.16 2.53-.98.45.07.93-.18.99-.64a11.1 11.1 0 0 0 0-2.88c-.06-.46-.54-.7-.99-.64-1.16.18-2.2-.19-2.53-.98-.33-.8.14-1.79 1.1-2.49.36-.27.52-.78.24-1.14a11.07 11.07 0 0 0-2.04-2.04c-.36-.28-.87-.12-1.14.24-.7.96-1.7 1.43-2.49 1.1-.8-.33-1.16-1.37-.98-2.53.07-.45-.18-.93-.64-.99a11.1 11.1 0 0 0-2.88 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z\" clip-rule=\"evenodd\"></path></svg>",
    deafenOff: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"var(--interactive-icon-default)\" d=\"M12 3a9 9 0 0 0-8.95 10h1.87a5 5 0 0 1 4.1 2.13l1.37 1.97a3.1 3.1 0 0 1-.17 3.78 2.85 2.85 0 0 1-3.55.74 11 11 0 1 1 10.66 0c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86A9 9 0 0 0 12 3Z\"></path></svg>",
    deafenOn: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path class=\"audioIcon\" fill=\"var(--icon-voice-muted)\" d=\"M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4l20-20ZM17.06 2.94a.48.48 0 0 0-.11-.77A11 11 0 0 0 2.18 16.94c.14.3.53.35.76.12l3.2-3.2c.25-.25.15-.68-.2-.76a5 5 0 0 0-1.02-.1H3.05a9 9 0 0 1 12.66-9.2c.2.09.44.05.59-.1l.76-.76ZM20.2 8.28a.52.52 0 0 1 .1-.58l.76-.76a.48.48 0 0 1 .77.11 11 11 0 0 1-4.5 14.57c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86a9.1 9.1 0 0 0-.75-4.72ZM10.1 17.9c.25-.25.65-.18.74.14a3.1 3.1 0 0 1-.62 2.84 2.85 2.85 0 0 1-3.55.74.16.16 0 0 1-.04-.25l3.48-3.48Z\"></path></svg>",
    muteOff: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"var(--interactive-icon-default)\" d=\"M12 2a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Z\"></path><path fill=\"var(--interactive-icon-default)\" d=\"M6 10a1 1 0 0 0-2 0 8 8 0 0 0 7 7.94V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 10a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z\"></path></svg>",
    muteOn: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path class=\"audioIcon\" fill=\"var(--icon-voice-muted)\" d=\"m2.7 22.7 20-20a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4ZM10.8 17.32c-.21.21-.1.58.2.62V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 10a1 1 0 0 0-2 0c0 1.45-.52 2.79-1.38 3.83l-.02.02A5.99 5.99 0 0 1 12.32 16a.52.52 0 0 0-.34.15l-1.18 1.18ZM15.36 4.52c.15-.15.19-.38.08-.56A4 4 0 0 0 8 6v4c0 .3.03.58.1.86.07.34.49.43.74.18l6.52-6.52ZM5.06 13.98c.16.28.53.31.75.09l.75-.75c.16-.16.19-.4.08-.61A5.97 5.97 0 0 1 6 10a1 1 0 0 0-2 0c0 1.45.39 2.81 1.06 3.98Z\"></path></svg>",
    camera: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M4 4h3l2-2h6l2 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z\"/></svg>",
    screenShare: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M20 18c1.1 0 1.99-.9 1.99-2L22 6a2 2 0 0 0-2-2H4c-1.11 0-2 .89-2 2v10a2 2 0 0 0 2 2H0v2h24v-2h-4zM4 6h16v10H4V6zm9 4l-4 4 1.41 1.41L12 13.83V16h2v-2.17l1.59 1.58L17 14l-4-4z\"/></svg>",
    activity: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z\"/></svg>",
    gamepad: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H9v2H7v-2H5v-2h2V9h2v2h2v2zm4.5 1.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3-3c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z\"/></svg>",
    spotify: "<svg class=\"vc-icon-icon\" fill=\"none\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.35-1.434-5.308-1.758-8.793-.963-.335.077-.67-.133-.746-.468-.077-.334.132-.67.467-.746 3.809-.871 7.077-.496 9.721 1.115.295.18.387.562.208.855zm1.226-2.723c-.226.367-.707.482-1.074.256-2.69-1.653-6.79-2.132-9.971-1.166-.413.125-.85-.107-.974-.52-.125-.414.108-.85.52-.975 3.633-1.103 8.147-.568 11.243 1.332.367.225.482.707.256 1.073zm.106-2.835C14.692 8.95 8.085 8.732 4.24 9.9c-.496.15-1.022-.133-1.173-.629-.151-.496.133-1.022.629-1.173 4.417-1.34 11.714-1.087 15.553 1.192.446.265.592.845.328 1.291-.265.446-.846.592-1.292.328z\"/></svg>",
};

export const TOGGLE_LABELS: Record<string, string[]> = {
    "Mute": ["Mute", "Unmute"],
    "Deafen": ["Deafen", "Undeafen"],
    "Camera": ["Turn On Camera", "Turn Off Camera"],
    "Screen Share": ["Share Your Screen", "Stop Sharing", "Stop Screen Sharing"],
    "Activity": ["Start An Activity", "End Activity", "Stop Activity"],
    "Game Activity": ["Enable Game Activity", "Disable Game Activity", "Game Activity"],
    "Spotify Activity": ["Turn on Spotify activity", "Turn off Spotify activity"],
};

export function getCanonicalLabel(label: string): string {
    for (const [canonical, aliases] of Object.entries(TOGGLE_LABELS)) {
        if (aliases.includes(label)) return canonical;
    }

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

export function getBtnItems(orderResolver?: (id: string) => number): BtnItem[] {
    const buttons = getAllButtons();

    const key = buttons.map(el => getCanonicalLabel(getBtnLabel(el) ?? "")).join("|");
    if (btnItemsCache && key === btnItemsCacheKey) {
        if (orderResolver) {
            return [...btnItemsCache].sort((a, b) => (orderResolver(a.id) ?? 0) - (orderResolver(b.id) ?? 0));
        }
        return btnItemsCache;
    }

    const seen = new Set<string>();
    const out: BtnItem[] = [];
    for (const el of buttons) {
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
