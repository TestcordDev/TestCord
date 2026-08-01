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

export default definePlugin({
    name: "NoButtons",
    description: "Removes annoying buttons that you don't need",
    tags: ["Customisation", "Appearance"],
    authors: [TestcordDevs.x2b],
    patches: [],
    settings,
    start() {
        logger.info("Plugin is starting");

        const oldStyle = document.querySelector(`[id="${STYLE_ELEMENT_ID}"]`);
        if (oldStyle) oldStyle.remove();

        const buttonsToHide = [
            {
                setting: "hideGiftButton",
                labels: ["Send a gift", "Gift Nitro", "Gift", "Upgrade to Nitro", "Give Nitro", "Gift Nitro to a friend", "Nitro Gift"],
                patterns: ["gift"]
            },
            {
                setting: "hideBoostButton",
                labels: ["Boost this server", "Boost"],
                patterns: ["boost"]
            },
            {
                setting: "hideStickerButton",
                labels: ["Open sticker picker", "Sticker picker", "Stickers"],
                patterns: ["sticker"]
            },
            {
                setting: "hideGifButton",
                labels: ["Open GIF picker", "GIF picker", "GIFs"],
                patterns: ["gif picker"]
            },
            {
                setting: "hideAppsButton",
                labels: ["Apps", "Launch App", "App Launcher"],
                patterns: ["launch app", "app launcher"]
            }
        ];
        let css = "";

        const hideStyles = "display:none !important;width:0 !important;height:0 !important;padding:0 !important;margin:0 !important;min-width:0 !important;min-height:0 !important;max-width:0 !important;max-height:0 !important;flex:0 0 0 !important;border:none !important;overflow:hidden !important;";

        for (const { labels, patterns, setting } of buttonsToHide) {
            const shouldHideButton = settings.store[setting];
            if (shouldHideButton) {
                const matchers = [
                    ...labels.map(l => `[aria-label="${l}" i]`),
                    ...patterns.map(p => `[aria-label*="${p}" i]`)
                ];
                for (const matcher of matchers) {
                    const selectors = [
                        `[class*="channelTextArea"] ${matcher}`,
                        `[class*="channelBottomBar"] ${matcher}`,
                        `[class*="expressionPicker"] ${matcher}`,
                        `[class*="channelTextArea"] div:has(> ${matcher})`,
                        `[class*="channelBottomBar"] div:has(> ${matcher})`,
                        `[class*="channelTextArea"] button:has(${matcher})`,
                        `[class*="channelBottomBar"] button:has(${matcher})`,
                        `[class*="chat"] [class*="buttonContainer"]:has(${matcher})`,
                        `[class*="chat"] [class*="expressionPicker"]:has(${matcher})`
                    ].map(sel => `:not([class*="standardSidebarView"] *) ${sel}`).join(",");
                    css += `${selectors}{${hideStyles}}`;
                }
            }
            logger.debug(`Hide button (Labels: "${labels.join(", ")}", Setting: "${setting}"): ${shouldHideButton}`);
        }
        css += `[id="channel-attach-THREAD"]{${hideStyles}}`;

        logger.debug(`Final css:\n${css}`);

        const style = document.createElement("style");
        style.innerHTML = css;
        style.id = STYLE_ELEMENT_ID;
        document.body.appendChild(style);
    },
    stop() {
        logger.info("Plugin is stopping");

        const styleElement = document.querySelector(`[id="${STYLE_ELEMENT_ID}"]`);
        if (styleElement) {
            styleElement.remove();
        } else {
            logger.warn("Cannot remove style element: Style element is null");
        }
    },
});
