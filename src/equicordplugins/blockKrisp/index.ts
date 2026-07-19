/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "BlockKrisp",
    description: "Prevent Krisp from loading",
    tags: ["Privacy", "Utility", "Voice"],
    authors: [Devs.D3SOX],
    patches: [
        // Block loading modules on Desktop
        {
            find: "Failed to load Krisp module",
            noWarn: true,
            replacement: {
                match: /await \i.\i.ensureModule\("discord_krisp"\)/,
                replace: "await Promise.resolve()"
            }
        },
        // Block loading modules on Web
        {
            find: "krisp_browser_models",
            noWarn: true,
            replacement: {
                match: /if\(this._noiseCancellation\)/,
                replace: "if(false)"
            }
        },
        // Set Krisp to not supported
        {
            find: "isNoiseCancellationSupported(){",
            noWarn: true,
            replacement: {
                match: /isNoiseCancellationSupported\(\)\{/,
                replace: "$&return false;"
            }
        },
        // Fallback: broader find for isNoiseCancellationSupported
        {
            find: "isNoiseCancellationSupported=function",
            noWarn: true,
            replacement: {
                match: /isNoiseCancellationSupported=function\(\)\{/,
                replace: "$&return false;"
            }
        },
        // Fallback: catch NoiseCancellationManager usage
        {
            find: "#{intl::GUILD_AUDIO_DISABLED}",
            noWarn: true,
            replacement: {
                match: /isNoiseCancellationSupported\(\)/,
                replace: "false"
            }
        }
    ],
});
