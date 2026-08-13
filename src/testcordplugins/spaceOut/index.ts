/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findOption, RequiredMessageOption } from "@api/Commands";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "SpaceOut",
    description: "/spaceout p u t s   s p a c e s   between every letter.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Commands"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "spaceout",
            description: "Space out every letter",
            options: [RequiredMessageOption],
            execute: opts => ({
                content: findOption(opts, "message", "").split("").join(" ")
            })
        }
    ]
});
