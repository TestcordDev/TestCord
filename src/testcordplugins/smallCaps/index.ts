/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findOption, RequiredMessageOption } from "@api/Commands";
import definePlugin from "@utils/types";

const caps: Record<string, string> = {
    a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ",
    j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: " q", r: "ʀ",
    s: "ꜱ", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ"
};

export default definePlugin({
    name: "SmallCaps",
    description: "/smallcaps writes your message in ꜱᴍᴀʟʟ ᴄᴀᴘꜱ.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Commands"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "smallcaps",
            description: "Convert to small caps",
            options: [RequiredMessageOption],
            execute: opts => ({
                content: findOption(opts, "message", "").toLowerCase().replace(/[a-z]/g, c => caps[c] ?? c)
            })
        }
    ]
});
