/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findOption, sendBotMessage } from "@api/Commands";
import { DataStore } from "@api/index";
import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Parser, React, Text } from "@webpack/common";
let userFlags = new Map();
var FlagType;
(function (FlagType) {
    FlagType["DANGER"] = "danger";
    FlagType["WARNING"] = "warning";
    FlagType["INFO"] = "info";
    FlagType["POSITIVE"] = "positive";
})(FlagType || (FlagType = {}));
const flagRegistry = {
    [FlagType.DANGER]: {
        label: "Danger",
        color: "#ff7473",
        emoji: "🛑"
    },
    [FlagType.WARNING]: {
        label: "Warning",
        color: "#ffb02e",
        emoji: "⚠️"
    },
    [FlagType.INFO]: {
        label: "Info",
        color: "#62a8ff",
        emoji: "ℹ️"
    },
    [FlagType.POSITIVE]: {
        label: "Positive",
        color: "#62ff74",
        emoji: "✅"
    }
};
const subscribers = new Set();
function subscribe(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}
function Flag({ id }) {
    const flag = React.useSyncExternalStore(subscribe, () => userFlags.get(id));
    if (!flag)
        return null;
    return (<div>
            <Text variant="text-md/bold" style={{ color: flagRegistry[flag.type].color }}>
                {Parser.parse(flagRegistry[flag.type].emoji)} {flag.text}
            </Text>
        </div>);
}
export default definePlugin({
    name: "UserFlags",
    description: "Add flags to users that will always show under their messages",
    tags: ["Utility", "Appearance"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessageAccessoriesAPI"],
    async start() {
        const savedFlags = await DataStore.get("USERFLAGS");
        if (savedFlags) {
            if (typeof savedFlags === "string") {
                userFlags = new Map(JSON.parse(savedFlags));
            }
            else {
                userFlags = new Map(savedFlags);
            }
        }
        addMessageAccessory("flag", (props) => (<Flag id={props.message.author.id}/>), 4);
    },
    stop() {
        removeMessageAccessory("flag");
    },
    commands: [
        {
            name: "flag set",
            description: "Set a flag on a user",
            inputType: 3 /* ApplicationCommandInputType.BOT */,
            options: [
                {
                    name: "user",
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    description: "The user to set a flag to",
                    required: true
                },
                {
                    name: "type",
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    description: "The type of flag to add",
                    choices: Object.entries(flagRegistry).map(([key, flag]) => ({
                        name: key,
                        label: flag.label,
                        displayName: flag.label,
                        value: key,
                    })),
                    required: true
                },
                {
                    name: "message",
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    description: "The flag content",
                    required: true
                },
            ],
            execute: async (args, ctx) => {
                const user = findOption(args, "user", "");
                const type = findOption(args, "type", FlagType.INFO);
                const text = findOption(args, "message", "");
                userFlags.set(user, {
                    type,
                    text
                });
                subscribers.forEach(cb => cb());
                sendBotMessage(ctx.channel.id, {
                    content: `Flag set on <@${user}> with content \`${text}\`!`
                });
                await DataStore.set("USERFLAGS", userFlags);
                return;
            }
        },
        {
            name: "flag delete",
            description: "Delete the flag from a user",
            inputType: 3 /* ApplicationCommandInputType.BOT */,
            options: [
                {
                    name: "user",
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    description: "The user to delete the flag from",
                    required: true
                }
            ],
            execute: async (args, ctx) => {
                const user = findOption(args, "user", "");
                userFlags.delete(user);
                subscribers.forEach(cb => cb());
                sendBotMessage(ctx.channel.id, {
                    content: `Flag removed from <@${user}>`
                });
                await DataStore.set("USERFLAGS", userFlags);
                return;
            }
        }
    ]
});
