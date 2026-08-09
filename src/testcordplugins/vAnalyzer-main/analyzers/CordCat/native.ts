/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

// https://cord.cat/docs

const MAX_CACHE = 4;
const resultCache = new Map<string, { data: any; ts: number; }>();

function evictOldest() {
    if (resultCache.size >= MAX_CACHE) {
        const oldestKey = resultCache.keys().next().value;
        if (oldestKey) resultCache.delete(oldestKey);
    }
}

export async function queryCordCat(_: IpcMainInvokeEvent, userId: string, apiKey?: string): Promise<{ status: number; data: any; }> {
    const cached = resultCache.get(userId);
    if (cached) {
        // move to end
        resultCache.delete(userId);
        resultCache.set(userId, cached);
        return { status: 200, data: cached.data };
    }

    try {

        const res = await fetch(`https://api.cord.cat/api/v2/query/${userId}`, {
            headers: {
                "accept": "application/json",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "authorization": apiKey ? `Bearer ${apiKey}` : "",
            }
        });

        if (!res.ok) {
            return { status: res.status, data: await res.text() };
        }

        const data = await res.json();
        evictOldest();
        resultCache.set(userId, { data, ts: Date.now() });
        return { status: 200, data };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}
