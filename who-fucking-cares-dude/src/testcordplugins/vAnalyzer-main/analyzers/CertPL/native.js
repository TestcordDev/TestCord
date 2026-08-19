/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
let cachedText = null;
let lastFetch = 0;
const CACHE_TTL = 30 * 60 * 1000;
async function fetchList() {
    const now = Date.now();
    if (cachedText && (now - lastFetch) < CACHE_TTL) {
        return cachedText;
    }
    const res = await fetch("https://hole.cert.pl/domains/v2/domains.json", {
        headers: {
            "accept": "application/json",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
        }
    });
    if (!res.ok) {
        throw new Error(`CERT.PL fetch failed: HTTP ${res.status}`);
    }
    cachedText = await res.text();
    lastFetch = now;
    return cachedText;
}
export async function queryCertPL(_, domain) {
    try {
        const text = await fetchList();
        const normalizedDomain = domain.toLowerCase();
        // exact domain
        let found = text.includes(`"DomainAddress":"${normalizedDomain}"`)
            || text.includes(`"DomainAddress": "${normalizedDomain}"`);
        // parent domains
        if (!found) {
            const parts = normalizedDomain.split(".");
            for (let i = 1; i < parts.length - 1; i++) {
                const parent = parts.slice(i).join(".");
                if (text.includes(`"DomainAddress":"${parent}"`) || text.includes(`"DomainAddress": "${parent}"`)) {
                    found = true;
                    break;
                }
            }
        }
        return { found };
    }
    catch (e) {
        return { found: false, error: String(e) };
    }
}
