/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { definePluginSettings } from "@api/Settings";
import { Devs, IS_MAC, TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    autoReveal: {
        type: OptionType.BOOLEAN,
        description: "Automatically reveal all spoilers without needing to hold Ctrl. No spoilers at all when enabled.",
        default: false
    }
});

export default definePlugin({
    name: "RevealAllSpoilers",
    description: "Reveal all spoilers in a message by Ctrl-clicking a spoiler, or in the chat with Ctrl+Shift-click. Enable auto-reveal to never see spoilers at all.",
    authors: [Devs.whqwert, TestcordDevs.x2b],
    tags: ["Accessibility", "Chat", "Shortcuts", "Utility"],
    settings,
    patches: [
        {
            find: "removeObscurity",
            replacement: {
                match: /removeObscurity(?:",|=)\s*(\i)\s*=>\s*\{/,
                replace: (m, e) => `${m}$self.reveal(${e});`
            }
        }
    ],

    reveal(event: MouseEvent) {
        if ((this as any)._isAutoRevealing) return;
        const { ctrlKey, metaKey, shiftKey, target } = event;

        if (!settings.store.autoReveal && !(IS_MAC ? metaKey : ctrlKey)) return;

        const t = target as HTMLElement;
        const parent = shiftKey
            ? document.querySelector('[class*="messagesWrapper"]')
            : t.closest('[class*="spoilerContent"], [class*="obscured"], [class*="hiddenSpoiler"], [class*="spoilerContainer"]')?.parentElement
                ?? t.closest('[class*="spoilerContent"], [class*="obscured"]')
                ?? t.parentElement;

        if (!parent) return;

        const selectors = [
            '[class*="spoilerContent"][class*="hidden"]',
            '[class*="hiddenSpoiler"][class*="hidden"]',
            '[class*="obscured"][class*="hidden"]',
            '[class*="spoilerContainer"][class*="hidden"]'
        ];

        let revealed = 0;
        const seen = new Set<Element>();
        const doClick = (el: Element) => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        // Save scroll for shift-global case to avoid yeeting to bottom
        const shouldPreserveScroll = shiftKey;
        const scrollers = shouldPreserveScroll ? [...document.querySelectorAll<HTMLElement>('[class*="messagesWrapper"], [class*="scrollerBase"], [class*="scroller"]')] : [];
        const scrollStates = scrollers.map(s => ({ el: s, top: s.scrollTop, left: s.scrollLeft }));
        const winX = window.scrollX, winY = window.scrollY;
        for (const sel of selectors) {
            for (const el of parent.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);
                const cls = (el as HTMLElement).className ?? "";
                const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
                if (cls.includes("spoiler") || aria.includes("spoiler") || sel.includes("spoiler")) {
                    doClick(el);
                    revealed++;
                }
            }
        }
        if (revealed === 0) {
            for (const el of parent.querySelectorAll('[class*="hidden"][aria-label]')) {
                const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
                if (aria.includes("spoiler")) {
                    doClick(el);
                    revealed++;
                }
            }
        }
        if (shouldPreserveScroll) {
            scrollStates.forEach(({ el, top, left }) => {
                el.scrollTop = top;
                el.scrollLeft = left;
            });
            window.scrollTo(winX, winY);
        }
    },

    revealAllAuto() {
        if (!settings.store.autoReveal) return;
        const fastCheck = document.querySelector('[aria-expanded="false"][aria-label], [class*="spoilerContent"][class*="hidden"]');
        if (!fastCheck) return;
        if ((this as any)._isAutoRevealing) return;
        (this as any)._isAutoRevealing = true;
        try {
            const revealNoScroll = (el: HTMLElement) => {
                // Try fiber setState first - no focus/scroll/highlight
                try {
                    const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber"));
                    let fiber: any = fiberKey ? (el as any)[fiberKey] : null;
                    let tries = 0;
                    while (fiber && tries < 12) {
                        const sn = fiber.stateNode;
                        if (sn && sn.state && typeof sn.state.visible === "boolean" && typeof sn.setState === "function") {
                            if (!sn.state.visible) sn.setState({ visible: true });
                            return;
                        }
                        fiber = fiber.return;
                        tries++;
                    }
                } catch {}
                // Fallback: dispatch click without focusing
                el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
                // Blur to remove highlight
                try { (el as HTMLElement).blur(); } catch {}
            };

            const root = document;
            const hidden = root.querySelectorAll<HTMLElement>('[aria-expanded="false"]');
            for (const el of hidden) {
                const cls = el.className ?? "";
                if (cls.includes("hiddenVisually")) continue;
                const aria = el.getAttribute("aria-label") ?? "";
                if (cls.includes("spoiler") || aria.toLowerCase().includes("spoiler")) {
                    revealNoScroll(el);
                }
            }
            const hiddenSpoilers = root.querySelectorAll<HTMLElement>('[class*="spoilerContent"][class*="hidden"]');
            for (const el of hiddenSpoilers) {
                if ((el as HTMLElement).getAttribute("aria-expanded") === "false") continue;
                if (el.className.includes("hiddenVisually")) continue;
                if (el.className.includes("spoiler")) revealNoScroll(el);
            }
        } finally {
            (this as any)._isAutoRevealing = false;
        }
    },

    start() {
        this._clickHandler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const closest = target.closest('[class*="spoilerContent"], [class*="obscured"], [class*="hiddenSpoiler"], [class*="spoilerContainer"]') as HTMLElement | null;
            if (!closest) return;
            const aria = (closest.getAttribute("aria-label") ?? "").toLowerCase();
            const cls = closest.className ?? "";
            if (!cls.includes("spoiler") && !cls.includes("obscured") && !aria.includes("spoiler")) return;
            this.reveal(e);
        };
        document.addEventListener("click", this._clickHandler, true);

        // Auto-reveal interval: when enabled, nuke every spoiler in view
        this._autoInterval = setInterval(() => {
            this.revealAllAuto();
        }, 800);
        // One immediate pass if already enabled
        if (settings.store.autoReveal) this.revealAllAuto();
    },

    stop() {
        if (this._clickHandler) {
            document.removeEventListener("click", this._clickHandler, true);
            this._clickHandler = null;
        }
        if (this._autoInterval) {
            clearInterval(this._autoInterval);
            this._autoInterval = undefined;
        }
    }
});
