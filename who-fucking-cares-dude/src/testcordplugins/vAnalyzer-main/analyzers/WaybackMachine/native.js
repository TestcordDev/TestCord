/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export async function queryWayback(_, url) {
    try {
        const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, {
            headers: {
                "accept": "application/json",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
            }
        });
        if (!res.ok) {
            return { status: res.status, data: null, error: `HTTP ${res.status}` };
        }
        const data = await res.json();
        return { status: 200, data };
    }
    catch (e) {
        return { status: -1, data: null, error: String(e) };
    }
}
