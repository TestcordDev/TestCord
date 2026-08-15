/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, ApplicationCommandType, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import { getCurrentChannel, sendMessage } from "@utils/discord";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "Eval",
    description: "Adds a / command to evaluate JavaScript on your client",
    tags: ["Developers", "Console"],
    authors: [Devs.nin0dev],
    commands: [{
        name: "eval",
        description: "Evaluate JavaScript in your client (USE WITH EXTREME CAUTION)",
        async execute(args, ctx) {
            // thank you vee
            const console: any = {
                _lines: [] as string[],
                _log(...things: string[]) {
                    this._lines.push(
                        ...things
                            .join(" ")
                            .split("\n")
                    );
                }
            };
            console.log = console.error = console.warn = console.info = console._log.bind(console);

            let script = args[0].value.replace(/(^`{3}(js|javascript)?|`{3}$)/g, "");
            if (script.includes("await")) script = `(async () => { ${script} })()`;

            try {
                var result = await (0, eval)(script);
            } catch (e: any) {
                var result = e;
            }

            if (args[1] && args[1].value) {
                sendMessage(getCurrentChannel()!.id, {
                    content: "```\n" + args[0].value + "\n```\n\n```js\n" + `${result}\n\n${console._lines.join("\n")}` + "\n```"
                });
            }
            else {
                sendBotMessage(getCurrentChannel()!.id, {
                    content: "```\n" + args[0].value + "\n```\n```js\n" + `${result}\n\n${console._lines.join("\n")}` + "\n```"
                });
            }
        },
        type: ApplicationCommandType.CHAT_INPUT,
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{
            name: "code",
            description: "The code to run",
            required: true,
            type: ApplicationCommandOptionType.STRING
        }, {
            name: "send",
            description: "Send the output in chat (default to false)",
            type: ApplicationCommandOptionType.BOOLEAN,
            required: false
        }]
    }, {
        name: "native-eval",
        description: "Evaluate JavaScript from a NodeJS context (USE WITH EXTREME CAUTION)",
        async execute(args, ctx) {
            try {
                var result = await VencordNative.pluginHelpers.Eval.evalCode(args[0].value);
            } catch (e: any) {
                var result = e;
            }

            if (args[1] && args[1].value) {
                sendMessage(getCurrentChannel()!.id, {
                    content: "```\n" + args[0].value + "\n```\n\n```js\n" + result + "\n```"
                });
            }
            else {
                sendBotMessage(getCurrentChannel()!.id, {
                    content: "```\n" + args[0].value + "\n```\n\n```js\n" + result + "\n```"
                });
            }
        },
        type: ApplicationCommandType.CHAT_INPUT,
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{
            name: "code",
            description: "The code to run",
            required: true,
            type: ApplicationCommandOptionType.STRING
        }, {
            name: "send",
            description: "Send the output in chat (default to false)",
            type: ApplicationCommandOptionType.BOOLEAN,
            required: false
        }]
    }]
});
