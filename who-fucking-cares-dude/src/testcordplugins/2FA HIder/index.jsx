/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import definePlugin from "@utils/types";
export default definePlugin({
    name: "1FA",
    description: "hide the 2fa moderation warning because annoying",
    tags: ["Privacy", "Utility"],
    authors: [{ id: 1003477997728313405n, name: "Death" }],
    patches: [
        {
            find: "APPLICATION_SUBSCRIPTION_EXPIRATION:",
            replacement: [{
                    match: /GUILD_MFA_WARNING:return/,
                    replace: "GUILD_MFA_WARNING:return;return"
                }]
        }
    ]
});
