/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, Constants, RestAPI, SnowflakeUtils, UserStore } from "@webpack/common";

import { HOMELANDER_MODEL_OPTIONS, LOCAL_PROVIDER_OPTIONS, SURF_MODEL_OPTIONS, SWISHAI_MODEL_OPTIONS, testcordChat } from "../TestcordAI/aiProvider";

const settings = definePluginSettings({
    provider: {
        type: OptionType.SELECT,
        description: "AI provider to use for summarization",
        options: [
            ...LOCAL_PROVIDER_OPTIONS,
            { label: "Nvidia NIM", value: "nvidia" },
        ],
        default: "testcord",
    },
    groqModel: {
        type: OptionType.STRING,
        description: "Groq model override",
        default: "llama-3.3-70b-versatile",
        hidden: () => settings.store.provider !== "groq",
    },
    homelanderModel: {
        type: OptionType.SELECT,
        description: "Homelander model",
        options: HOMELANDER_MODEL_OPTIONS,
        default: "openai/gpt-5.5",
        hidden: () => settings.store.provider !== "homelander",
    },
    swishAiModel: {
        type: OptionType.SELECT,
        description: "SwishAI model",
        options: SWISHAI_MODEL_OPTIONS,
        default: "gpt-5.5",
        hidden: () => settings.store.provider !== "swishai",
    },
    surfModel: {
        type: OptionType.SELECT,
        description: "Unlimited Surf model",
        options: SURF_MODEL_OPTIONS,
        default: "gateway-claude-opus-4-7",
        hidden: () => settings.store.provider !== "unlimited-surf",
    },
    nvidiaApiKey: {
        type: OptionType.STRING,
        description: "Nvidia NIM API Key",
        default: "",
        hidden: () => settings.store.provider !== "nvidia",
    },
    nvidiaModel: {
        type: OptionType.STRING,
        description: "Nvidia model",
        default: "meta/llama-3.3-70b-instruct",
        hidden: () => settings.store.provider !== "nvidia",
    },
    temperature: {
        type: OptionType.SLIDER,
        description: "Temperature — 0 = precise, 1 = creative",
        markers: [0, 0.2, 0.5, 0.7, 1.0],
        default: 0.3,
    },
    maxTokens: {
        type: OptionType.NUMBER,
        description: "Max tokens for AI response",
        default: 2000,
    },
    systemPrompt: {
        type: OptionType.STRING,
        description: "System prompt for the AI",
        default: "You are a helpful assistant that summarizes Discord chat conversations. Be concise and factual.",
        multiline: true,
    },
});

async function fetchMessages(
    channelId: string,
    limit: number,
    timeframeHours?: number,
    authorId?: string,
): Promise<Message[]> {
    const messages: Message[] = [];
    let before: string | undefined = undefined;
    const cutoffSnowflake = timeframeHours
        ? SnowflakeUtils.fromTimestamp(Date.now() - timeframeHours * 3600_000)
        : undefined;

    while (messages.length < limit) {
        const batchSize = Math.min(100, limit - messages.length);
        const res = await RestAPI.get({
            url: Constants.Endpoints.MESSAGES(channelId),
            query: { limit: batchSize, ...(before ? { before } : {}) },
            retries: 2,
        }).catch(() => null as any);

        const batch: Message[] = res?.body ?? [];
        if (!batch.length) break;

        for (const msg of batch) {
            if (cutoffSnowflake && msg.id < cutoffSnowflake) return messages;
            if (!authorId || msg.author?.id === authorId) {
                messages.push(msg);
            }
        }

        before = batch[batch.length - 1].id;
        if (batch.length < batchSize) break;
        await sleep(250);
    }

    return messages;
}

function formatMessages(messages: Message[]): string {
    return messages.map(m => {
        const author = m.author?.globalName || m.author?.username || "Unknown";
        const time = new Date(m.timestamp).toLocaleString();
        const content = m.content || "(no text)";
        return `[${time}] ${author}: ${content}`;
    }).join("\n");
}

interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

async function callNvidia(messages: ChatMessage[]): Promise<string> {
    const apiKey = settings.store.nvidiaApiKey;
    if (!apiKey) throw new Error("Nvidia NIM API key not configured in plugin settings.");

    const model = settings.store.nvidiaModel || "meta/llama-3.3-70b-instruct";

    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            temperature: settings.store.temperature,
            max_tokens: settings.store.maxTokens,
            messages,
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Nvidia API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "(empty response)";
}

