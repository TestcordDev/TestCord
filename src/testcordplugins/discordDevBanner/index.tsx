/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "@equicordplugins/discordDevBanner/styles.css";

import { makeDevBanner, settings } from "@equicordplugins/discordDevBanner/components";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "DiscordDevBanner",
    description: "Enables the Discord developer banner, which displays build and client information",
    tags: ["Customisation", "Developers"],
    authors: [
        EquicordDevs.KrystalSkull,
        TestcordDevs.x2b,
        TestcordDevs.sirphantom89
    ],
    settings,

    patches: [
        {
            find: '"isHideDevBanner"',
            replacement: [
                {
                    match: '"staging"===window.GLOBAL_ENV.RELEASE_CHANNEL',
                    replace: "true"
                },
                {
                    match: /children:\[.{0,120}#{intl::BUILD_OVERRIDE}.{0,50}\]/,
                    replace: "children:$self.makeDevBanner()"
                },
                {
                    match: /children:\[.{0,120}#{intl::uyrfYF::raw}.{0,50}\]/,
                    replace: "children:$self.makeDevBanner()"
                },
            ]
        }
    ],
    makeDevBanner,
});
