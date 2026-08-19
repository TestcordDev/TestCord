/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { isOpenCodeFreeModel, isRecord, OPENCODE_ZEN_CHAT_COMPLETIONS_ENDPOINT, OPENCODE_ZEN_MODELS_ENDPOINT } from "./helpers";
const MAX_PAYLOAD_BYTES = 256_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 30_000;
const OPENCODE_ZEN_ALLOWED_ORIGIN = "https://opencode.ai";
const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;
const activeTranslateControllers = new Map();
const cancelledTranslateRequests = new Set();
async function readCappedResponse(response) {
    const reader = response.body?.getReader();
    if (!reader) {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
            throw new Error("Response too large.");
        return text;
    }
    const chunks = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (!value)
            continue;
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error("Response too large.");
        }
        chunks.push(value);
    }
    const body = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
}
function scrubFetchError(error) {
    if (error instanceof Error && error.name === "AbortError")
        return "Request timed out.";
    if (error instanceof Error && error.message === "Response too large.")
        return error.message;
    return "Request failed.";
}
function getAllowedOpenCodeUrl(url) {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.origin === OPENCODE_ZEN_ALLOWED_ORIGIN)
            return parsedUrl.toString();
    }
    catch {
        return null;
    }
    return null;
}
function isValidRequestId(requestId) {
    return REQUEST_ID_PATTERN.test(requestId);
}
function isValidChatMessage(value, role) {
    if (!isRecord(value) || value.role !== role || typeof value.content !== "string")
        return false;
    for (const key of Object.keys(value)) {
        if (key !== "role" && key !== "content")
            return false;
    }
    return true;
}
function isValidTranslatePayload(payload) {
    let parsed;
    try {
        parsed = JSON.parse(payload);
    }
    catch {
        return false;
    }
    if (!isRecord(parsed))
        return false;
    for (const key of Object.keys(parsed)) {
        if (key !== "model" && key !== "messages" && key !== "temperature" && key !== "reasoning_effort")
            return false;
    }
    const { model, messages, temperature, reasoning_effort } = parsed;
    if (typeof model !== "string" || !isOpenCodeFreeModel(model))
        return false;
    if (!Array.isArray(messages) || messages.length !== 2)
        return false;
    if (!isValidChatMessage(messages[0], "system") || !isValidChatMessage(messages[1], "user"))
        return false;
    if ("temperature" in parsed && (typeof temperature !== "number" || temperature < 0 || temperature > 2))
        return false;
    if ("reasoning_effort" in parsed && reasoning_effort !== "none")
        return false;
    return true;
}
async function makeOpenCodeRequest(url, init, controller = new AbortController()) {
    const requestUrl = getAllowedOpenCodeUrl(url);
    if (!requestUrl)
        return { ok: false, status: 0, body: "", error: "Invalid endpoint." };
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(requestUrl, {
            ...init,
            redirect: "error",
            signal: controller.signal,
        });
        const body = await readCappedResponse(response);
        return { ok: response.ok, status: response.status, body };
    }
    catch (error) {
        return { ok: false, status: 0, body: "", error: scrubFetchError(error) };
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function makeModelsRequest(_) {
    return await makeOpenCodeRequest(OPENCODE_ZEN_MODELS_ENDPOINT, { method: "GET" });
}
export async function cancelTranslateRequest(_, requestId) {
    if (typeof requestId !== "string" || !isValidRequestId(requestId))
        return false;
    const controller = activeTranslateControllers.get(requestId);
    if (!controller)
        return false;
    cancelledTranslateRequests.add(requestId);
    controller.abort();
    return true;
}
export async function makeTranslateRequest(_, requestId, payload) {
    if (typeof requestId !== "string" || !isValidRequestId(requestId))
        return { ok: false, status: 0, body: "", error: "Invalid request." };
    if (activeTranslateControllers.has(requestId))
        return { ok: false, status: 0, body: "", error: "Duplicate request." };
    if (typeof payload !== "string" || !payload || new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES || !isValidTranslatePayload(payload)) {
        return { ok: false, status: 0, body: "", error: "Invalid request body." };
    }
    const controller = new AbortController();
    activeTranslateControllers.set(requestId, controller);
    try {
        const response = await makeOpenCodeRequest(OPENCODE_ZEN_CHAT_COMPLETIONS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
        }, controller);
        if (cancelledTranslateRequests.has(requestId))
            return { ok: false, status: 0, body: "", error: "Request cancelled." };
        return response;
    }
    finally {
        activeTranslateControllers.delete(requestId);
        cancelledTranslateRequests.delete(requestId);
    }
}
