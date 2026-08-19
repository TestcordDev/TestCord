/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export let DIFF_CACHE_MAX = 2000;
export let TRANSLATION_CACHE_MAX = 500;
export let ZIP_CACHE_MAX = 100;
export let CACHED_MESSAGES_MAX = 5000;
export let TOTALS_MAX = 5000;
export let CSP_MAX_ENTRIES = 500;
export function setCacheLimits(limits) {
    if (limits.diff !== undefined)
        DIFF_CACHE_MAX = limits.diff;
    if (limits.translation !== undefined)
        TRANSLATION_CACHE_MAX = limits.translation;
    if (limits.zip !== undefined)
        ZIP_CACHE_MAX = limits.zip;
    if (limits.messages !== undefined)
        CACHED_MESSAGES_MAX = limits.messages;
    if (limits.totals !== undefined)
        TOTALS_MAX = limits.totals;
    if (limits.csp !== undefined)
        CSP_MAX_ENTRIES = limits.csp;
}
export function resetCacheLimits() {
    DIFF_CACHE_MAX = 2000;
    TRANSLATION_CACHE_MAX = 500;
    ZIP_CACHE_MAX = 100;
    CACHED_MESSAGES_MAX = 5000;
    TOTALS_MAX = 5000;
    CSP_MAX_ENTRIES = 500;
}
export function disableCacheLimits() {
    DIFF_CACHE_MAX = Infinity;
    TRANSLATION_CACHE_MAX = Infinity;
    ZIP_CACHE_MAX = Infinity;
    CACHED_MESSAGES_MAX = Infinity;
    TOTALS_MAX = Infinity;
    CSP_MAX_ENTRIES = Infinity;
}