async function summarize(messages: ChatMessage[]): Promise<string> {
    const { provider } = settings.store;
    if (provider === "nvidia") return callNvidia(messages);

    return testcordChat({
        provider,
        groqModel: settings.store.groqModel,
        homelanderModel: settings.store.homelanderModel,
        swishAiModel: settings.store.swishAiModel,
        surfModel: settings.store.surfModel,
        messages,
        temperature: settings.store.temperature,
        maxTokens: settings.store.maxTokens,
    });
}

function buildSummaryPrompt(
    formattedMessages: string,
    style: string,
    channelName: string,
    personName?: string,
): ChatMessage[] {
    let styleInstruction: string;
    switch (style) {
        case "short":
            styleInstruction = "Provide a brief 2-3 sentence summary highlighting only the most important points.";
            break;
        case "exact":
            styleInstruction = "Provide a detailed, thorough summary covering all topics discussed, key decisions, notable quotes, and outcomes. Be comprehensive.";
            break;
        case "mid":
        default:
            styleInstruction = "Provide a concise but complete summary covering the main topics, decisions, and outcomes.";
            break;
    }

    const filterNote = personName
        ? `Only messages from ${personName} are included.`
        : "All messages from all users are included.";

    return [
        {
            role: "system",
            content: settings.store.systemPrompt,
        },
        {
            role: "user",
            content: `Summarize the following Discord chat from #${channelName}.

${filterNote}
Summary style: ${styleInstruction}

Chat log:
${formattedMessages}

Provide your summary now.`,
        },
    ];
}

export default definePlugin({
    name: "SummarizeAI",
    description: "Summarize Discord channel conversations using AI",
    dependencies: ["CommandsAPI"],
    tags: ["Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    commands: [
        {
            name: "summary",
            description: "Summarize a channel's recent messages using AI",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "channel",
                    description: "Channel to summarize",
                    type: ApplicationCommandOptionType.CHANNEL,
                    required: true,
                },
                {
                    name: "style",
                    description: "Summary detail level",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                    choices: [
                        { name: "Short", label: "Short", value: "short" },
                        { name: "Medium", label: "Medium", value: "mid" },
                        { name: "Detailed", label: "Detailed", value: "exact" },
                    ],
                },
                {
                    name: "person",
                    description: "Only summarize messages from this user",
                    type: ApplicationCommandOptionType.USER,
                    required: false,
                },
                {
                    name: "timeframe",
                    description: "Hours back to look (e.g. 1, 2, 6, 12, 24)",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: false,
                },
                {
                    name: "messages",
                    description: "Max messages to fetch (default 100, max 500)",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: false,
                },
            ],
            execute: async (opts, ctx) => {
                const channelId: string = findOption(opts, "channel", ctx.channel?.id);
                const channel = ChannelStore.getChannel(channelId);
                if (!channel) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid channel specified." });
                    return;
                }

                const channelName = channel.name || channel.id;
                const style: string = findOption(opts, "style", "mid");
                const personId: string = findOption(opts, "person", "");
                const person = personId ? UserStore.getUser(personId) : null;
                const timeframe: number | undefined = findOption(opts, "timeframe", undefined);
                const msgLimit = Math.min(Math.max(findOption(opts, "messages", 100) || 100, 10), 500);

                sendBotMessage(ctx.channel.id, {
                    content: `> Fetching messages from #${channelName}...`,
                });

                try {
                    const messages = await fetchMessages(
                        channelId,
                        msgLimit,
                        timeframe,
                        personId || undefined,
                    );

                    if (messages.length === 0) {
                        sendBotMessage(ctx.channel.id, {
                            content: `> No messages found in #${channelName}${timeframe ? ` from the last ${timeframe}h` : ""}${person ? ` from ${person.username}` : ""}.`,
                        });
                        return;
                    }

                    sendBotMessage(ctx.channel.id, {
                        content: `> Found ${messages.length} messages. Summarizing with ${settings.store.provider}...`,
                    });

                    const formatted = formatMessages(messages);
                    const personName = person?.globalName || person?.username;
                    const prompt = buildSummaryPrompt(formatted, style, channelName, personName);
                    const summary = await summarize(prompt);

                    sendBotMessage(ctx.channel.id, {
                        content: `**Summary of #${channelName}** (${messages.length} messages${timeframe ? `, last ${timeframe}h` : ""}${person ? `, from ${personName}` : ""}):\n\n${summary}`,
                    });
                } catch (err: any) {
                    sendBotMessage(ctx.channel.id, {
                        content: `> Error: ${err?.message || "Failed to generate summary"}`,
                    });
                }
            },
        },
    ],
});
