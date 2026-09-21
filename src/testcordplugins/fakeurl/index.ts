/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandOptionType, findOption } from "@api/Commands";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

const INVISIBLES = "\u200B\u200C\u200D\uFEFF\u2060\u2061\u2062\u2063\u2064\u206A\u206B\u206C\u206D\u206E\u206F\uFE00\uFE01\uFE02\uFE03\uFE04\uFE05\uFE06\uFE07\uFE08\uFE09\uFE0A\uFE0B\uFE0C\uFE0D\uFE0E\uFE0F";

function spoof(text: string): string {
    let out = "";
    for (const char of text)
        out += char + INVISIBLES[(Math.random() * INVISIBLES.length) | 0];
    return out;
}

export default definePlugin({
    name: "FakeUrl",
    description: "Send masked links with invisible characters so the shown link can differ from the real destination.",
    authors: [TestcordDevs.x2b],
    tags: ["Chat", "Fun", "Commands"],
    commands: [
        {
            name: "fakeurl",
            description: "Send a masked link that shows one link but opens another.",
            options: [
                {
                    name: "fake-link",
                    description: "Link text shown in chat.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "real-link",
                    description: "Link actually opened on click.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "hide-embed",
                    description: "Suppress the link embed.",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false
                }
            ],
            execute: opts => {
                const fake = findOption(opts, "fake-link", "").trim();
                const real = findOption(opts, "real-link", "").trim().replace(/^<(.+)>$/, "$1");
                if (!fake || !real) return;
                const target = findOption(opts, "hide-embed", false) ? `<${real}>` : real;
                return { content: `[${spoof(fake)}](${target})` };
            }
        }
    ]
});
