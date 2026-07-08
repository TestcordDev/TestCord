/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";

import { getReidverseKey, reidverseChat } from "./groqManager";

export const REIDVERSE_BASE = "https://reidverse-ai.up.railway.app";

export const REIDVERSE_MODEL_OPTIONS = [
    { label: "Sakana Fugu Ultra", value: "sakana-fugu-ultra", default: true },
    { label: "Sakana Fugu", value: "sakana-fugu" },
    { label: "Sakana Namazu", value: "sakana-namazu" },
    { label: "Claude Opus 4.8", value: "claude-opus-4-8" },
    { label: "Claude Opus 4.7", value: "claude-opus-4-7" },
    { label: "Claude Sonnet 5", value: "claude-sonnet-5" },
    { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
    { label: "GPT-5.5", value: "gpt-5-5" },
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
] as const;

export const PROVIDER_OPTIONS = [
    { label: "Reidverse AI (free)", value: "reidverse" },
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
    model?: string;
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

export function resolveProviderOptions(opts: TestcordChatOptions): { provider: string; model: string; temperature?: number; } {
    const testcord = Settings.plugins.TestcordAI as TestcordAISettings | undefined;
    return {
        provider: "reidverse",
        model: opts.forceModel ?? testcord?.model ?? "sakana-fugu-ultra",
        temperature: opts.temperature ?? testcord?.temperature,
    };
}

export async function testcordChat(opts: TestcordChatOptions): Promise<string> {
    const resolved = resolveProviderOptions(opts);
    const temperature = resolved.temperature ?? 0.7;

    return reidverseChat({
        messages: opts.messages,
        model: resolved.model,
        temperature,
        maxTokens: opts.maxTokens,
    });
}

export function effectiveProviderRequiresGroqKey(_provider?: string): boolean {
    return false;
}

export { getReidverseKey, reidverseChat };
