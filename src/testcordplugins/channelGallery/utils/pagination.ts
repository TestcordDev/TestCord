/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Constants, RestAPI } from "@webpack/common";

const FETCH_TIMEOUT_MS = 15_000;

function getMessagesEndpoint(channelId: string): string {
    try {
        if (typeof Constants?.Endpoints?.MESSAGES === "function") {
            const ep = Constants.Endpoints.MESSAGES(channelId);
            if (ep) return ep;
        }
    } catch { }
    return `/channels/${channelId}/messages`;
}

export async function fetchMessagesPage(args: {
    channelId: string;
    before: string | null;
    limit: number;
    signal?: AbortSignal;
}): Promise<any[]> {
    if (!args.channelId || args.channelId === "undefined") return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const { signal } = args;
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    // Discord API enforces a maximum limit of 100 for messages requests.
    const safeLimit = Math.min(100, Math.max(1, Math.floor(args.limit)));

    try {
        const url = getMessagesEndpoint(args.channelId);
        let res: any;
        if (RestAPI?.get) {
            res = await (RestAPI.get as any)({
                url,
                query: {
                    limit: safeLimit,
                    ...(args.before ? { before: args.before } : {})
                },
                signal: controller.signal,
                retries: 1
            });
        }

        const raw = res?.body ?? res;
        const list = Array.isArray(raw) ? raw : (Array.isArray(res?.body) ? res.body : (Array.isArray(res) ? res : []));
        return list;
    } catch (e: any) {
        if (e?.name === "AbortError" || e?.message === "Aborted" || controller.signal.aborted) {
            return [];
        }
        console.warn("[ChannelGallery] Failed to fetch messages page:", e);
        return [];
    } finally {
        clearTimeout(timeout);
    }
}
