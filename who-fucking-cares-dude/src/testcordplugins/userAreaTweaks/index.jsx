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

/* Hide the native flex container of buttons to recreate them elsewhere if needed, 
   Wait, a pure CSS floating dock without DOM manipulation! */

/* We style the button container itself to look like a floating dock */
section[class*="container_"]:has([class*="avatar_"]) {
    position: relative !important;
    overflow: visible !important;
}

/* The button container inside the user area */
[class*="avatarWrapper_"] ~ div[class*="flex_"],
section[class*="container_"]:has([class*="avatar_"]) > div[class*="flex_"] {
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

/* Hover effect on the dock */
[class*="avatarWrapper_"] ~ div[class*="flex_"]:hover,
section[class*="container_"]:has([class*="avatar_"]) > div[class*="flex_"]:hover {
    transform: translateY(-2px);
    background: rgba(30, 31, 34, 0.98) !important;
}

/* Style the buttons inside the dock */
section[class*="container_"]:has([class*="avatar_"]) > div[class*="flex_"] button {
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

section[class*="container_"]:has([class*="avatar_"]) > div[class*="flex_"] button:hover {
    color: #fff !important;
    transform: scale(1.1);
}

section[class*="container_"]:has([class*="avatar_"]) > div[class*="flex_"] button svg {
    width: 18px !important;
    height: 18px !important;
}

/* IMPORTANT: Push the voice connection panel up so the dock doesn't overlap it! */
section[class*="panels_"] > div[class*="container_"]:not(:has([class*="avatar_"])) {
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
