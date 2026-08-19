/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export async function querySucuri(_, url) {
    try {
        const scanUrl = `https://sitecheck.sucuri.net/api/v3/?scan=${encodeURIComponent(url)}`;
        const res = await fetch(scanUrl, {
            headers: {
                "accept": "application/json",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
            }
        });
        if (!res.ok) {
            return { error: `Sucuri returned ${res.status}: ${res.statusText}` };
        }
        const data = await res.json();
        return { data };
    }
    catch (e) {
        return { error: String(e) };
    }
}
