/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import style from "./style.css?managed";

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
});

export default definePlugin({
    name: "ViewportCuller",
    description: "Hardware layout culler: stops rendering offscreen elements to drop RAM & CPU usage.",
    authors: [TestcordDevs.x2b],

    settings,

    start() {
        if (settings.store.enableCssContainment) {
            enableStyle(style);
        }
    },

    stop() {
        disableStyle(style);
    },
});
