/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "BlockKrisp",
    description: "Prevent Krisp from loading",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    patches: [
        // Block loading modules on Desktop
        {
            find: "Failed to load Krisp module",
            replacement: {
                match: /await \i.\i.ensureModule\("discord_krisp"\)/,
                replace: "throw new Error();$&"
            }
        },
        // Block loading modules on Web
        {
            find: "krisp_browser_models",
            replacement: {
                match: /\i:function\(\)\{/,
                replace: "$&return null;"
            }
        },
        // Set Krisp to not supported
        {
            find: "isNoiseCancellationSupported(){",
            replacement: {
                match: /isNoiseCancellationSupported\(\)\{/,
                replace: "$&return false;"
            }
        }
    ],
});
