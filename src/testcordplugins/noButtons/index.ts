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

const settings = definePluginSettings({
    hideGiftButton: {
        description: "Hide the gift button in the message bar",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    hideBoostButton: {
        description: "Hide the boost button",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    hideStickerButton: {
        description: "Hide the sticker button in the message bar",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    hideGifButton: {
        description: "Hide the GIF button",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    hideAppsButton: {
        description: "Hide the Apps button",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    }
});

const BUTTON_CONFIG = [
    {
        setting: "hideGiftButton",
        selectors: [
            '[aria-label="Send a gift"]',
            '[aria-label="Gift Nitro"]',
            '[aria-label="Gift"]',
            '[aria-label="Upgrade to Nitro"]',
            '[aria-label="Give Nitro"]',
            '[aria-label="Gift Nitro to a friend"]',
            '[aria-label="Nitro Gift"]',
            '[aria-label*="gift" i]',
            '[class*="giftButton"]',
            '[class*="nitroGift"]'
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
    }
];

export default definePlugin({
    name: "NoButtons",
    description: "Removes annoying buttons that you don't need",
    tags: ["Customisation", "Appearance"],
    authors: [TestcordDevs.x2b],
    patches: [],
    settings,
    start() {
        logger.info("Plugin is starting");

        const oldStyle = document.getElementById(STYLE_ELEMENT_ID);
        if (oldStyle) oldStyle.remove();

        const activeSelectors: string[] = [];

        for (const { setting, selectors } of BUTTON_CONFIG) {
            if (settings.store[setting]) {
                for (const sel of selectors) {
                    activeSelectors.push(
                        sel,
                        `[class*="buttonContainer"]:has(${sel})`,
                        `[class*="expressionPicker"]:has(${sel})`,
                        `[class*="button-"]:has(${sel})`
                    );
                }
            }
        }

        activeSelectors.push('[id="channel-attach-THREAD"]');

        if (activeSelectors.length === 0) return;

        const hideStyles = "display: none !important; width: 0 !important; height: 0 !important; margin: 0 !important; padding: 0 !important; min-width: 0 !important; flex: 0 0 0 !important;";
        const css = `${activeSelectors.join(", ")} { ${hideStyles} }`;

        logger.debug(`Final css:\n${css}`);

        const style = document.createElement("style");
        style.id = STYLE_ELEMENT_ID;
        style.textContent = css;
        document.body.appendChild(style);
    },
    stop() {
        logger.info("Plugin is stopping");

        const styleElement = document.getElementById(STYLE_ELEMENT_ID);
        if (styleElement) {
            styleElement.remove();
        }
    },
});
