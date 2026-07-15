/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "NoDraftLengthLimit",
    description: "Removes the 4500 character saved draft message truncation",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    patches: [
        {
            find: "ApplicationLauncherCommand=3",
            replacement: {
                match: /let \i=\i\(\d+\)\.CS1\+500/,
                replace: "let E=Number.MAX_SAFE_INTEGER"
            }
        }
    ]
});
