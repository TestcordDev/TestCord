/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "FixSelectCrash",
    description: "Fixes crash when Select receives undefined items (Cannot read properties of undefined reading 'map').",
    authors: [Devs.Ven],
    patches: [
        {
            find: '"single",items:',
            replacement: {
                match: /(\i)\.useMemo\(\(\)=>(\i)\.map/,
                replace: "$1.useMemo(()=>($2??[]).map"
            }
        }
    ]
});
