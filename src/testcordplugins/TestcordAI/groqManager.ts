/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * groqManager.ts — Shared API key + fetch manager
 *
 * Features:
 * - Reidverse AI: auto-register to get a free API key (stored in DataStore)
 * - groqFetch: native IPC fetch (bypasses CORS in Electron), falls back to fetch
 * - reidverseChat: OpenAI-compatible chat completions via Reidverse AI
 * - Legacy Groq key storage (kept for voiceDictation Whisper transcription)
 */

import { DataStore } from "@api/index";
import { sleep } from "@utils/misc";

import type { NativeGroqResponse } from "./native";

const REIDVERSE_BASE = "https://reidverse-ai.up.railway.app";

// ── Native IPC fetch (bypasses CORS in Electron) ─────────────────────────────

let _nativeGroqFetch: ((url: string, method: string, headers: Record<string, string>, body?: string) => Promise<NativeGroqResponse>) | null = null;

function getNativeFetch() {
    if (_nativeGroqFetch) return _nativeGroqFetch;
    try {
        const vn = (globalThis as any).VencordNative;
        if (vn?.pluginHelpers?.TestcordAI?.groqFetch) {
            _nativeGroqFetch = vn.pluginHelpers.TestcordAI.groqFetch;
            return _nativeGroqFetch;
        }
    } catch { /* renderer-only mode */ }
    return null;
}

export async function groqFetch(url: string, method: string, headers: Record<string, string>, body?: string): Promise<Response> {
    const native = getNativeFetch();
    if (native) {
        const res = await native(url, method, headers, body);
        if (res.error) throw new Error(res.error);
        return new Response(res.body, {
            status: res.status,
            headers: res.headers ?? {},
        });
    }
    return fetch(url, { method, headers, body });
}

// ── DataStore Keys ─────────────────────────────────────────────────────────────

const DS_REIDVERSE_KEY = "reidverse-ai-api-key";
const DS_GROQ_KEY = "groq-shared-api-key";

// ── Reidverse AI key management ───────────────────────────────────────────────

let _reidverseKeyPromise: Promise<string> | null = null;

export async function getReidverseKey(): Promise<string> {
    const key = await DataStore.get(DS_REIDVERSE_KEY) as string | null;
    if (key?.trim()) return key.trim();
    return registerReidverse();
}

async function registerReidverse(): Promise<string> {
    if (_reidverseKeyPromise) return _reidverseKeyPromise;
    _reidverseKeyPromise = _doRegister();
    try {
        return await _reidverseKeyPromise;
    } finally {
        _reidverseKeyPromise = null;
    }
}

async function _doRegister(): Promise<string> {
    const res = await groqFetch(`${REIDVERSE_BASE}/register`, "POST", {
        "Content-Type": "application/json",
    });
    if (!res.ok) throw new Error(`Reidverse register failed: ${res.status}`);
    const data = await res.json();
    const key = data?.key;
    if (typeof key !== "string" || !key.trim()) throw new Error("Reidverse register returned no key");
    await DataStore.set(DS_REIDVERSE_KEY, key.trim());
    return key.trim();
}

// ── Legacy Groq key (kept for voiceDictation Whisper) ─────────────────────────

let _settingsFallback: (() => string) | null = null;
export function registerSettingsFallback(fn: () => string) {
    _settingsFallback = fn;
}

export async function getGroqKey(): Promise<string> {
    const key = await DataStore.get(DS_GROQ_KEY) as string | null;
    if (key?.trim()) return key.trim();
    if (_settingsFallback) {
        const fallback = _settingsFallback();
        if (fallback) return fallback;
    }
    return "";
}

export async function setGroqKey(key: string): Promise<void> {
    await DataStore.set(DS_GROQ_KEY, key.trim());
}

// ── Lightweight queue ─────────────────────────────────────────────────────────

let queue = Promise.resolve();
const MIN_DELAY_MS = 100;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(() => fn());
    queue = result.then(
        () => sleep(MIN_DELAY_MS),
        () => sleep(MIN_DELAY_MS),
    );
    return result;
}

// ── Reidverse AI chat ─────────────────────────────────────────────────────────

export interface ReidverseChatMessage {
    role: "system" | "user" | "assistant";
    content: string | any[];
}

export interface ReidverseChatOptions {
    messages: ReidverseChatMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
}

export async function reidverseChat(opts: ReidverseChatOptions): Promise<string> {
    return enqueue(() => _reidverseChat(opts));
}

async function _reidverseChat(opts: ReidverseChatOptions, attempt = 0): Promise<string> {
    const { messages, model = "sakana-fugu-ultra", temperature = 0.7, maxTokens = 1000, maxRetries = 2 } = opts;

    let key = await getReidverseKey();

    const res = await groqFetch(`${REIDVERSE_BASE}/v1/chat/completions`, "POST", {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
    }, JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
    }));

    if (res.status === 401 && attempt < maxRetries) {
        await DataStore.del(DS_REIDVERSE_KEY);
        key = await registerReidverse();
        return _reidverseChat(opts, attempt + 1);
    }

    if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "5", 10);
        await sleep((isNaN(retryAfter) ? 5 : retryAfter) * 1000);
        return _reidverseChat(opts, attempt + 1);
    }

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Reidverse API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "(empty response)";
}

// ── Groq chat (real Groq API, requires user API key) ──────────────────────────

export interface GroqChatMessage {
    role: "system" | "user" | "assistant";
    content: string | any[];
}

export interface GroqCallOptions {
    messages: GroqChatMessage[];
    apiKey: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function groqChat(opts: GroqCallOptions): Promise<string> {
    const { messages, apiKey, model = "llama-3.3-70b-versatile", temperature = 0.7, maxTokens = 1000 } = opts;
    const key = apiKey.trim();
    if (!key) throw new Error("Missing Groq API key. Add one in TestcordAI settings.");

    const res = await groqFetch(GROQ_API_URL, "POST", {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
    }, JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
    }));

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Groq API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "(empty response)";
}
