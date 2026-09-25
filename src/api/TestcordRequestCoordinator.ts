/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { sleep } from "@utils/misc";
import { Constants, MessageStore, RestAPI, UserStore } from "@webpack/common";

export interface CoordinatedRequestOptions<T> {
    key: string;
    run: () => Promise<T>;
    ttlMs?: number;
    scope?: string;
    minDelayMs?: number;
    cacheable?: (value: T) => boolean;
}

interface CacheEntry {
    expiresAt: number;
    value: unknown;
}

interface TestcordHelperNetworkSettings {
    CarefulNetwork?: boolean;
    performanceMode?: boolean;
    performanceCarefulNetwork?: boolean;
    performanceBoundRequestCache?: boolean;
    performanceRequestCacheEntries?: number;
    performanceNetworkOptimizations?: boolean;
    performanceAggressiveNetwork?: boolean;
}

const DEFAULT_MAX_CACHE_ENTRIES = 250;

const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, CacheEntry>();
const scopeChains = new Map<string, Promise<void>>();

function helperSettings() {
    return Settings.plugins.TestcordHelper as TestcordHelperNetworkSettings | undefined;
}

function isEnabled(): boolean {
    const settings = helperSettings();
    if (settings?.CarefulNetwork === true) return true;
    if (settings?.performanceMode !== true) return false;
    return settings.performanceCarefulNetwork === true || settings.performanceNetworkOptimizations === true;
}

export function networkOptimizationsEnabled(): boolean {
    const settings = helperSettings();
    return settings?.performanceMode === true && settings.performanceNetworkOptimizations === true;
}

export function aggressiveNetworkEnabled(): boolean {
    const settings = helperSettings();
    return settings?.performanceMode === true && settings.performanceAggressiveNetwork === true;
}

function isBoundCacheEnabled(): boolean {
    const settings = helperSettings();
    return settings?.performanceMode === true && settings.performanceBoundRequestCache === true;
}

function getMaxCacheEntries(): number {
    const value = helperSettings()?.performanceRequestCacheEntries;
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_MAX_CACHE_ENTRIES;
}

function pruneCache(now = Date.now()): void {
    for (const [mapKey, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(mapKey);
    }

    if (!isBoundCacheEnabled()) return;

    const maxEntries = getMaxCacheEntries();
    while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
}

async function waitForScope(scope: string, minDelayMs: number): Promise<void> {
    const previous = scopeChains.get(scope) ?? Promise.resolve();
    const next = previous.then(() => sleep(minDelayMs), () => sleep(minDelayMs));
    scopeChains.set(scope, next);
    await next;
    if (scopeChains.get(scope) === next) scopeChains.delete(scope);
}

/**
 * Discord API keys are not unique per account: `discord:messages:<channel>:before:<id>:limit:100`
 * is built by several plugins, and the auth token lives inside each caller's `run` closure
 * rather than in the key. Without partitioning, an account switch (or a second account on
 * the same client) would serve the previous account's cached pages for the length of the
 * TTL. The cache and the in-flight table are therefore keyed by account as well.
 *
 * The user id is used rather than the token: it identifies the account without putting a
 * credential into a long-lived map key.
 */
function accountScopedKey(key: string): string {
    return `${UserStore?.getCurrentUser()?.id ?? "no-account"}:${key}`;
}

export async function request<T>({ key, run, ttlMs, scope, minDelayMs, cacheable }: CoordinatedRequestOptions<T>): Promise<T> {
    if (!isEnabled()) return await run();

    const scopedKey = accountScopedKey(key);
    const now = Date.now();
    pruneCache(now);

    const cached = cache.get(scopedKey);
    if (cached && cached.expiresAt > now) return cached.value as T;

    const existing = inFlight.get(scopedKey);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
        if (scope && minDelayMs) await waitForScope(scope, minDelayMs);
        const value = await run();
        if (ttlMs && (cacheable?.(value) ?? value != null)) {
            cache.set(scopedKey, { expiresAt: Date.now() + ttlMs, value });
            pruneCache();
        }
        return value;
    })();

    inFlight.set(scopedKey, promise);
    try {
        return await promise;
    } finally {
        inFlight.delete(scopedKey);
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
export async function fetchMessageAround(channelId: string, messageId: string): Promise<any | null> {
    const res = await request<{ body?: any[]; }>({
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
export function getCachedMessage(channelId: string, messageId: string): any | null {
    return MessageStore.getMessage(channelId, messageId) ?? null;
}

export function invalidate(key: string): void {
    if (!isEnabled()) return;
    const scopedKey = accountScopedKey(key);
    cache.delete(scopedKey);
    inFlight.delete(scopedKey);
}

export function invalidatePrefix(prefix: string): void {
    if (!isEnabled()) return;
    const scopedPrefix = accountScopedKey(prefix);
    for (const mapKey of cache.keys()) {
        if (mapKey.startsWith(scopedPrefix)) cache.delete(mapKey);
    }

    for (const mapKey of inFlight.keys()) {
        if (mapKey.startsWith(scopedPrefix)) inFlight.delete(mapKey);
    }
}
