/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
const DS_API_KEY = "testcord-osint-api-key";
const DS_API_URL = "testcord-osint-api-url";
const DS_MODEL = "testcord-osint-model";
// ── Native IPC fetch ────────────────────────────────────────────────────────
let _nativeFetch = null;
let _nativeCordCat = null;
function getNativeFetch() {
    if (_nativeFetch)
        return _nativeFetch;
    try {
        const vn = globalThis.VencordNative;
        if (vn?.pluginHelpers?.TestcordOSINT?.osintFetch) {
            _nativeFetch = vn.pluginHelpers.TestcordOSINT.osintFetch;
            return _nativeFetch;
        }
    }
    catch { /* renderer-only mode */ }
    return null;
}
function getNativeCordCat() {
    if (_nativeCordCat)
        return _nativeCordCat;
    try {
        const vn = globalThis.VencordNative;
        if (vn?.pluginHelpers?.TestcordOSINT?.fetchCordCat) {
            _nativeCordCat = vn.pluginHelpers.TestcordOSINT.fetchCordCat;
            return _nativeCordCat;
        }
    }
    catch { /* renderer-only mode */ }
    return null;
}
export async function osintFetch(url, method, headers, body) {
    const native = getNativeFetch();
    if (native) {
        const res = await native(url, method, headers, body);
        if (res.error)
            throw new Error(res.error);
        return new Response(res.body, {
            status: res.status,
            headers: res.headers ?? {},
        });
    }
    return fetch(url, { method, headers, body });
}
function isRecord(v) {
    return typeof v === "object" && v !== null;
}
export async function fetchCordCatData(parsedId) {
    const native = getNativeCordCat();
    if (!native)
        return null;
    const res = await native(parsedId);
    if (!res.ok || !res.body)
        return null;
    try {
        const payload = JSON.parse(res.body);
        if (!isRecord(payload))
            return null;
        const statements = Array.isArray(payload.statements) ? payload.statements : [];
        const actions = statements
            .filter((s) => isRecord(s) && typeof s.category === "string")
            .sort((a, b) => {
            const da = a.application_date ?? "";
            const db = b.application_date ?? "";
            return String(db).localeCompare(String(da));
        });
        const breachObj = isRecord(payload.breach) ? payload.breach : null;
        const breachSuccess = breachObj?.success === true;
        let breaches = [];
        if (breachSuccess) {
            const breachData = isRecord(breachObj.data) ? breachObj.data : null;
            const results = Array.isArray(breachData?.results) ? breachData.results : [];
            breaches = results.filter((r) => isRecord(r) && typeof r.source === "string");
        }
        return { actions, breaches };
    }
    catch {
        return null;
    }
}
// ── DataStore read/write ────────────────────────────────────────────────────
export async function getApiKey() {
    const key = await DataStore.get(DS_API_KEY);
    return key?.trim() ?? "";
}
export async function setApiKey(key) {
    await DataStore.set(DS_API_KEY, key.trim());
}
export async function getApiUrl() {
    const url = await DataStore.get(DS_API_URL);
    return url?.trim() ?? "";
}
export async function setApiUrl(url) {
    await DataStore.set(DS_API_URL, url.trim());
}
export async function getModel() {
    const model = await DataStore.get(DS_MODEL);
    return model?.trim() ?? "";
}
export async function setModel(model) {
    await DataStore.set(DS_MODEL, model.trim());
}
// ── Provider URL resolution ─────────────────────────────────────────────────
export function resolveApiUrl(provider, customUrl) {
    if (provider === "custom" || provider === "localhost") {
        const base = customUrl?.trim() || "http://localhost:11434";
        return `${base.replace(/\/+$/, "")}/v1/chat/completions`;
    }
    switch (provider) {
        case "openai":
            return "https://api.openai.com/v1/chat/completions";
        case "groq":
            return "https://api.groq.com/openai/v1/chat/completions";
        case "anthropic":
            return "https://api.anthropic.com/v1/messages";
        case "together":
            return "https://api.together.xyz/v1/chat/completions";
        case "openrouter":
            return "https://openrouter.ai/api/v1/chat/completions";
        default:
            return "https://api.groq.com/openai/v1/chat/completions";
    }
}
export async function callAI(opts) {
    const { messages, provider, temperature = 0.3, maxTokens = 4000, customUrl } = opts;
    const apiKey = await getApiKey();
    const modelOverride = await getModel();
    const model = opts.model || modelOverride || getDefaultModel(provider);
    const url = resolveApiUrl(provider, customUrl);
    if (provider === "anthropic") {
        return callAnthropic(url, apiKey, messages, model, temperature, maxTokens);
    }
    return callOpenAICompatible(url, apiKey, messages, model, temperature, maxTokens);
}
function getDefaultModel(provider) {
    switch (provider) {
        case "groq": return "llama-3.3-70b-versatile";
        case "openai": return "gpt-4o";
        case "anthropic": return "claude-sonnet-4-20250514";
        case "together": return "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo";
        case "openrouter": return "meta-llama/llama-3.3-70b-instruct";
        case "localhost": return "llama3";
        case "custom": return "default";
        default: return "llama-3.3-70b-versatile";
    }
}
async function callOpenAICompatible(url, apiKey, messages, model, temperature, maxTokens) {
    const headers = {
        "Content-Type": "application/json",
    };
    if (apiKey)
        headers.Authorization = `Bearer ${apiKey}`;
    const res = await osintFetch(url, "POST", headers, JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
    }));
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`AI API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "(empty response)";
}
async function callAnthropic(url, apiKey, messages, model, temperature, maxTokens) {
    const systemMsg = messages.find(m => m.role === "system");
    const userMsgs = messages.filter(m => m.role !== "system");
    const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
    };
    const res = await osintFetch(url, "POST", headers, JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        system: systemMsg?.content ?? "",
        messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
    }));
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text?.trim() ?? "(empty response)";
}
