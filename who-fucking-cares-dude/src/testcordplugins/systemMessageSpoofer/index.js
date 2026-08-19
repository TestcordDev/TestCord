/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { sendBotMessage } from "@api/Commands";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher, UserStore } from "@webpack/common";
const CLYDE_USER_ID = "1081004946872352958";
const DISCORD_SYSTEM_USER_ID = "000000000000000000";
var MessageType;
(function (MessageType) {
    MessageType[MessageType["DEFAULT"] = 0] = "DEFAULT";
    MessageType[MessageType["RECIPIENT_ADD"] = 1] = "RECIPIENT_ADD";
    MessageType[MessageType["RECIPIENT_REMOVE"] = 2] = "RECIPIENT_REMOVE";
    MessageType[MessageType["CALL"] = 3] = "CALL";
    MessageType[MessageType["CHANNEL_NAME_CHANGE"] = 4] = "CHANNEL_NAME_CHANGE";
    MessageType[MessageType["CHANNEL_ICON_CHANGE"] = 5] = "CHANNEL_ICON_CHANGE";
    MessageType[MessageType["CHANNEL_PINNED_MESSAGE"] = 6] = "CHANNEL_PINNED_MESSAGE";
    MessageType[MessageType["USER_JOIN"] = 7] = "USER_JOIN";
    MessageType[MessageType["GUILD_BOOST"] = 8] = "GUILD_BOOST";
    MessageType[MessageType["CHANNEL_FOLLOW_ADD"] = 12] = "CHANNEL_FOLLOW_ADD";
    MessageType[MessageType["AUTO_MODERATION_ACTION"] = 24] = "AUTO_MODERATION_ACTION";
    MessageType[MessageType["PURCHASE_NOTIFICATION"] = 44] = "PURCHASE_NOTIFICATION";
})(MessageType || (MessageType = {}));
function generateSnowflake() {
    const timestamp = BigInt(Date.now() - 1420070400000) << 22n;
    const random = BigInt(Math.floor(Math.random() * 4096));
    return (timestamp | random).toString();
}
function createNitroMessage(gifterId, duration = "1 month") {
    const gifter = UserStore.getUser(gifterId);
    const gifterName = gifter ? gifter.username : "Someone";
    return `${gifterName} has gifted you Discord Nitro for ${duration}!`;
}
function createBoostMessage(boosterId) {
    const booster = boosterId ? UserStore.getUser(boosterId) : null;
    const boosterName = booster ? booster.username : "Someone";
    return `${boosterName} just boosted the server!`;
}
function createClydeMessage(message) {
    return message;
}
function createSystemMessage(title, message) {
    return `${title}: ${message}`;
}
function createAutoModMessage(rule, action, username) {
    const userText = username ? `${username} triggered` : "A message triggered";
    return `🚨 ${userText} an AutoMod rule: ${rule} - ${action}`;
}
function createPurchaseMessage(item, price, username) {
    const userText = username ? `${username} purchased` : "Purchase completed for";
    return `🛒 ${userText} ${item} for ${price}`;
}
function dispatchFakeMessage(channelId, messageData) {
    const messageId = generateSnowflake();
    const timestamp = new Date().toISOString();
    const message = {
        id: messageId,
        type: messageData.type || MessageType.DEFAULT,
        content: messageData.content || "",
        channel_id: channelId,
        author: messageData.author,
        attachments: messageData.attachments || [],
        embeds: messageData.embeds || [],
        components: messageData.components || [],
        timestamp: timestamp,
        edited_timestamp: null,
        mentions: [],
        mention_roles: [],
        mention_everyone: false,
        pinned: false,
        webhook_id: null,
        flags: messageData.flags || 0,
        nonce: messageId,
        tts: false,
        position: 0,
        message_reference: null,
        referenced_message: null,
        interaction: null,
        activity: null,
        application: null,
        application_id: null,
        sticker_items: [],
        reactions: []
    };
    FluxDispatcher.dispatch({
        type: "MESSAGE_CREATE",
        channelId: channelId,
        message: message,
        optimistic: false,
        isPushNotification: false
    });
}
export default definePlugin({
    name: "SystemMessageSpoofer",
    description: "Spoof Discord system messages, including nitro gifts, Clyde messages, and verified Discord messages",
    tags: ["Chat", "Fun"],
    authors: [TestcordDevs.x2b],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "spoofnitro",
            description: "Spoof a Discord Nitro gift notification",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    name: "gifter",
                    description: "User who sent the gift",
                    required: true
                },
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "duration",
                    description: "Duration of the Nitro gift",
                    required: false,
                    choices: [
                        { label: "1 Month", name: "1 Month", value: "1 month" },
                        { label: "3 Months", name: "3 Months", value: "3 months" },
                        { label: "1 Year", name: "1 Year", value: "1 year" }
                    ]
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in (defaults to current)",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const gifterId = args.find(x => x.name === "gifter")?.value;
                    const nitroDuration = args.find(x => x.name === "duration")?.value || "1 month";
                    const content = createNitroMessage(gifterId, nitroDuration);
                    dispatchFakeMessage(channelId, {
                        type: MessageType.DEFAULT,
                        author: {
                            id: DISCORD_SYSTEM_USER_ID,
                            username: "Discord",
                            avatar: "28174a34e77bb5e5310ced9f95cb480b",
                            discriminator: "0000",
                            public_flags: 0,
                            bot: true,
                            flags: 0
                        },
                        content: "✅ Nitro gift spoofed!",
                        embeds: [],
                        components: []
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ Nitro gift spoofed!"
                    });
                }
                catch (error) {
                    console.error("Nitro spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofboost",
            description: "Spoof a server boost notification",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    name: "booster",
                    description: "User who boosted",
                    required: true
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const boosterId = args.find(x => x.name === "booster")?.value;
                    dispatchFakeMessage(channelId, {
                        type: MessageType.GUILD_BOOST,
                        author: {
                            id: DISCORD_SYSTEM_USER_ID,
                            username: "Discord",
                            avatar: "28174a34e77bb5e5310ced9f95cb480b",
                            discriminator: "0000",
                            public_flags: 0,
                            bot: true,
                            flags: 0
                        },
                        content: "✅ Server boost spoofed!",
                        embeds: []
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ Server boost spoofed!"
                    });
                }
                catch (error) {
                    console.error("Boost spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofclyde",
            description: "Spoof a message from Clyde (Discord's bot)",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "message",
                    description: "Message content from Clyde",
                    required: true
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const message = args.find(x => x.name === "message")?.value;
                    dispatchFakeMessage(channelId, {
                        type: MessageType.DEFAULT,
                        author: {
                            id: CLYDE_USER_ID,
                            username: "Clyde",
                            avatar: null,
                            discriminator: "0000",
                            public_flags: 1 << 16,
                            bot: true,
                            flags: 0
                        },
                        content: "✅ Clyde message spoofed!",
                        embeds: []
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ Clyde message spoofed!"
                    });
                }
                catch (error) {
                    console.error("Clyde spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofjoin",
            description: "Spoof a user join notification",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    name: "user",
                    description: "User who joined",
                    required: true
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                },
                {
                    type: 5 /* ApplicationCommandOptionType.BOOLEAN */,
                    name: "show_welcome",
                    description: "Show welcome message",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const userId = args.find(x => x.name === "user")?.value;
                    const showWelcome = Boolean(args.find(x => x.name === "show_welcome")?.value) || false;
                    const user = UserStore.getUser(userId);
                    const username = user ? `<@${user.id}>` : "Unknown User";
                    dispatchFakeMessage(channelId, {
                        type: MessageType.USER_JOIN,
                        author: {
                            id: DISCORD_SYSTEM_USER_ID,
                            username: "Discord",
                            avatar: "28174a34e77bb5e5310ced9f95cb480b",
                            discriminator: "0000",
                            public_flags: 0,
                            bot: true,
                            flags: 0
                        },
                        content: showWelcome
                            ? `🎉 Welcome ${username} to the server! 🎉\nPlease read the rules and enjoy your stay!`
                            : `${username} joined the server.`
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ Join notification spoofed!"
                    });
                }
                catch (error) {
                    console.error("Join spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofpin",
            description: "Spoof a message pin notification",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    name: "user",
                    description: "User who pinned",
                    required: true
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                },
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "pinned_message",
                    description: "Content of pinned message",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const userId = args.find(x => x.name === "user")?.value;
                    const pinnedContent = args.find(x => x.name === "pinned_message")?.value || "Check this out!";
                    const user = UserStore.getUser(userId);
                    const username = user ? `<@${user.id}>` : "Someone";
                    dispatchFakeMessage(channelId, {
                        type: MessageType.CHANNEL_PINNED_MESSAGE,
                        author: {
                            id: DISCORD_SYSTEM_USER_ID,
                            username: "Discord",
                            avatar: "28174a34e77bb5e5310ced9f95cb480b",
                            discriminator: "0000",
                            public_flags: 0,
                            bot: true,
                            flags: 0
                        },
                        content: `${username} pinned a message to this channel. See all the pins.`
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ Pin notification spoofed!"
                    });
                }
                catch (error) {
                    console.error("Pin spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofcall",
            description: "Spoof a call start/end notification",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    name: "user",
                    description: "User who started/ended the call",
                    required: true
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                },
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "action",
                    description: "Call action",
                    required: true,
                    choices: [
                        { label: "Start Call", name: "Start Call", value: "start" },
                        { label: "End Call", name: "End Call", value: "end" }
                    ]
                },
                {
                    type: 4 /* ApplicationCommandOptionType.INTEGER */,
                    name: "duration",
                    description: "Call duration in minutes (for end)",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const userId = args.find(x => x.name === "user")?.value;
                    const action = args.find(x => x.name === "action")?.value;
                    const callDuration = Number(args.find(x => x.name === "duration")?.value) || 0;
                    const user = UserStore.getUser(userId);
                    const username = user ? `<@${user.id}>` : "Someone";
                    const content = action === "start"
                        ? `${username} started a call. Join here!`
                        : `${username} ended the call${callDuration ? ` (Duration: ${callDuration} minutes)` : ""}.`;
                    dispatchFakeMessage(channelId, {
                        type: MessageType.CALL,
                        author: {
                            id: DISCORD_SYSTEM_USER_ID,
                            username: "Discord",
                            avatar: "28174a34e77bb5e5310ced9f95cb480b",
                            discriminator: "0000",
                            public_flags: 0,
                            bot: true,
                            flags: 0
                        },
                        content: content,
                        components: action === "start" ? [
                            {
                                type: 1,
                                components: [
                                    {
                                        type: 2,
                                        style: 1,
                                        label: "Join Call",
                                        custom_id: "join_call_button"
                                    }
                                ]
                            }
                        ] : []
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ Call notification spoofed!"
                    });
                }
                catch (error) {
                    console.error("Call spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofautomod",
            description: "Spoof an AutoMod action notification",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "rule",
                    description: "AutoMod rule that was triggered",
                    required: true
                },
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "action",
                    description: "Action taken",
                    required: true,
                    choices: [
                        { label: "Block Message", name: "Block Message", value: "block" },
                        { label: "Send Alert", name: "Send Alert", value: "alert" },
                        { label: "Timeout User", name: "Timeout User", value: "timeout" }
                    ]
                },
                {
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    name: "user",
                    description: "User who triggered it",
                    required: false
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const rule = args.find(x => x.name === "rule")?.value;
                    const action = args.find(x => x.name === "action")?.value;
                    const userId = args.find(x => x.name === "user")?.value;
                    const user = userId ? UserStore.getUser(userId) : null;
                    const actionText = {
                        block: "Message blocked",
                        alert: "Alert sent to moderators",
                        timeout: "User timed out"
                    }[action] || action;
                    dispatchFakeMessage(channelId, {
                        type: MessageType.AUTO_MODERATION_ACTION,
                        author: {
                            id: DISCORD_SYSTEM_USER_ID,
                            username: "Discord AutoMod",
                            avatar: "28174a34e77bb5e5310ced9f95cb480b",
                            discriminator: "0000",
                            public_flags: 0,
                            bot: true,
                            flags: 0
                        },
                        content: "✅ AutoMod action spoofed!",
                        embeds: []
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ AutoMod notification spoofed!"
                    });
                }
                catch (error) {
                    console.error("AutoMod spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofsystem",
            description: "Spoof an official Discord system message",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "title",
                    description: "Title of the system message",
                    required: true
                },
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "message",
                    description: "System message content",
                    required: true
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const title = args.find(x => x.name === "title")?.value;
                    const message = args.find(x => x.name === "message")?.value;
                    dispatchFakeMessage(channelId, {
                        type: MessageType.DEFAULT,
                        author: {
                            id: DISCORD_SYSTEM_USER_ID,
                            username: "Discord",
                            avatar: "28174a34e77bb5e5310ced9f95cb480b",
                            discriminator: "0000",
                            public_flags: 0,
                            bot: true,
                            flags: 0
                        },
                        content: "✅ System message spoofed!",
                        embeds: []
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ System message spoofed!"
                    });
                }
                catch (error) {
                    console.error("System spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofpurchase",
            description: "Spoof a purchase notification",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    name: "user",
                    description: "User who made purchase",
                    required: true
                },
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "item",
                    description: "Item purchased",
                    required: true
                },
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "price",
                    description: "Price (e.g., $9.99)",
                    required: true
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const userId = args.find(x => x.name === "user")?.value;
                    const item = args.find(x => x.name === "item")?.value;
                    const price = args.find(x => x.name === "price")?.value;
                    const user = UserStore.getUser(userId);
                    dispatchFakeMessage(channelId, {
                        type: MessageType.PURCHASE_NOTIFICATION,
                        author: {
                            id: DISCORD_SYSTEM_USER_ID,
                            username: "Discord Shop",
                            avatar: "28174a34e77bb5e5310ced9f95cb480b",
                            discriminator: "0000",
                            public_flags: 0,
                            bot: true,
                            flags: 0
                        },
                        content: "✅ Purchase spoofed!",
                        embeds: []
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ Purchase notification spoofed!"
                    });
                }
                catch (error) {
                    console.error("Purchase spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofvoice",
            description: "Spoof a voice message",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 11 /* ApplicationCommandOptionType.ATTACHMENT */,
                    name: "audio",
                    description: "Audio file to upload as voice message",
                    required: true
                },
                {
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    name: "sender",
                    description: "User who sent the voice message",
                    required: true
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                },
                {
                    type: 4 /* ApplicationCommandOptionType.INTEGER */,
                    name: "duration",
                    description: "Duration of the voice message in seconds",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const audioAttachment = args.find(x => x.name === "audio")?.value;
                    const senderId = args.find(x => x.name === "sender")?.value;
                    const voiceDuration = Number(args.find(x => x.name === "duration")?.value) || 5;
                    const sender = UserStore.getUser(senderId);
                    const attachment = {
                        id: generateSnowflake(),
                        filename: audioAttachment.filename || "voice-message.ogg",
                        size: audioAttachment.size || 1024,
                        url: audioAttachment.url,
                        proxy_url: audioAttachment.proxy_url,
                        content_type: audioAttachment.content_type || "audio/ogg",
                        width: null,
                        height: null,
                        flags: 0,
                        waveform: "AA==",
                        duration_secs: voiceDuration
                    };
                    dispatchFakeMessage(channelId, {
                        type: MessageType.DEFAULT,
                        author: {
                            id: sender.id,
                            username: sender.username,
                            avatar: sender.avatar,
                            discriminator: sender.discriminator,
                            public_flags: sender.publicFlags,
                            bot: false,
                            flags: sender.flags
                        },
                        content: "",
                        attachments: [attachment],
                        flags: 1 << 13
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ Voice message spoofed!"
                    });
                }
                catch (error) {
                    console.error("Voice spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        },
        {
            name: "spoofmedia",
            description: "Spoof a media message with file upload",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [
                {
                    type: 11 /* ApplicationCommandOptionType.ATTACHMENT */,
                    name: "file",
                    description: "File to upload (image, video, etc.)",
                    required: true
                },
                {
                    type: 6 /* ApplicationCommandOptionType.USER */,
                    name: "sender",
                    description: "User who sent the media",
                    required: true
                },
                {
                    type: 3 /* ApplicationCommandOptionType.STRING */,
                    name: "caption",
                    description: "Optional caption for the media",
                    required: false
                },
                {
                    type: 7 /* ApplicationCommandOptionType.CHANNEL */,
                    name: "channel",
                    description: "Channel to send in",
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                try {
                    const channelId = args.find(x => x.name === "channel")?.value ?? ctx.channel.id;
                    const fileAttachment = args.find(x => x.name === "file")?.value;
                    const senderId = args.find(x => x.name === "sender")?.value;
                    const caption = args.find(x => x.name === "caption")?.value || "";
                    const sender = UserStore.getUser(senderId);
                    const attachment = {
                        id: generateSnowflake(),
                        filename: fileAttachment.filename,
                        size: fileAttachment.size,
                        url: fileAttachment.url,
                        proxy_url: fileAttachment.proxy_url,
                        content_type: fileAttachment.content_type,
                        width: fileAttachment.width || null,
                        height: fileAttachment.height || null,
                        flags: 0
                    };
                    dispatchFakeMessage(channelId, {
                        type: MessageType.DEFAULT,
                        author: {
                            id: sender.id,
                            username: sender.username,
                            avatar: sender.avatar,
                            discriminator: sender.discriminator,
                            public_flags: sender.publicFlags,
                            bot: false,
                            flags: sender.flags
                        },
                        content: caption,
                        attachments: [attachment]
                    });
                    sendBotMessage(ctx.channel.id, {
                        content: "✅ Media message spoofed!"
                    });
                }
                catch (error) {
                    console.error("Media spoof error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Error: ${error}`
                    });
                }
            }
        }
    ]
});
