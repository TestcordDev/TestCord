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
            { setting: "hideGiftButton", label: "Send a gift" },
            { setting: "hideBoostButton", label: "Boost this server" },
            { setting: "hideStickerButton", label: "Open sticker picker" },
            { setting: "hideGifButton", label: "Open GIF picker" },
            { setting: "hideAppsButton", label: "Apps" }
        ];
        let css = "";

        for (const { label, setting } of buttonsToHide) {
            const shouldHideButton = settings.store[setting];
            if (shouldHideButton) {
                css = css.concat(`[aria-label="${label}"]{display:none;width:0 !important;height:0 !important;padding:0 !important;margin:0 !important;min-width:0 !important;min-height:0 !important;flex:0 0 0 !important;border:none !important;overflow:hidden !important}`);
            }
            logger.debug(`Hide button (Label: "${label}", Setting: "${setting}"): ${shouldHideButton}"`);
        }
        css = css.concat('[id="channel-attach-THREAD"]{display:none}');

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
