/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findOption, RequiredMessageOption } from "@api/Commands";
import definePlugin from "@utils/types";

function toBold(text: string) {
    return [...text].map(ch => {
        const c = ch.codePointAt(0)!;
        if (c >= 65 && c <= 90) return String.fromCodePoint(0x1D400 + c - 65);
        if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D41A + c - 97);
        if (c >= 48 && c <= 57) return String.fromCodePoint(0x1D7CE + c - 48);
        return ch;
    }).join("");
}

export default definePlugin({
    name: "BoldText",
    description: "/bold turns your message into 𝐮𝐧𝐢𝐜𝐨𝐝𝐞 bold (works where markdown can't).",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Chat", "Commands"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "bold",
            description: "Make your text unicode-bold",
            options: [RequiredMessageOption],
            execute: opts => ({ content: toBold(findOption(opts, "message", "")) })
        }
    ]
});
