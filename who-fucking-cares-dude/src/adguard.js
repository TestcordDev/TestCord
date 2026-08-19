"use strict";
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Simple YouTube ad blocker for embeds
(function () {
    "use strict";
    // Block ad-related elements
    const blockAds = () => {
        // Hide ad containers
        const adSelectors = [
            ".video-ads",
            ".ytp-ad-module",
            ".ytp-ad-overlay-container",
            '[class*="ad-"]',
            '[id*="ad-"]'
        ];
        adSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => el.style.display = "none");
        });
        // Skip ads if possible
        const video = document.querySelector("video");
        if (video) {
            // Try to skip ad
            const skipButton = document.querySelector(".ytp-ad-skip-button");
            if (skipButton) {
                skipButton.click();
            }
        }
    };
    // Run on load and periodically
    blockAds();
    setInterval(blockAds, 1000);
})();
