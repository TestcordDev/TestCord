/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findOption, RequiredMessageOption } from "@api/Commands";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "ClapText",
    description: "Adds /clap to 👏 put 👏 claps 👏 between 👏 your 👏 words.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Fun"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "clap",
            description: "Put 👏 claps 👏 between 👏 words",
            options: [RequiredMessageOption],
            execute: opts => ({
                content: findOption(opts, "message", "")
                    .split(/\s+/)
                    .filter(Boolean)
                    .join(" 👏 ")
            })
        }
    ]
});
