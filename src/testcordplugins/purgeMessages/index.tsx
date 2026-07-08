/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { Forms, MessageActions, MessageStore, UserStore } from "@webpack/common";

async function deleteMessages(amount: number, channel: Channel, delay: number = 1500): Promise<number> {
    let deleted = 0;
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) {
        console.error("[PurgeMessages] No user ID found");
        return 0;
    }

    const channelId = typeof channel === "string" ? channel : channel?.id;
    if (!channelId) {
        console.error("[PurgeMessages] No channel ID found");
        return 0;
    }

    const messagesData = MessageStore.getMessages(channelId);
    if (!messagesData || !messagesData._array) {
        console.error("[PurgeMessages] No messages found in store for channel:", channelId);
        return 0;
    }

    const allMessages = messagesData._array.filter((m: Message) => m.author?.id === userId);
    const messages: Message[] = [...allMessages].reverse().slice(0, amount);

    if (messages.length === 0) {
        console.error("[PurgeMessages] No messages to delete (found", allMessages.length, "user messages)");
        return 0;
    }

    console.log("[PurgeMessages] Attempting to delete", messages.length, "messages from channel", channelId);

    for (const message of messages) {
        try {
            if (!message.id) continue;
            MessageActions.deleteMessage(channelId, message.id);
            deleted++;
            if (deleted >= amount) break;
            await sleep(delay);
        } catch (error) {
            console.error("[PurgeMessages] Failed to delete message:", message.id, error);
        }
    }

    console.log("[PurgeMessages] Deleted", deleted, "messages");
    return deleted;
}

export default definePlugin({
    name: "PurgeMessages",
    description: "Purges messages from a channel",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    settingsAboutComponent: () => <>
        <Forms.FormText className="plugin-warning">
            We can't guarantee this plugin won't get you warned or banned.
        </Forms.FormText>
    </>,
    commands: [
        {
            name: "purge",
            description: "Purge a chosen amount of messages from a channel",
            options: [
                {
                    name: "amount",
                    description: "How many messages you wish to purge",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: true
                },
                {
                    name: "channel",
                    description: "Channel ID you wish to purge from",
                    type: ApplicationCommandOptionType.CHANNEL,
                    required: false
                },
                {
                    name: "delay",
                    description: "Delay inbetween deleting messages",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: false
                }
            ],
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (opts, ctx) => {
                const amount: number = findOption(opts, "amount", 0);
                if (!amount || amount <= 0) {
                    sendBotMessage(ctx.channel.id, {
                        content: "> Invalid amount specified."
                    });
                    return;
                }

                const channel: Channel = findOption(opts, "channel", ctx.channel) || ctx.channel;
                const delay: number = findOption(opts, "delay", 1500);

                sendBotMessage(ctx.channel.id, {
                    content: `> deleting ${amount} messages.`
                });

                try {
                    const deleted = await deleteMessages(amount, channel, delay);
                    sendBotMessage(ctx.channel.id, {
                        content: `> deleted ${deleted} messages`
                    });
                } catch (error) {
                    console.error("[PurgeMessages] Error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: "> Error: Failed to delete messages"
                    });
                }
            },
        }
    ],
});
