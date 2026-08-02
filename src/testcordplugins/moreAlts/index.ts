/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
const settings = definePluginSettings({
    amtOfAcounts: {
        default: 10,
        type: OptionType.NUMBER,
        description: "The amount of alts to allow."
    },
});

export default definePlugin({
    name: "MoreAlts",
    description: "Allows you to have more alts in the account switcher",
    tags: ["Utility", "Privacy"],
    authors: [
        {
            id: 253302259696271360n,
            name: "zastix",
        },
        TestcordDevs.x2b,
    ],
    settings,
    patches: [
        {
            find: "\"multiaccount_cta_tooltip_seen\"",
            replacement: [{
                // the first export seems to always be the amount of alts, we should find a better way to do this in the future
                match: /([A-Za-z_$][\w$]*):(function\(\)\{return \d+|\(\)=>\d+)/,
                replace: "$1:()=>$self.settings.store.amtOfAcounts",
                noWarn: true
            }]
        }
    ]
});
