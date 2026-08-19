/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export const THEMES_API_URL = "https://themes.equicord.org/api/themes";
export const THEME_RAW_API_URL = "https://themes.equicord.org/api";
let cachedPromise = null;
/**
 * Fetches the full theme+snippet catalog once and caches the in-flight/completed
 * promise, so ThemeMarketplaceSection and SnippetMarketplaceSection (which both
 * want the same data, just filtered differently) never fire two concurrent
 * requests to the same URL.
 */
export function fetchMarketplaceCatalog() {
    if (!cachedPromise) {
        cachedPromise = fetch(THEMES_API_URL)
            .then(res => {
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
            .then(data => Object.values(data))
            .catch(err => {
            // don't cache failures, let the next caller retry
            cachedPromise = null;
            throw err;
        });
    }
    return cachedPromise;
}
export function invalidateMarketplaceCatalog() {
    cachedPromise = null;
}
export function getItemLink(id) {
    return `${THEME_RAW_API_URL}/${id}`;
}
