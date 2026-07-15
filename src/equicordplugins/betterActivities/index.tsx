/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { migratePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import { patchActivityList } from "./patch-helpers/activityList";
import { settings } from "./settings";

migratePluginSettings("BetterActivities", "MemberListActivities");

export default definePlugin({
    name: "BetterActivities",
    description: "Shows activity icons in the member list and allows showing all activities",
    authors: [Devs.D3SOX, Devs.Arjix, Devs.AutumnVN, Devs.thororen],
    tags: ["Activity"],
    settings,
    patchActivityList,
    patches: [
        {
            // Patch activity icons
            find: '"ActivityStatus"),',
            replacement: [
                {
                    match: /(?<=className:\i,children:\[).*?(?=\i\(\),\i&&)/,
                    replace: "",
                    predicate: () => settings.store.removeGameActivityStatus,
                },
                {
                    match: /(?<=className:\i,children:\[\i\(\),)null.*?tooltipClassName:\i\}\),/,
                    replace: "",
                    predicate: () => settings.store.removeGameActivityStatus,
                },
                {
                    match: /(?<=hideTooltip:.{0,4}}=(\i).*?{}\))\]/g,
                    replace: ",$self.patchActivityList($1)]",
                    predicate: () => settings.store.memberList,
                }
            ],
        },
    ],
});
