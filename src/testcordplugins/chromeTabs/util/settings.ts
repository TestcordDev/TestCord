/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { makeRange, OptionType } from "@utils/types";

export const logger = new Logger("ChromeTabs");

/** Chrome keeps tabs readable until they hit this floor, then starts scrolling */
export const MIN_TAB_WIDTH = 56;
export const MAX_TAB_WIDTH = 240;

export const settings = definePluginSettings({
    onStartup: {
        type: OptionType.SELECT,
        description: "What to open when Discord starts",
        options: [
            { label: "A single tab for the current channel", value: "nothing", default: true },
            { label: "Restore the tabs from last session", value: "remember" }
        ]
    },
    tabBarPosition: {
        type: OptionType.SELECT,
        description: "Where the tab strip sits",
        options: [
            { label: "In the title bar (like Discord's upcoming tabs)", value: "titlebar", default: true },
            { label: "Top, above the app", value: "top" },
            { label: "Bottom, below the app", value: "bottom" }
        ],
        restartNeeded: true
    },
    maxTabWidth: {
        type: OptionType.SLIDER,
        description: "Widest a tab may grow (px). Tabs shrink from here as more open, like Chrome.",
        markers: makeRange(120, MAX_TAB_WIDTH, 20),
        default: 200,
        stickToMarkers: false
    },
    switchToExistingTab: {
        type: OptionType.BOOLEAN,
        description: "Opening a channel that is already in a tab switches to that tab instead of replacing the current one",
        default: true
    },
    openInNewTab: {
        type: OptionType.BOOLEAN,
        description: "Navigating to a new channel opens another tab instead of replacing the current tab's contents",
        default: false
    },
    showUnreadBadges: {
        type: OptionType.BOOLEAN,
        description: "Show unread and mention counts on tabs",
        default: true
    },
    showDmStatus: {
        type: OptionType.BOOLEAN,
        description: "Show online status on DM tab avatars",
        default: true
    },
    useDisplayNames: {
        type: OptionType.BOOLEAN,
        description: "Use display names instead of usernames for DM tabs",
        default: true
    },
    enableKeybinds: {
        type: OptionType.BOOLEAN,
        description: "Enable tab shortcuts (Ctrl+T for new tab, Ctrl+Shift+T to reopen, Ctrl+W to close, Ctrl+Tab to cycle, and Ctrl+1-9 to jump)",
        default: true
    },
    reopenTabKeybind: {
        type: OptionType.BOOLEAN,
        description: "Reopen closed tab with Ctrl+Shift+T (prevents Discord's New Message modal)",
        default: true
    },
    ctrlTabSwitcher: {
        type: OptionType.BOOLEAN,
        description: "Show a switcher popup when pressing Ctrl+Tab (similar to RecentChannelSwitcher / Chrome)",
        default: true
    },
    ctrlTabOrder: {
        type: OptionType.SELECT,
        description: "Order of tabs in the Ctrl+Tab switcher",
        options: [
            { label: "Recently opened order (MRU)", value: "mru", default: true },
            { label: "Tab strip order (left to right)", value: "strip" }
        ]
    }
});
