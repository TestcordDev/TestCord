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
        for (const sel of selectors) {
            for (const el of parent.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);
                const cls = (el as HTMLElement).className ?? "";
                const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
                // Only reveal spoiler obscurities, not explicit/gore filters unless they also look like spoilers
                if (cls.includes("spoiler") || aria.includes("spoiler") || sel.includes("spoiler")) {
                    (el as HTMLElement).click();
                    revealed++;
                }
            }
        }
        // Fallback: generic hidden elements with spoiler aria-label inside parent
        if (revealed === 0) {
            for (const el of parent.querySelectorAll('[class*="hidden"][aria-label]')) {
                const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
                if (aria.includes("spoiler")) {
                    (el as HTMLElement).click();
                    revealed++;
                }
            }
        }
    },

    revealAllAuto() {
        const root = document;
        // Aggressive: handle chat, profile, forwarded snapshots, embeds, attachments - all in document
        // Forwarded messages use same spoiler classes but live inside snapshot containers
        const selectors = [
            '[class*="spoilerContent"][class*="hidden"]',
            '[class*="hiddenSpoiler"][class*="hidden"]',
            '[class*="obscured"][class*="hidden"]',
            '[class*="spoilerContainer"][class*="hidden"]',
            '[aria-expanded="false"][aria-label]',
            '[class*="forwarded"] [class*="hidden"]',
            '[class*="snapshot"] [class*="hidden"]'
        ];
        const seen = new Set<Element>();
        for (const sel of selectors) {
            for (const el of root.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);
                const cls = (el as HTMLElement).className ?? "";
                const rawAria = el.getAttribute("aria-label") ?? "";
                const aria = rawAria.toLowerCase();
                if (cls.includes("hiddenVisually")) continue;
                // AutoReveal wants NO spoilers: be permissive for forwarded/profile.
                // Any hidden spoiler-like element with aria-expanded false or hidden class is a candidate.
                const isSpoiler = cls.includes("spoiler") || aria.includes("spoiler") || rawAria === "" && cls.includes("hidden");
                // For generic aria-expanded selector, require some spoiler hint or just hidden
                if (sel.includes("aria-expanded") && !isSpoiler && !cls.includes("hidden")) continue;
                // For forwarded/snapshot generic hidden, require spoiler hint
                if ((sel.includes("forwarded") || sel.includes("snapshot")) && !isSpoiler) continue;
                if (isSpoiler || sel.includes("spoiler") || aria.includes("spoiler")) {
                    (el as HTMLElement).click();
                } else if (settings.store.autoReveal && el.getAttribute("aria-expanded") === "false") {
                    // In auto mode, also nuke any obscured hidden (covers forwarded edge cases)
                    const isObscured = cls.includes("obscured") || cls.includes("hidden");
                    if (isObscured) (el as HTMLElement).click();
                }
            }
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

        // Auto-reveal interval: when enabled, nuke every spoiler in view every 400ms
        this._autoInterval = setInterval(() => {
            if (!settings.store.autoReveal) return;
            this.revealAllAuto();
        }, 400);
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
