/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

const CSS = `
/* ──────────────────────────────────────────────────
   User Area — Floating Dock (CSS-only)
────────────────────────────────────────────────── */

/* Everything is scoped under the panels section. The previous version matched
   ANY section whose class contained "container_" and ran :has() over each one's
   whole subtree - that selector pair was re-evaluated across the entire app on
   every DOM change and made all hover UI laggy. */

/* The button container inside the user area, styled as a floating dock.
   The sibling combinator does the work :has() used to do: the buttons flex
   container always follows the avatar wrapper in Discord's panels markup. */
section[class*="panels_"] [class*="avatarWrapper_"] ~ div[class*="flex"] {
    position: absolute !important;
    top: -45px !important; /* Move it above the user area */
    left: 8px !important;

    /* Styling the dock */
    display: flex !important;
    align-items: center !important;
    background: rgba(30, 31, 34, 0.85) !important;
    backdrop-filter: blur(8px) !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    border-radius: 12px !important;
    padding: 4px 6px !important;
    gap: 4px !important;
    z-index: 1000 !important;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4) !important;
    transition: transform 0.2s ease, opacity 0.2s ease, top 0.2s ease !important;
    min-height: 32px !important;
}

section[class*="panels_"] {
    position: relative !important;
    overflow: visible !important;
}

/* Hover effect on the dock */
section[class*="panels_"] [class*="avatarWrapper_"] ~ div[class*="flex"]:hover {
    transform: translateY(-2px);
    background: rgba(30, 31, 34, 0.98) !important;
}

/* Style the buttons inside the dock */
section[class*="panels_"] [class*="avatarWrapper_"] ~ div[class*="flex"] button {
    background: none !important;
    padding: 0 !important;
    width: 32px !important;
    height: 32px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    color: #b5bac1 !important;
    transition: color 0.2s, transform 0.2s !important;
    flex: 0 0 auto !important;
}

section[class*="panels_"] [class*="avatarWrapper_"] ~ div[class*="flex"] button:hover {
    color: #fff !important;
    transform: scale(1.1);
}

section[class*="panels_"] [class*="avatarWrapper_"] ~ div[class*="flex"] button svg {
    width: 18px !important;
    height: 18px !important;
}

/* IMPORTANT: Push the voice connection panel up so the dock doesn't overlap it!
   Scoped to direct children of the panels section, so :has() only ever runs
   against one or two elements instead of every container in the app. */
section[class*="panels_"] > div[class*="container_"]:not(:has([class*="avatarWrapper_"])) {
    margin-bottom: 45px !important;
    transition: margin-bottom 0.2s ease !important;
}
`;

export default definePlugin({
    name: "UserAreaTweaks",
    description: "Creates an elegant floating dock for Testcord plugins using pure CSS, preventing overlap and crashes.",
    tags: ["Appearance", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],

    start() {
        const style = document.createElement("style");
        style.id = "nightcord-userarea-tweaks-style";
        style.textContent = CSS;
        document.head.appendChild(style);
    },

    stop() {
        document.getElementById("nightcord-userarea-tweaks-style")?.remove();
    }
});
