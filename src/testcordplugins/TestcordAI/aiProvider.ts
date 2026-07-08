/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";

import { getReidverseKey, groqChat, reidverseChat } from "./groqManager";

export const REIDVERSE_BASE = "https://reidverse-ai.up.railway.app";

export const REIDVERSE_MODEL_OPTIONS = [
    { label: "Sakana Fugu Ultra", value: "sakana-fugu-ultra", default: true },
    { label: "Sakana Fugu", value: "sakana-fugu" },
    { label: "Sakana Namazu", value: "sakana-namazu" },
    { label: "Claude Sonnet 5", value: "claude-sonnet-5" },
    { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
    { label: "GPT-5.1", value: "gpt-5-1" },
    { label: "Gemini 3.1 Pro", value: "gemini-3-1-pro" },
    { label: "Gemini 3 Flash", value: "gemini-3-flash" },
    { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
    { label: "Grok 4.3", value: "grok-4-3" },
    { label: "Grok 4", value: "grok-4" },
    { label: "DeepSeek V4 Pro", value: "deepseek-v4-pro" },
    { label: "DeepSeek V4 Flash", value: "deepseek-v4-flash" },
    { label: "Qwen 3 Max", value: "qwen-3-max" },
    { label: "Qwen 3.5", value: "qwen-3-5" },
    { label: "Kimi K2.6", value: "kimi-k2-6" },
    { label: "Kimi K2", value: "deepinfra-kimi-k2" },
    { label: "Nemotron 3 Ultra 550B", value: "nemotron-3-ultra-550b" },
    { label: "Nemotron 3 Super 120B", value: "nemotron-3-super-120b" },
    { label: "GPT-OSS 120B", value: "gpt-oss-120b" },
    { label: "Cerebras GPT-OSS 120B", value: "cerebras-gpt-oss-120b" },
    { label: "Cerebras GLM 4.7", value: "cerebras-glm-4-7" },
    { label: "Cerebras Gemma 4 31B", value: "cerebras-gemma-4-31b" },
    { label: "Cohere Command A", value: "cohere-command-a" },
    { label: "Groq Llama 3.3 70B", value: "groq-llama-3-3-70b" },
    { label: "Mistral Small", value: "mistral-small" },
    { label: "Zhipu GLM 4.5 Flash", value: "zhipu-glm-4-5-flash" },
] as const;

export const GROQ_MODEL_OPTIONS = [
    { label: "Llama 3.3 70B Versatile", value: "llama-3.3-70b-versatile", default: true },
    { label: "Llama 3.1 8B Instant", value: "llama-3.1-8b-instant" },
    { label: "Gemma 2 9B", value: "gemma2-9b-it" },
] as const;

export const PROVIDER_OPTIONS = [
    { label: "Reidverse AI (free)", value: "reidverse" },
    { label: "Groq (API key)", value: "groq" },
] as const;

export const LOCAL_PROVIDER_OPTIONS = [
    { label: "Use TestcordAI settings", value: "testcord" },
    ...PROVIDER_OPTIONS,
] as const;

export const HOMELANDER_MODEL_OPTIONS = REIDVERSE_MODEL_OPTIONS;
export const SURF_MODEL_OPTIONS = REIDVERSE_MODEL_OPTIONS;
export const SWISHAI_MODEL_OPTIONS = REIDVERSE_MODEL_OPTIONS;

export type Provider = typeof PROVIDER_OPTIONS[number]["value"];
export type LocalProvider = typeof LOCAL_PROVIDER_OPTIONS[number]["value"];

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string | any[];
}

export interface TestcordChatOptions {
    messages: ChatMessage[];
    provider?: LocalProvider | string;
    groqModel?: string;
    homelanderModel?: string;
    swishAiModel?: string;
    surfModel?: string;
    temperature?: number;
    maxTokens?: number;
    forceModel?: string;
}

interface TestcordAISettings {
    provider?: Provider;
    model?: string;
    groqModel?: string;
    groqApiKey?: string;
    temperature?: number;
}

export async function readProviderResponse(res: Response): Promise<string> {
    const text = await res.text();
    try {
        const data = JSON.parse(text);
        return data.choices?.[0]?.message?.content?.trim()
            ?? data.response
            ?? data.content
            ?? data.message
            ?? text;
    } catch {
        return text || "(empty response)";
    }
}

export function resolveProviderOptions(opts: TestcordChatOptions): { provider: string; model: string; groqModel: string; groqApiKey: string; temperature?: number; } {
    const testcord = Settings.plugins.TestcordAI as TestcordAISettings | undefined;
    const useTestcord = !opts.provider || opts.provider === "testcord";
    const provider = useTestcord ? testcord?.provider ?? "reidverse" : opts.provider ?? "reidverse";
    return {
        provider,
        model: opts.forceModel ?? testcord?.model ?? "sakana-fugu-ultra",
        groqModel: useTestcord ? testcord?.groqModel ?? "llama-3.3-70b-versatile" : opts.groqModel ?? "llama-3.3-70b-versatile",
        groqApiKey: useTestcord ? testcord?.groqApiKey ?? "" : "",
        temperature: opts.temperature ?? (useTestcord ? testcord?.temperature : undefined),
    };
}

export async function testcordChat(opts: TestcordChatOptions): Promise<string> {
    const resolved = resolveProviderOptions(opts);
    const temperature = resolved.temperature ?? 0.7;

    if (resolved.provider === "groq") {
        return groqChat({
            messages: opts.messages,
            apiKey: resolved.groqApiKey,
            model: opts.forceModel ?? resolved.groqModel,
            temperature,
            maxTokens: opts.maxTokens,
        });
    }

    return reidverseChat({
        messages: opts.messages,
        model: resolved.model,
        temperature,
        maxTokens: opts.maxTokens,
    });
}

export function effectiveProviderRequiresGroqKey(provider?: string): boolean {
    return resolveProviderOptions({ messages: [], provider }).provider === "groq";
}

export { getReidverseKey, reidverseChat };
