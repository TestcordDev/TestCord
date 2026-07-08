/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, React, RelationshipStore, UserStore } from "@webpack/common";

const logger = new Logger("MassDM");

interface ResponsePair {
    trigger: string;
    response: string;
}

const settings = definePluginSettings({
    friends: {
        type: OptionType.BOOLEAN,
        description: "Include friends in mass DM",
        default: true,
    },
    onlyFriends: {
        type: OptionType.BOOLEAN,
        description: "Only message friends (requires Friends to be enabled)",
        default: false,
    },
    allOpenDMs: {
        type: OptionType.BOOLEAN,
        description: "Send to all open DMs instead of friends",
        default: false,
    },
    autoResponses: {
        type: OptionType.BOOLEAN,
        description: "Enable automatic responses to triggers",
        default: false,
    },
    useWhitelist: {
        type: OptionType.BOOLEAN,
        description: "Treat the user IDs list as a whitelist (only message them) instead of a blacklist (exclude them).",
        default: false,
    },
    userIds: {
        type: OptionType.STRING,
        description: "Comma-separated user IDs to filter by, used as a blacklist or whitelist depending on the setting above.",
        default: "",
    },
    responses: {
        type: OptionType.COMPONENT,
        description: "Manage trigger-response pairs",
        component: () => <ResponsesSettings />,
    },
});

function ResponsesSettings() {
    const [responses, setResponses] = React.useState<ResponsePair[]>(settings.store.responses || []);

    const addResponse = () => {
        setResponses([...responses, { trigger: "", response: "" }]);
    };

    const updateResponse = (index: number, field: keyof ResponsePair, value: string) => {
        const newResponses = [...responses];
        newResponses[index][field] = value;
        setResponses(newResponses);
        settings.store.responses = newResponses;
    };

    const deleteResponse = (index: number) => {
        const newResponses = responses.filter((_, i) => i !== index);
        setResponses(newResponses);
        settings.store.responses = newResponses;
    };

    return (
        <div>
            {responses.map((resp, index) => (
                <div key={index} style={{ marginBottom: "10px", display: "flex", alignItems: "center" }}>
                    <input
                        type="text"
                        placeholder="Trigger word"
                        value={resp.trigger}
                        onChange={e => updateResponse(index, "trigger", e.target.value)}
                        style={{ marginRight: "10px", flex: 1 }}
                    />
                    <input
                        type="text"
                        placeholder="Response message"
                        value={resp.response}
                        onChange={e => updateResponse(index, "response", e.target.value)}
                        style={{ marginRight: "10px", flex: 1 }}
                    />
                    <button onClick={() => deleteResponse(index)}>Delete</button>
                </div>
            ))}
            <button onClick={addResponse}>Add Response</button>
        </div>
    );
}

function applyIdFilter(users: string[]) {
    const idList = settings.store.userIds.split(",").map(id => id.trim()).filter(id => id);
    if (idList.length === 0) return users;

    return settings.store.useWhitelist
        ? users.filter(id => idList.includes(id))
        : users.filter(id => !idList.includes(id));
}

function getUsersToMessage() {
    if (settings.store.allOpenDMs) {
        // Get all user IDs that have DM channels
        const dmMap = ChannelStore.getMutableDMsByUserIds();
        const openDms = Object.keys(dmMap).filter(id => id !== UserStore.getCurrentUser().id);
        return applyIdFilter(openDms);
    }

    const users: string[] = [];

    if (settings.store.friends) {
        const friendIds = RelationshipStore.getFriendIDs();
        users.push(...friendIds);
    }

    if (settings.store.onlyFriends && settings.store.friends) {
        // If only friends, filter to only friends
        const friendIds = RelationshipStore.getFriendIDs();
        return applyIdFilter(users.filter(id => friendIds.includes(id)));
    }

    return applyIdFilter(users.filter(id => id !== UserStore.getCurrentUser().id));
}

export default definePlugin({
    name: "MassDM",
    description: "Mass direct message users with customizable options and auto-responses",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b, TestcordDevs.nnenaza],
    settings,

    commands: [
        {
            name: "massdm",
            description: "Send a message to multiple users",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "message",
                    description: "The message to send",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
                {
                    name: "delay",
                    description: "Delay between messages in milliseconds (default: 100)",
                    type: ApplicationCommandOptionType.NUMBER,
                    required: false,
                },
            ],
            execute: async (args, ctx) => {
                const message = args.find(arg => arg.name === "message")?.value as string;
                const delayArg = args.find(arg => arg.name === "delay")?.value;
                const delay = typeof delayArg === "number" ? delayArg : 100;

                if (!message) {
                    sendBotMessage(ctx.channel.id, { content: "❌ Please provide a message." });
                    return;
                }

                const users = getUsersToMessage();
                if (users.length === 0) {
                    sendBotMessage(ctx.channel.id, { content: "❌ No users to message based on current settings." });
                    return;
                }

                sendBotMessage(ctx.channel.id, { content: `🚀 Starting mass DM to ${users.length} users...` });

                for (let i = 0; i < users.length; i++) {
                    const userId = users[i];
                    try {
                        let channelId = ChannelStore.getDMFromUserId(userId);
                        if (!channelId) {
                            // Dispatch DM_OPEN to create the DM channel
                            FluxDispatcher.dispatch({
                                type: "DM_OPEN",
                                userId: userId,
                                channelId: null,
                            });
                            // Wait a bit for the channel to be created
                            await sleep(100);
                            channelId = ChannelStore.getDMFromUserId(userId);
                        }
                        if (channelId) {
                            sendMessage(channelId, { content: message });
                        }
                    } catch (error) {
                        logger.error(`Failed to send message to ${userId}:`, error);
                    }

                    if (i < users.length - 1) {
                        await sleep(delay);
                    }
                }

                sendBotMessage(ctx.channel.id, { content: "✅ Mass DM completed!" });
            },
        },
    ],

    patches: [
        {
            find: "MESSAGE_CREATE:function",
            replacement: {
                match: /MESSAGE_CREATE:function\((\i)\)\{/,
                replace: "MESSAGE_CREATE:function($1){$self.handleMessage($1);",
            },
        },
    ],

    handleMessage: (event: any) => {
        if (!settings.store.autoResponses) return;

        const { message } = event;
        if (!message || message.author.id === UserStore.getCurrentUser().id) return;

        const responses: ResponsePair[] = settings.store.responses || [];
        for (const resp of responses) {
            if (resp.trigger && resp.response && message.content.toLowerCase().includes(resp.trigger.toLowerCase())) {
                // Send response in the same channel
                sendMessage(message.channel_id, { content: resp.response });
                break; // Only respond to first matching trigger
            }
        }
    },
});
