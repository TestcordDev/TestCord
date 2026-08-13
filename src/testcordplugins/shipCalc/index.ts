/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandOptionType, findOption } from "@api/Commands";
import definePlugin from "@utils/types";

// stable per name-pair so the same couple always gets the same score
function score(a: string, b: string) {
    const s = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort().join("💕");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 101;
}

const opt = (name: string) => ({
    name,
    description: `Person ${name === "a" ? "one" : "two"}`,
    type: ApplicationCommandOptionType.STRING,
    required: true
});

export default definePlugin({
    name: "ShipCalc",
    description: "/ship rates the love between two people.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Commands", "Fun"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "ship",
            description: "Calculate a love percentage between two people",
            options: [opt("a"), opt("b")],
            execute: opts => {
                const a = findOption(opts, "a", "");
                const b = findOption(opts, "b", "");
                const pct = score(a, b);
                const heart = pct > 80 ? "💞" : pct > 50 ? "💖" : pct > 25 ? "💗" : "💔";
                return { content: `${heart} **${a}** + **${b}** = **${pct}%**` };
            }
        }
    ]
});
