/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const settings = definePluginSettings({
    apiKey: {
        type: 0 /* OptionType.STRING */,
        description: "API Key.",
        default: "",
        placeholder: "Enter API Key here for your AI endpoint.",
        componentProps: {
            type: "password"
        }
    },
    model: {
        type: 0 /* OptionType.STRING */,
        description: "AI Model to use.",
        default: "google/gemini-3-flash-preview",
        placeholder: "e.g. google/gemini-3-flash-preview, inception/mercury, openai/gpt-5.2-chat, etc."
    },
    systemPrompt: {
        type: 0 /* OptionType.STRING */,
        description: "System Prompt for the AI. Placeholders: {current_user}, {current_time}",
        default: "You are a helpful assistant who answers questions for the user in a concise and short way while using the least amount of words and punctuation.\nCurrent user: {current_user}\nCurrent time: {current_time}",
        placeholder: "Enter system prompt.",
        multiline: true
    },
    maxTokens: {
        type: 1 /* OptionType.NUMBER */,
        description: "Maximum number of tokens in the response.",
        default: 500
    },
    endpoint: {
        type: 0 /* OptionType.STRING */,
        description: "OpenAI Compatible AI Endpoint.",
        default: "https://openrouter.ai/api/v1/chat/completions",
        placeholder: "Enter your OpenAI compatible AI endpoint here."
    },
    context: {
        type: 1 /* OptionType.NUMBER */,
        description: "Number of previous messages to include as context.",
        default: 0
    },
    passMessageAuthorName: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Prepend the author's name to the message content when passing it to the AI. This can help the AI distinguish between different users in a conversation.",
        default: true
    },
    treatSelfAsAssistant: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "When enabled, your own messages will be treated as assistant messages in the context. This causes some models to start generating fanfic.",
        default: false
    },
    mode: {
        type: 4 /* OptionType.SELECT */,
        description: "How should answers be handled?",
        options: [
            { label: "Auto Reply", value: "autoreply" },
            { label: "Replace Chatbar Text", value: "chatbar", default: true },
            { label: "Clyde", value: "bot" }
        ]
    },
    supportImages: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Pass images to the AI for context (if any). This is not supported by all models.",
        default: true
    },
    sendImagesAsBase64: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Send images to the AI as base64.",
        default: false
    }
});
