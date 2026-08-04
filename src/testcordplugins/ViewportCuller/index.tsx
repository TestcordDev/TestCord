/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { MessageStore, SelectedChannelStore } from "@webpack/common";

import style from "./style.css?managed";

const logger = new Logger("ViewportCuller");
let trimInterval: ReturnType<typeof setInterval> | null = null;

const settings = definePluginSettings({
    enableCssContainment: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Enable hardware layout & paint culling (content-visibility: auto) for off-screen message list items and cards.",
        onChange: (enabled: boolean) => {
            if (enabled) {
                enableStyle(style);
            } else {
                disableStyle(style);
            }
        },
    },
    trimBackgroundChannels: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Periodically clear cached message DOM & memory for inactive channels to dramatically reduce RAM usage.",
    },
    trimIntervalSeconds: {
        type: OptionType.SLIDER,
        description: "Interval (in seconds) between automatic RAM & MessageStore cache flushes.",
        markers: [15, 30, 60, 120],
        default: 30,
        stickToMarkers: false,
    },
});

function purgeInactiveChannelCaches() {
    try {
        const currentChannelId = SelectedChannelStore.getChannelId();
        const rawStore = MessageStore as any;

        // Trim internal MessageStore caches for non-selected channels
        if (rawStore?._channelMessages) {
            let cleared = 0;
            for (const channelId of Object.keys(rawStore._channelMessages)) {
                if (channelId !== currentChannelId) {
                    delete rawStore._channelMessages[channelId];
                    cleared++;
                }
            }
            if (cleared > 0 && settings.store.enableCssContainment) {
                logger.info(`Flushed memory cache for ${cleared} inactive channels.`);
            }
        }

        // Force browser garbage collection hint if available in Electron
        if (typeof globalThis.gc === "function") {
            globalThis.gc();
        }
    } catch (e) {
        logger.error("Failed purging channel cache:", e);
    }
}

export default definePlugin({
    name: "ViewportCuller",
    description: "Hardware layout culler & memory trimmer: stops rendering offscreen elements and flushes inactive channel message caches to drastically drop RAM & CPU usage.",
    authors: [TestcordDevs.x2b],

    settings,

    start() {
        if (settings.store.enableCssContainment) {
            enableStyle(style);
        }

        if (settings.store.trimBackgroundChannels) {
            purgeInactiveChannelCaches();
            const intervalMs = (settings.store.trimIntervalSeconds ?? 30) * 1000;
            trimInterval = setInterval(purgeInactiveChannelCaches, intervalMs);
        }
    },

    stop() {
        disableStyle(style);
        if (trimInterval) {
            clearInterval(trimInterval);
            trimInterval = null;
        }
    },
});
