/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findOption, RequiredMessageOption } from "@api/Commands";
import definePlugin from "@utils/types";

/** Convert ASCII to fullwidth characters: "aesthetic" -> "ａｅｓｔｈｅｔｉｃ" */
function toFullwidth(text: string): string {
    return text.replace(/[ -~]/g, c =>
        c === " " ? "　" : String.fromCharCode(c.charCodeAt(0) + 0xFEE0)
    );
}

export default definePlugin({
    name: "VaporwaveText",
    description: "Adds /vaporwave to turn your message into ａｅｓｔｈｅｔｉｃ fullwidth text.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Commands"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "vaporwave",
            description: "Convert text to fullwidth ａｅｓｔｈｅｔｉｃ characters",
            options: [RequiredMessageOption],
            execute: opts => ({
                content: toFullwidth(findOption(opts, "message", ""))
            })
        }
    ]
});
