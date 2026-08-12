/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    autoReactEnabled: {
        type: OptionType.BOOLEAN,
        description: "Auto-react enabled",
        default: false,
    },
    emojis: {
        type: OptionType.STRING,
        description: "Emojis as JSON array",
        default: "[]",
    },
    targetUserId: {
        type: OptionType.STRING,
        description: "Target user ID (empty = yourself)",
        default: "",
    },
});

function parseEmoji(text: string): string | null {
    const customMatch = text.match(/^<(a)?:(\w+):(\d+)>$/);
    if (customMatch) {
        return `${customMatch[1] ? "a:" : ""}${customMatch[2]}:${customMatch[3]}`;
    }
    return encodeURIComponent(text);
}

async function addReactions(channelId: string, messageId: string, emojis: string[]) {
    for (const emoji of emojis) {
        const parsed = parseEmoji(emoji);
        if (!parsed) continue;
        try {
            await RestAPI.put({
                url: `/channels/${channelId}/messages/${messageId}/reactions/${parsed}/@me`
            });
        } catch (e: any) {
            if (e?.status !== 404)
                console.error("[SelfReactCommand] Failed to add reaction:", e);
        }
    }
}

function handleMessageCreate(data: any) {
    if (!settings.store.autoReactEnabled) return;

    const { message } = data;
    if (!message) return;

    const currentUserId = UserStore.getCurrentUser().id;
    const targetId = settings.store.targetUserId || currentUserId;

    if (message.author.id !== targetId) return;

    const emojis: string[] = JSON.parse(settings.store.emojis || "[]");
    if (!Array.isArray(emojis) || emojis.length === 0) return;

    addReactions(message.channel_id, message.id, emojis);
}

export default definePlugin({
    name: "SelfReactCommand",
    description: "Auto-react to your own (or someone else's) new messages with custom emojis",
    tags: ["Reactions", "Commands", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["CommandsAPI"],
    settings,
    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
    },
    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageCreate);
    },
    commands: [
        {
            name: "selfreact",
            description: "Auto-react to messages with emojis",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "state",
                    description: "Turn auto-react on or off",
                    required: false,
                    type: ApplicationCommandOptionType.STRING,
                    choices: [
                        { label: "On", name: "on", value: "on" },
                        { label: "Off", name: "off", value: "off" },
                    ]
                },
                {
                    name: "emojis",
                    description: "Emojis to react with (space-separated)",
                    required: false,
                    type: ApplicationCommandOptionType.STRING
                },
                {
                    name: "user",
                    description: "Target user (leave empty for yourself)",
                    required: false,
                    type: ApplicationCommandOptionType.USER
                }
            ],
            execute: async (_args, ctx) => {
                const state = findOption<string>(_args, "state", "");
                const emojisStr = findOption<string>(_args, "emojis", "");
                const targetUserId = findOption<string>(_args, "user", "");

                if (state === "off") {
                    settings.store.autoReactEnabled = false;
                    sendBotMessage(ctx.channel.id, { content: "Auto-react **disabled**." });
                    return;
                }

                if (emojisStr.trim()) {
                    const emojis = emojisStr.split(/\s+/).filter(Boolean);
                    settings.store.emojis = JSON.stringify(emojis);
                }

                if (targetUserId) {
                    settings.store.targetUserId = targetUserId;
                }

                if (state === "on" || emojisStr.trim()) {
                    const storedEmojis: string[] = JSON.parse(settings.store.emojis || "[]");
                    if (!Array.isArray(storedEmojis) || storedEmojis.length === 0) {
                        sendBotMessage(ctx.channel.id, { content: "No emojis set! Provide emojis like `/selfreact emojis:😀 👍`." });
                        return;
                    }
                    settings.store.autoReactEnabled = true;
                    const targetLabel = settings.store.targetUserId ? `<@${settings.store.targetUserId}>` : "yourself";
                    sendBotMessage(ctx.channel.id, {
                        content: `Auto-react **enabled**!\nTarget: ${targetLabel}\nEmojis: ${storedEmojis.join(" ")}`
                    });
                    return;
                }

                const isEnabled = settings.store.autoReactEnabled;
                const storedEmojis: string[] = JSON.parse(settings.store.emojis || "[]");
                const targetLabel = settings.store.targetUserId ? `<@${settings.store.targetUserId}>` : "yourself";
                sendBotMessage(ctx.channel.id, {
                    content: `Auto-react is **${isEnabled ? "enabled" : "disabled"}**\nTarget: ${targetLabel}\nEmojis: ${Array.isArray(storedEmojis) && storedEmojis.length > 0 ? storedEmojis.join(" ") : "None set"}`
                });
            }
        }
    ]
});
