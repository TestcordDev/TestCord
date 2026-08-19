/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { safeFetch } from "@main/utils/safeFetch";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const ALLOWED_METHODS = new Set(["GET", "POST"]);
async function readCappedText(response) {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)
        throw new Error("Response was too large.");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
        throw new Error("Response was too large.");
    return text;
}
export async function osintFetch(_, url, method, headers, body) {
    try {
        const normalizedMethod = method.toUpperCase();
        if (!ALLOWED_METHODS.has(normalizedMethod))
            throw new Error("HTTP method is not allowed.");
        const response = await safeFetch(url, {
            method: normalizedMethod,
            headers: {
                "Content-Type": "application/json",
                ...headers,
            },
            body,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        return {
            status: response.status,
            body: await readCappedText(response),
            headers: Object.fromEntries(response.headers.entries()),
        };
    }
    catch (error) {
        return {
            status: -1,
            body: "",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
export async function fetchCordCat(_, parsedId) {
    try {
        const response = await fetch(`https://api.cord.cat/api/v2/query/${encodeURIComponent(parsedId)}`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
        });
        return {
            ok: true,
            status: response.status,
            body: await readCappedText(response),
        };
    }
    catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
