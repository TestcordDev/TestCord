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

        const buttonsToHide = [
            { setting: "hideGiftButton", labels: ["Send a gift", "Gift Nitro"] },
            { setting: "hideBoostButton", labels: ["Boost this server"] },
            { setting: "hideStickerButton", labels: ["Open sticker picker", "Sticker picker"] },
            { setting: "hideGifButton", labels: ["Open GIF picker", "GIF picker"] },
            { setting: "hideAppsButton", labels: ["Apps", "Launch App"] }
        ];
        let css = "";

        const hideStyles = "display:none !important;width:0 !important;height:0 !important;padding:0 !important;margin:0 !important;min-width:0 !important;min-height:0 !important;max-width:0 !important;max-height:0 !important;flex:0 0 0 !important;border:none !important;overflow:hidden !important;";

        for (const { labels, setting } of buttonsToHide) {
            const shouldHideButton = settings.store[setting];
            if (shouldHideButton) {
                for (const label of labels) {
                    const selectors = [
                        `[aria-label="${label}" i]`,
                        `div:has(> [aria-label="${label}" i])`,
                        `button:has([aria-label="${label}" i])`,
                        `[class*="buttonContainer"]:has([aria-label="${label}" i])`,
                        `[class*="expressionPicker"]:has([aria-label="${label}" i])`
                    ].join(",");
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
