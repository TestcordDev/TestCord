/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findOption, RequiredMessageOption } from "@api/Commands";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "Starify",
    description: "Adds /starify to wrap your message in sparkles ｡ﾟ☆.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Commands"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "starify",
            description: "Decorate your message with sparkles",
            options: [RequiredMessageOption],
            execute: opts => {
                const text = findOption(opts, "message", "");
                return { content: `✦ﾟ｡⋆ ${text} ⋆｡ﾟ✦` };
            }
        }
    ]
});
