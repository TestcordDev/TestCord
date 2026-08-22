/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

const STYLE_ELEMENT_ID = "551041413043978242-removeGiftButton";

const logger = new Logger("NoButtonsPlugin", "#f542d7");

function updateState() {
    injectCSS();
}

const settings = definePluginSettings({
    hideGiftButton: {
        description: "Hide the gift button in the message bar",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() { updateState(); }
    },
    hideBoostButton: {
        description: "Hide the boost button",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() { updateState(); }
    },
    hideStickerButton: {
        description: "Hide the sticker button in the message bar",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() { updateState(); }
    },
    hideGifButton: {
        description: "Hide the GIF button",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() { updateState(); }
    },
    hideAppsButton: {
        description: "Hide the Apps button",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() { updateState(); }
    },
    hideEmojiButton: {
        description: "Hide the emoji button in the message bar",
        type: OptionType.BOOLEAN,
        default: false,
        onChange() { updateState(); }
    }
});

const BUTTON_CONFIG = [
    {
        setting: "hideGiftButton",
        selectors: [
            '[aria-label="Give a Gift"]',
            '[aria-label="Send a gift"]',
            '[aria-label="Gift Nitro"]',
            '[aria-label="Gift"]',
            '[aria-label="Upgrade to Nitro"]',
            '[aria-label="Give Nitro"]',
            '[aria-label="Gift Nitro to a friend"]',
            '[aria-label="Nitro Gift"]',
            '[aria-label*="gift" i]',
            '[class*="giftButton"]',
            '[class*="nitroGift"]',
            '[class*="container__5287f"]'
        ]
    },
    {
        setting: "hideBoostButton",
        selectors: [
            '[aria-label="Boost this server"]',
            '[aria-label="Boost"]'
        ]
    },
    {
        setting: "hideStickerButton",
        selectors: [
            '[aria-label="Open sticker picker"]',
            '[aria-label="Sticker picker"]',
            '[aria-label="Stickers"]'
        ]
    },
    {
        setting: "hideGifButton",
        selectors: [
            '[aria-label="Open GIF picker"]',
            '[aria-label="GIF picker"]',
            '[aria-label="GIFs"]'
        ]
    },
    {
        setting: "hideAppsButton",
        selectors: [
            '[aria-label="Apps"]',
            '[aria-label="Launch App"]',
            '[aria-label="App Launcher"]'
        ]
    },
    {
        setting: "hideEmojiButton",
        selectors: [
            '[aria-label="Add Emoji"]',
            '[aria-label="Select Emoji"]',
            '[class*="emojiButton"]'
        ]
    }
];

function getRawHideSelectors(): string[] {
    const raw: string[] = [];
    for (const { setting, selectors } of BUTTON_CONFIG) {
        if (settings.store[setting]) raw.push(...selectors);
    }
    return raw;
}

function injectCSS() {
    const oldStyle = document.getElementById(STYLE_ELEMENT_ID);
    if (oldStyle) oldStyle.remove();

    const rawSelectors = getRawHideSelectors();
    if (rawSelectors.length === 0) return;

    // Measured on a live session: emitting these rules per-selector (~115 rules, most
    // with :has()) cost ~200ms of EVERY full style recalc, which made all hover UI
    // feel laggy. Grouping into shared :is()/:has() lists keeps identical coverage
    // at a fraction of the matching cost. The fuzzy [aria-label*=..." i] selector
    // stays out of :has() lists — substring matching inside :has() is the single
    // most expensive pattern here.
    const exactSelectors = rawSelectors.filter(s => !s.includes("*="));
    const fuzzySelectors = rawSelectors.filter(s => s.includes("*="));

    const scopes = ['[class*="channelTextArea"]', '[class*="channelBottomBar"]'];
    const activeSelectors: string[] = [];

    for (const scope of scopes) {
        if (exactSelectors.length) activeSelectors.push(`${scope} :is(${exactSelectors.join(",")})`);
        if (fuzzySelectors.length) activeSelectors.push(`${scope} ${fuzzySelectors.join(",")}`);
        const buttonContainers = `${scope} [class*="buttons"]`;
        if (exactSelectors.length) {
            activeSelectors.push(`${buttonContainers} > *:is(${exactSelectors.join(",")})`);
            activeSelectors.push(`${buttonContainers} > *:has(:is(${exactSelectors.join(",")}))`);
        }
        if (fuzzySelectors.length) {
            activeSelectors.push(`${buttonContainers} > *:is(${fuzzySelectors.join(",")})`);
        }
    }

    if (exactSelectors.length) {
        activeSelectors.push(`[class*="buttons__"] > *:is(${exactSelectors.join(",")})`);
        activeSelectors.push(`[class*="buttons__"] > *:has(:is(${exactSelectors.join(",")}))`);
    }
    if (fuzzySelectors.length) {
        activeSelectors.push(`[class*="buttons__"] > *:is(${fuzzySelectors.join(",")})`);
    }

    activeSelectors.push('[id="channel-attach-THREAD"]');

    const hideStyles = "display: none !important; width: 0 !important; height: 0 !important; margin: 0 !important; padding: 0 !important; min-width: 0 !important; flex: 0 0 0 !important;";
    const css = `${activeSelectors.join(",\n")} {\n    ${hideStyles}\n}`;

    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = css;
    document.body.appendChild(style);
}

export default definePlugin({
    name: "NoButtons",
    description: "Removes annoying buttons that you don't need",
    tags: ["Customisation", "Appearance"],
    authors: [TestcordDevs.x2b],
    patches: [],
    settings,
    start() {
        logger.info("Plugin is starting");
        injectCSS();
    },
    stop() {
        logger.info("Plugin is stopping");
        const styleElement = document.getElementById(STYLE_ELEMENT_ID);
        if (styleElement) {
            styleElement.remove();
        }
    },
});
