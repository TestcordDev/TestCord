/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { safeFetch } from "@main/utils/safeFetch";
import type { IpcMainInvokeEvent } from "electron";

const ALLOWED_HOSTS = [
    "api.mail.tm",
    "api.mail.gw",
    "www.1secmail.com",
    "api.guerrillamail.com",
    "api.tempmail.lol",
    "tempmail.lol",
    "api.tmailor.com",
    "tmailor.com",
    "dropmail.me",
    "api.dropmail.me",
    "tempmail.plus",
    "api.tempmail.plus",
    "maildrop.cc",
    "api.maildrop.cc",
] as const;

export async function fetchTempMail(
    _event: IpcMainInvokeEvent,
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string; } = {}
) {
    if (typeof url !== "string" || url.length > 2048) throw new Error("Invalid URL");
    if (!url.startsWith("https://")) throw new Error("Only https allowed");

    const method = (options.method ?? "GET").toUpperCase();
    if (!["GET", "POST", "DELETE", "PUT", "PATCH"].includes(method)) throw new Error("Invalid method");

    const headers: Record<string, string> = {};
    if (options.headers) {
        for (const [k, v] of Object.entries(options.headers)) {
            if (typeof k !== "string" || typeof v !== "string") continue;
            if (k.length > 128 || v.length > 8192) continue;
            headers[k] = v;
        }
    }
    // always allow json
    if (!headers["Content-Type"] && options.body) headers["Content-Type"] = "application/json";

    const res = await safeFetch(url, {
        method,
        headers,
        body: options.body,
        allowedHosts: ALLOWED_HOSTS as unknown as string[],
        maxRedirects: 3,
    });

    const text = await res.text().catch(() => "");
    let json: unknown = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }

    return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        text,
        json,
    };
}
