/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

const VIBES = [
    "✦ the vibes are immaculate ✦",
    "🌴 endless summer, endless mall 🌴",
    "📼 rewinding to a time that never was 📼",
    "🛍️ welcome to the mall, population: you 🛍️",
    "🌅 chasing a sunset that never sets 🌅",
    "💾 saving your aesthetic... done 💾",
    "🪩 disco ball energy detected 🪩",
    "🌊 floating on a sea of neon 🌊",
    "☎️ this call is being routed through 1987 ☎️",
    "🍹 sipping something pink by the fountain 🍹",
];

export default definePlugin({
    name: "VibeCheck",
    description: "Adds /vibe to drop a random vaporwave mood into chat.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Commands", "Fun"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "vibe",
            description: "Send a random vaporwave vibe",
            options: [],
            execute: () => ({
                content: VIBES[Math.floor(Math.random() * VIBES.length)]
            })
        }
    ]
});
