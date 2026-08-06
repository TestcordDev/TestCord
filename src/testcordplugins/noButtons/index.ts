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

let rowObserver: MutationObserver | null = null;
let bootObserver: MutationObserver | null = null;

const settings = definePluginSettings({
    hideGiftButton: {
        description: "Hide the gift button in the message bar",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() {
            injectCSS();
        }
    },
    hideBoostButton: {
        description: "Hide the boost button",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() {
            injectCSS();
        }
    },
    hideStickerButton: {
        description: "Hide the sticker button in the message bar",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() {
            injectCSS();
        }
    },
    hideGifButton: {
        description: "Hide the GIF button",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() {
            injectCSS();
        }
    },
    hideAppsButton: {
        description: "Hide the Apps button",
        type: OptionType.BOOLEAN,
        default: true,
        onChange() {
            injectCSS();
        }
    },
    hideEmojiButton: {
        description: "Hide the emoji button in the message bar",
        type: OptionType.BOOLEAN,
        default: false,
        onChange() {
            injectCSS();
        }
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

// Raw, unscoped selectors for the buttons the plugin is currently hiding.
// Single source of truth shared by injectCSS() (inner-button hide) and
// start()'s wrapper-collapse observer, so the two can never drift apart.
function getRawHideSelectors(): string[] {
    const raw: string[] = [];
    for (const { setting, selectors } of BUTTON_CONFIG) {
        if (settings.store[setting]) raw.push(...selectors);
    }
    return raw;
}

function injectCSS(){
    const oldStyle = document.getElementById(STYLE_ELEMENT_ID);
    if (oldStyle) oldStyle.remove();

    const activeSelectors: string[] = [];

    // NOTE: no :has() selectors here — relational matching lagged badly in
    // this build. Wrapper collapse is handled in JS by start()'s observer.
    for (const sel of getRawHideSelectors()) {
        activeSelectors.push(
            `[class*="channelTextArea"] ${sel}`,
            `[class*="channelBottomBar"] ${sel}`
        );
    }

    activeSelectors.push('[id="channel-attach-THREAD"]');

    const hideStyles = "display: none !important; width: 0 !important; height: 0 !important; margin: 0 !important; padding: 0 !important; min-width: 0 !important; flex: 0 0 0 !important;";
    const css = `${activeSelectors.join(", ")} { ${hideStyles} }`;

    logger.debug(`Final css:\n${css}`);

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

        // Collapse the per-button WRAPPER, not just the inner button.
        //
        // Each toolbar button sits in a flex item (e.g. buttonContainer__74017).
        // display:none on the inner button leaves the wrapper as a zero-width
        // flex item that still draws the container's `gap` on both sides,
        // producing dead space between the buttons you keep.
        //
        // CSS can only target "the wrapper of a hidden button" via :has(),
        // which lagged badly in this build (even scoped). So we do it in JS:
        // walk the button row's direct children, and collapse the wrapper of
        // any child whose inner button matches one of the ACTIVE HIDE
        // SELECTORS. Reusing rawHideSelectors as the single source of truth
        // means the wrapper collapse can never drift from what the CSS hides
        // — button renames (e.g. "Give a Gift" → "Send a gift") are handled
        // automatically, since we match the same selector, not a fixed label.
        // Batched with requestAnimationFrame so mutation bursts collapse into
        // a single pass, and scoped so each pass only touches the button row.
        const rawHideSelectors = getRawHideSelectors();
        if (rawHideSelectors.length === 0) return;

        const collapseSelector = rawHideSelectors.join(", ");
        const COLLAPSE_ATTR = "data-nobuttons-collapsed";

        const collapseRow = (row: Element) => {
            for (const child of Array.from(row.children)) {
                // Match the button anywhere within the wrapper, not just the
                // direct child — some wrappers nest the button one level deep.
                const shouldCollapse = child.matches(collapseSelector)
                    || !!child.querySelector(collapseSelector);
                const isCollapsed = child.hasAttribute(COLLAPSE_ATTR);

                if (shouldCollapse && !isCollapsed) {
                    (child as HTMLElement).style.setProperty("display", "none", "important");
                    child.setAttribute(COLLAPSE_ATTR, "1");
                } else if (!shouldCollapse && isCollapsed) {
                    (child as HTMLElement).style.removeProperty("display");
                    child.removeAttribute(COLLAPSE_ATTR);
                }
            }
        };

        let scheduled = false;
        const runPass = () => {
            scheduled = false;
            const rows = document.querySelectorAll('[class*="buttons__74017"]');
            for (const row of Array.from(rows)) collapseRow(row);
        };
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(runPass);
        };

        // Attach a SCOPED observer to each button row (childList only, no deep
        // subtree). This fires only when buttons are added/removed within the
        // row itself — a handful of nodes — not on every message or tooltip in
        // the client. That is the whole point: no document-wide watching.
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

        // Boot observer: the button row mounts/unmounts as you switch channels,
        // so we need to catch it (re)appearing. This one does watch the tree,
        // but it does NOTHING except a cheap querySelectorAll when the DOM
        // changes, and only actually attaches when a *new* row shows up. It is
        // debounced through the same rAF gate so bursts collapse to one check.
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

        // Initial attach + pass.
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

        // Restore any wrappers we collapsed so disabling the plugin fully reverts.
        const collapsed = document.querySelectorAll("[data-nobuttons-collapsed]");
        for (const el of Array.from(collapsed)) {
            (el as HTMLElement).style.removeProperty("display");
            el.removeAttribute("data-nobuttons-collapsed");
        }
    },
});
