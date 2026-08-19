/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Settings } from "@api/Settings";
import { sleep } from "@utils/misc";
import { Constants, MessageStore, RestAPI } from "@webpack/common";
const DEFAULT_MAX_CACHE_ENTRIES = 250;
const inFlight = new Map();
const cache = new Map();
const scopeChains = new Map();
function helperSettings() {
    return Settings.plugins.TestcordHelper;
}
function isEnabled() {
    const settings = helperSettings();
    if (settings?.CarefulNetwork === true)
        return true;
    if (settings?.performanceMode !== true)
        return false;
    return settings.performanceCarefulNetwork === true || settings.performanceNetworkOptimizations === true;
}
export function networkOptimizationsEnabled() {
    const settings = helperSettings();
    return settings?.performanceMode === true && settings.performanceNetworkOptimizations === true;
}
export function aggressiveNetworkEnabled() {
    const settings = helperSettings();
    return settings?.performanceMode === true && settings.performanceAggressiveNetwork === true;
}
function isBoundCacheEnabled() {
    const settings = helperSettings();
    return settings?.performanceMode === true && settings.performanceBoundRequestCache === true;
}
function getMaxCacheEntries() {
    const value = helperSettings()?.performanceRequestCacheEntries;
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_MAX_CACHE_ENTRIES;
}
function pruneCache(now = Date.now()) {
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now)
            cache.delete(key);
    }
    if (!isBoundCacheEnabled())
        return;
    const maxEntries = getMaxCacheEntries();
    while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined)
            break;
        cache.delete(oldest);
    }
}
async function waitForScope(scope, minDelayMs) {
    const previous = scopeChains.get(scope) ?? Promise.resolve();
    const next = previous.then(() => sleep(minDelayMs), () => sleep(minDelayMs));
    scopeChains.set(scope, next);
    await next;
    if (scopeChains.get(scope) === next)
        scopeChains.delete(scope);
}
export async function request({ key, run, ttlMs, scope, minDelayMs, cacheable }) {
    if (!isEnabled())
        return await run();
    const now = Date.now();
    pruneCache(now);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now)
        return cached.value;
    const existing = inFlight.get(key);
    if (existing)
        return existing;
    const promise = (async () => {
        if (scope && minDelayMs)
            await waitForScope(scope, minDelayMs);
        const value = await run();
        if (ttlMs && (cacheable?.(value) ?? value != null)) {
            cache.set(key, { expiresAt: Date.now() + ttlMs, value });
            pruneCache();
        }
        return value;
    })();
    inFlight.set(key, promise);
    try {
        return await promise;
    }
    finally {
        inFlight.delete(key);
    }
}
const MESSAGE_FETCH_TTL_MS = 60_000;
/**
 * Shared fetch for the `/channels/{ch}/messages?around={id}&limit=1` pattern used by
 * messageLinkTooltip and messageLinkEmbeds. Dedupes in-flight requests and briefly caches
 * the raw response through the coordinator, so repeated hovers/renders of the same linked
 * message collapse to a single network call. Returns the raw API response body element
 * (the neighbour message Discord returns via `around=`), leaving each caller's own
 * `receiveMessage` post-processing untouched. Returns the single message object (the
 * first/only element of the `around=limit=1` response), or null when the channel returned
 * nothing.
 *
 * IMPORTANT: this does NOT short-circuit on MessageStore. validReply relies on the raw
 * `around=` response to detect deletions (Discord returns a *neighbour* message with a
 * different id when the target is gone); a MessageStore hit could never reproduce that, so
 * the local fast-path is left to callers that feed `receiveMessage` and explicitly opt in
 * via the separate `getCachedMessage` helper below.
 *
 * When the coordinator is disabled, `request()` is a pure passthrough, so this behaves
 * exactly like the original direct `RestAPI.get` with identical url/query/retries.
 */
export async function fetchMessageAround(channelId, messageId) {
    const res = await request({
        key: `discord:messages:around:${channelId}:${messageId}`,
        ttlMs: MESSAGE_FETCH_TTL_MS,
        run: () => RestAPI.get({
            url: Constants.Endpoints.MESSAGES(channelId),
            query: { limit: 1, around: messageId },
            retries: 2,
        }),
        cacheable: value => Array.isArray(value?.body) && value.body.length > 0,
    });
    return res?.body?.[0] ?? null;
}
/**
 * MessageStore fast-path for callers that resolve the linked message through
 * `receiveMessage` (messageLinkTooltip, messageLinkEmbeds). Returns the locally-cached
 * store record if present so the network is skipped entirely. Always safe to call: a free
 * local read with no toggle dependency. Returns null on a miss, signalling the caller to
 * fall back to `fetchMessageAround`.
 */
export function getCachedMessage(channelId, messageId) {
    return MessageStore.getMessage(channelId, messageId) ?? null;
}
export function invalidate(key) {
    if (!isEnabled())
        return;
    cache.delete(key);
    inFlight.delete(key);
}
export function invalidatePrefix(prefix) {
    if (!isEnabled())
        return;
    for (const key of cache.keys()) {
        if (key.startsWith(prefix))
            cache.delete(key);
    }
    for (const key of inFlight.keys()) {
        if (key.startsWith(prefix))
            inFlight.delete(key);
    }
}
