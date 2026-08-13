/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findOption, RequiredMessageOption } from "@api/Commands";
import definePlugin from "@utils/types";

const swaps: Record<string, string> = { a: "4", e: "3", i: "1", o: "0", s: "5", t: "7", b: "8", g: "9", l: "1" };

export default definePlugin({
    name: "LeetText",
    description: "/leet rewrites your message in 1337 5p34k.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Fun", "Chat", "Commands"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "leet",
            description: "Convert to leetspeak",
            options: [RequiredMessageOption],
            execute: opts => ({
                content: findOption(opts, "message", "").replace(/[aeiostbgl]/gi, c => swaps[c.toLowerCase()])
            })
        }
    ]
});
