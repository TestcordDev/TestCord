/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, findOption, RequiredMessageOption, sendBotMessage } from "@api/Commands";
import definePlugin from "@utils/types";

interface DictEntry {
    meanings: {
        partOfSpeech: string;
        definitions: { definition: string; example?: string; }[];
    }[];
    phonetic?: string;
}

export default definePlugin({
    name: "Define",
    description: "/define looks up a word's dictionary definition (sent only to you).",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Commands", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "define",
            description: "Look up the definition of a word",
            inputType: ApplicationCommandInputType.BOT,
            options: [RequiredMessageOption],
            execute: async (opts, ctx) => {
                const word = findOption(opts, "message", "").trim();
                if (!word) return;

                try {
                    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
                    if (!res.ok) {
                        sendBotMessage(ctx.channel.id, { content: `No definition found for **${word}**.` });
                        return;
                    }
                    const data = (await res.json()) as DictEntry[];
                    const entry = data[0];
                    const lines: string[] = [`📖 **${word}**${entry.phonetic ? ` ${entry.phonetic}` : ""}`];

                    for (const meaning of entry.meanings.slice(0, 3)) {
                        const def = meaning.definitions[0];
                        if (!def) continue;
                        lines.push(`> *${meaning.partOfSpeech}* — ${def.definition}`);
                        if (def.example) lines.push(`> _e.g. ${def.example}_`);
                    }

                    sendBotMessage(ctx.channel.id, { content: lines.join("\n") });
                } catch {
                    sendBotMessage(ctx.channel.id, { content: "Couldn't reach the dictionary right now." });
                }
            }
        }
    ]
});
