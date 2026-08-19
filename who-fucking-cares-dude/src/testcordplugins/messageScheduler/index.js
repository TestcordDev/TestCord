/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { moment } from "@webpack/common";
const settings = definePluginSettings({
    showNotifications: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show notifications when scheduled messages are sent",
        default: true
    }
});
// Store for scheduled messages
const scheduledMessages = [];
const logger = new Logger("MessageScheduler");
// Parse relative time like "1h30m", "2d", "30s", etc.
function parseRelativeTime(timeStr) {
    const regex = /(\d+)([dhms])/g;
    let match;
    let totalMs = 0;
    let found = false;
    while ((match = regex.exec(timeStr)) !== null) {
        found = true;
        const value = parseInt(match[1], 10);
        const unit = match[2];
        switch (unit) {
            case "d":
                totalMs += value * 24 * 60 * 60 * 1000;
                break;
            case "h":
                totalMs += value * 60 * 60 * 1000;
                break;
            case "m":
                totalMs += value * 60 * 1000;
                break;
            case "s":
                totalMs += value * 1000;
                break;
        }
    }
    return found ? totalMs : null;
}
// Parse exact time like "3:30pm", "15:45", etc.
function parseExactTime(timeStr) {
    // Try to parse various time formats
    const formats = [
        "h:mma", "h:mm a", "H:mm", // 3:30pm, 3:30 pm, 15:30
        "ha", "h a", "H", // 3pm, 3 pm, 15
    ];
    for (const format of formats) {
        const date = moment(timeStr, format);
        if (date.isValid()) {
            let timestamp = date.valueOf();
            // If the time is in the past, add a day
            if (timestamp < Date.now()) {
                timestamp += 24 * 60 * 60 * 1000;
            }
            return timestamp;
        }
    }
    return null;
}
// Schedule a message to be sent
function scheduleMessage(channelId, content, delay) {
    const scheduledTime = Date.now() + delay;
    const timeoutId = setTimeout(() => {
        sendMessage(channelId, { content });
        // Remove from scheduled messages
        const index = scheduledMessages.findIndex(msg => msg.timeoutId === timeoutId);
        if (index !== -1) {
            scheduledMessages.splice(index, 1);
        }
        if (settings.store.showNotifications) {
            Vencord.Webpack.Common.Toasts.show({
                type: Vencord.Webpack.Common.Toasts.Type.SUCCESS,
                message: "Scheduled message sent!",
                id: "vc-scheduled-message-sent"
            });
        }
    }, delay);
    scheduledMessages.push({
        channelId,
        content,
        scheduledTime,
        timeoutId
    });
    if (settings.store.showNotifications) {
        Vencord.Webpack.Common.Toasts.show({
            type: Vencord.Webpack.Common.Toasts.Type.SUCCESS,
            message: `Message scheduled for ${moment(scheduledTime).format("LT")}`,
            id: "vc-message-scheduled"
        });
    }
}
export default definePlugin({
    name: "MessageScheduler",
    description: "Schedule messages to be sent at a specific time or after a delay",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    commands: [
        {
            name: "schedule",
            description: "Schedule a message to be sent later",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    name: "message",
                    description: "The message to send",
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    required: true
                },
                {
                    name: "time",
                    description: "When to send the message (e.g. '1h30m', '3:30pm')",
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    required: true
                }
            ],
            execute: (args, ctx) => {
                const message = args.find(arg => arg.name === "message")?.value;
                const timeStr = args.find(arg => arg.name === "time")?.value;
                if (!message || !timeStr) {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ Please provide both a message and a time."
                    });
                    return;
                }
                // Try to parse as relative time first
                let delay = parseRelativeTime(timeStr);
                // If not a relative time, try as exact time
                if (delay === null) {
                    const exactTime = parseExactTime(timeStr);
                    if (exactTime !== null) {
                        delay = exactTime - Date.now();
                    }
                    else {
                        sendBotMessage(ctx.channel.id, {
                            content: "❌ Invalid time format. Use relative time (e.g. '1h30m', '45s') or exact time (e.g. '3:30pm', '15:45')."
                        });
                        return;
                    }
                }
                if (delay <= 0) {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ The scheduled time must be in the future."
                    });
                    return;
                }
                scheduleMessage(ctx.channel.id, message, delay);
                sendBotMessage(ctx.channel.id, {
                    content: `✅ Message scheduled to be sent ${moment().add(delay, "ms").fromNow()}.`
                });
            }
        },
        {
            name: "scheduled",
            description: "List all scheduled messages",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            execute: (_, ctx) => {
                const channelMessages = scheduledMessages.filter(msg => msg.channelId === ctx.channel.id);
                if (channelMessages.length === 0) {
                    sendBotMessage(ctx.channel.id, {
                        content: "No scheduled messages for this channel."
                    });
                    return;
                }
                const messageList = channelMessages.map((msg, index) => {
                    const timeStr = moment(msg.scheduledTime).format("LT");
                    const preview = msg.content.length > 50
                        ? msg.content.substring(0, 47) + "..."
                        : msg.content;
                    return `${index + 1}. **${timeStr}**: ${preview}`;
                }).join("\n");
                sendBotMessage(ctx.channel.id, {
                    content: `**Scheduled Messages:**\n${messageList}`
                });
            }
        },
        {
            name: "cancel-scheduled",
            description: "Cancel a scheduled message",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    name: "index",
                    description: "The index of the message to cancel (use /scheduled to see indices)",
                    type: 4 /* ApplicationCommandOptionType.INTEGER */,
                    required: true
                }
            ],
            execute: (args, ctx) => {
                const indexArg = args.find(arg => arg.name === "index")?.value;
                const index = typeof indexArg === "number" ? indexArg : 0;
                if (index <= 0) {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ Please provide a valid message index (use /scheduled to see indices)."
                    });
                    return;
                }
                const channelMessages = scheduledMessages.filter(msg => msg.channelId === ctx.channel.id);
                if (channelMessages.length === 0) {
                    sendBotMessage(ctx.channel.id, {
                        content: "No scheduled messages for this channel."
                    });
                    return;
                }
                if (index > channelMessages.length) {
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Invalid index. There are only ${channelMessages.length} scheduled messages.`
                    });
                    return;
                }
                const messageToCancel = channelMessages[index - 1];
                clearTimeout(messageToCancel.timeoutId);
                const globalIndex = scheduledMessages.findIndex(msg => msg.timeoutId === messageToCancel.timeoutId);
                if (globalIndex !== -1) {
                    scheduledMessages.splice(globalIndex, 1);
                }
                sendBotMessage(ctx.channel.id, {
                    content: "✅ Scheduled message cancelled."
                });
            }
        }
    ],
    start() {
        logger.info("Plugin started");
    },
    stop() {
        // Clear all scheduled messages when plugin is disabled
        for (const msg of scheduledMessages) {
            clearTimeout(msg.timeoutId);
        }
        scheduledMessages.length = 0;
        logger.info("Plugin stopped, all scheduled messages cleared");
    }
});
