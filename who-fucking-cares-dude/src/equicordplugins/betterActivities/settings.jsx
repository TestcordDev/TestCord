/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { React } from "@webpack/common";
export const settings = definePluginSettings({
    memberList: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show activity icons in the member list",
        default: true,
        restartNeeded: true,
    },
    iconSize: {
        type: 5 /* OptionType.SLIDER */,
        description: "Size of the activity icons",
        markers: [10, 15, 20],
        default: 15,
        stickToMarkers: false,
    },
    specialFirst: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show special activities first (Currently Spotify and Twitch)",
        default: true,
        restartNeeded: false,
    },
    renderGifs: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow rendering GIFs",
        default: true,
        restartNeeded: false,
    },
    removeGameActivityStatus: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Remove game activity icon and status",
        default: false,
        restartNeeded: true,
    },
    divider: {
        type: 6 /* OptionType.COMPONENT */,
        description: "",
        component: () => (<div style={{
                width: "100%",
                height: 1,
                borderTop: "thin solid var(--input-border-default, var(--input-border))",
                paddingTop: 5,
                paddingBottom: 5
            }}/>),
    },
    userPopout: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show all activities in the profile popout/sidebar",
        default: true,
        restartNeeded: true,
    },
    hideTooltip: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Hides activities in various places",
        default: true,
    },
    allActivitiesStyle: {
        type: 4 /* OptionType.SELECT */,
        description: "Style for showing all activities",
        options: [
            {
                default: true,
                label: "Carousel",
                value: "carousel",
            },
            {
                label: "List",
                value: "list",
            },
        ]
    }
});
