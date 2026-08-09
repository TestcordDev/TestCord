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
const COLLAPSE_ATTR = "data-nobuttons-collapsed";

const logger = new Logger("NoButtonsPlugin", "#f542d7");

let rowObserver: MutationObserver | null = null;
let bootObserver: MutationObserver | null = null;

function updateState() {
    injectCSS();
    refreshWrappers();
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

    const activeSelectors: string[] = [];

    for (const sel of getRawHideSelectors()) {
        activeSelectors.push(
            `[class*="channelTextArea"] ${sel}`,
            `[class*="channelBottomBar"] ${sel}`
        );
    }

    activeSelectors.push('[id="channel-attach-THREAD"]');

    const hideStyles = "display: none !important; width: 0 !important; height: 0 !important; margin: 0 !important; padding: 0 !important; min-width: 0 !important; flex: 0 0 0 !important;";
    const css = `${activeSelectors.join(", ")} { ${hideStyles} }`;

    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = css;
    document.body.appendChild(style);
}

function collapseRow(row: Element) {
    const rawHideSelectors = getRawHideSelectors();
    const collapseSelector = rawHideSelectors.length > 0 ? rawHideSelectors.join(", ") : null;

    for (const child of Array.from(row.children)) {
        const shouldCollapse = collapseSelector
            ? child.matches(collapseSelector) || !!child.querySelector(collapseSelector)
            : false;
        const isCollapsed = child.hasAttribute(COLLAPSE_ATTR);

        if (shouldCollapse && !isCollapsed) {
            (child as HTMLElement).style.setProperty("display", "none", "important");
            child.setAttribute(COLLAPSE_ATTR, "1");
        } else if (!shouldCollapse && isCollapsed) {
            (child as HTMLElement).style.removeProperty("display");
            child.removeAttribute(COLLAPSE_ATTR);
        }
    }
}

function refreshWrappers() {
    const rows = document.querySelectorAll('[class*="buttons__74017"]');
    for (const row of Array.from(rows)) {
        collapseRow(row);
    }
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

        let scheduled = false;
        const runPass = () => {
            scheduled = false;
            refreshWrappers();
        };
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(runPass);
        };

        const attachedRows = new WeakSet<Element>();
        const attachToRows = () => {
            const rows = document.querySelectorAll('[class*="buttons__74017"]');
            for (const row of Array.from(rows)) {
                if (attachedRows.has(row)) continue;
                attachedRows.add(row);
                collapseRow(row);
                rowObserver!.observe(row, { childList: true });
            }
        };

        rowObserver = new MutationObserver(schedule);

        let bootScheduled = false;
        const bootCheck = () => {
            bootScheduled = false;
            attachToRows();
        };
        bootObserver = new MutationObserver(() => {
            if (bootScheduled) return;
            bootScheduled = true;
            requestAnimationFrame(bootCheck);
        });
        bootObserver.observe(document.body, { childList: true, subtree: true });

        attachToRows();
    },
    stop() {
        logger.info("Plugin is stopping");

        const styleElement = document.getElementById(STYLE_ELEMENT_ID);
        if (styleElement) {
            styleElement.remove();
        }

        rowObserver?.disconnect();
        rowObserver = null;
        bootObserver?.disconnect();
        bootObserver = null;

        const collapsed = document.querySelectorAll(`[${COLLAPSE_ATTR}]`);
        for (const el of Array.from(collapsed)) {
            (el as HTMLElement).style.removeProperty("display");
            el.removeAttribute(COLLAPSE_ATTR);
        }
    },
});
