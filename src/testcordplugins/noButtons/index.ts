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
    hidePopoutChatButton: {
        description: "Hide the popout chat button",
        type: OptionType.BOOLEAN,
        default: false,
        onChange() { updateState(); }
    },
    hideHelpButton: {
        description: "Hide the help button",
        type: OptionType.BOOLEAN,
        default: false,
        onChange() { updateState(); }
    },
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

const BUTTON_CONFIG: { setting: string; selectors: string[]; global?: boolean; }[] = [
    {
        setting: "hidePopoutChatButton",
        global: true,
        selectors: [
            '[aria-label="Popout chat"]',
            '[aria-label="Pop Out"]',
            '[aria-label="Pop out"]',
            '[aria-label*="popout" i]',
            '[aria-label*="pop out" i]',
            '[aria-label*="pop-out" i]'
        ]
    },
    {
        setting: "hideHelpButton",
        global: true,
        selectors: [
            '[aria-label="Help"]',
            '[aria-label="Help & Support"]',
            '[aria-label="Open Help"]',
            'a[href*="support.discord.com"]'
        ]
    },
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

function getHideSelectors(): { chat: string[]; global: string[]; } {
    const chat: string[] = [];
    const global: string[] = [];
    for (const { setting, selectors, global: isGlobal } of BUTTON_CONFIG) {
        if (settings.store[setting]) (isGlobal ? global : chat).push(...selectors);
    }
    return { chat, global };
}

function injectCSS() {
    const oldStyle = document.getElementById(STYLE_ELEMENT_ID);
    if (oldStyle) oldStyle.remove();

    const { chat: chatSelectors, global: globalSelectors } = getHideSelectors();
    if (chatSelectors.length === 0 && globalSelectors.length === 0) return;

    // Measured on a live session: emitting these rules per-selector (~115 rules, most
    // with :has()) cost ~200ms of EVERY full style recalc, which made all hover UI
    // feel laggy. Grouping into shared :is() lists and dropping :has() entirely brings
    // that down to ~60% — :has() under substring-scope ancestors was the single most
    // expensive pattern, so :has() stays banned here. No polling, no MutationObserver
    // either: everything below is static CSS, zero JS runs after injection.
    //
    // Verified live via LiveFix: Discord declares its own equal-specificity
    // display:!important rules that sit later in the cascade (and keeps appending
    // stylesheets as you navigate), so plain [aria-label] + !important randomly
    // loses and hidden buttons pop back. Every hide selector therefore gets a
    // :not(#vc-nobuttons-never) suffix: an impossible ID match that lifts each rule
    // to (1,0,0) specificity — order-proof against any class-based Discord rule,
    // with zero matching-cost impact (no :has, no tree climbing).
    //
    // Gap fix: when Discord wraps a hidden button in its own (classless) div, that
    // wrapper stays a flex item and keeps its slot. Instead of selecting the wrapper
    // via :has(), we dissolve it with display:contents. The wrapper then generates
    // no box (slot gone) while its children lay out as direct flex items, so the
    // container's own gap keeps the remaining buttons spaced exactly as before.
    const exactSelectors = chatSelectors.filter(s => !s.includes("*="));
    const fuzzySelectors = chatSelectors.filter(s => s.includes("*="));

    const scopes = ['[class*="channelTextArea"]', '[class*="channelBottomBar"]'];
    const hideStyles = "display: none !important; width: 0 !important; height: 0 !important; margin: 0 !important; padding: 0 !important; min-width: 0 !important; flex: 0 0 0 !important;";
    const cssRules: string[] = [];

    const boost = (selectorList: string[]) => selectorList.map(s => `${s}:not(#vc-nobuttons-never)`);

    const pushHideRule = (selectorList: string[]) => {
        cssRules.push(`${boost(selectorList).join(",\n")} {\n    ${hideStyles}\n}`);
    };

    for (const scope of scopes) {
        if (exactSelectors.length) pushHideRule([`${scope} :is(${exactSelectors.join(",")})`]);
        if (fuzzySelectors.length) pushHideRule([`${scope} ${fuzzySelectors.join(",")}`]);
        if (exactSelectors.length) pushHideRule([`${scope} [class*="buttons"] > *:is(${exactSelectors.join(",")})`]);
        if (fuzzySelectors.length) pushHideRule([`${scope} [class*="buttons"] > *:is(${fuzzySelectors.join(",")})`]);
    }

    if (exactSelectors.length) {
        pushHideRule([`[class*="buttons__"] > *:is(${exactSelectors.join(",")})`]);
    }
    if (fuzzySelectors.length) {
        pushHideRule([`[class*="buttons__"] > *:is(${fuzzySelectors.join(",")})`]);
    }

    // NOTE: never anchor these to bare [class*="buttons__"] — that substring also
    // matches the voice/user panel's buttons container, dissolving its layout.
    // Chat wrappers are only dissolved inside the message-box scopes below.
    if (chatSelectors.length) {
        const dissolveSelectors: string[] = [];
        for (const scope of scopes) {
            dissolveSelectors.push(
                `${scope} [class*="buttons"] > div:not([class*="buttonWrapper"])`,
                `${scope} [class*="buttons"] > * > div:not([class])`
            );
        }
        cssRules.push(`${dissolveSelectors.join(",\n")} {\n    display: contents !important;\n}`);
    }

    if (globalSelectors.length) {
        pushHideRule(globalSelectors);
        // Header leftovers: plugin buttons (e.g. Popout chat) render inside a
        // span.vc-plugin-icon-button wrapper that survives the inner button being
        // hidden and keeps its toolbar slot; native buttons can sit in classless
        // toolbar wrapper divs too. Dissolve both so no gap remains.
        cssRules.push(`${[
            '[class*="toolbar__"] > span.vc-plugin-icon-button',
            '[class*="title__"] span.vc-plugin-icon-button',
            '[class*="title__"] [class*="toolbar__"] > div:not([class])',
            '[class*="title__"] [class*="toolbar__"] > * > div:not([class])'
        ].join(",\n")} {\n    display: contents !important;\n}`);
    }

    cssRules.push(`${boost(['[id="channel-attach-THREAD"]']).join(",\n")} {\n    ${hideStyles}\n}`);

    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = cssRules.join("\n");
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
