/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";

export const proxyLogger = new Logger("QuestRegions/Proxy");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProxyEntry {
    host: string;
    port: number;
    raw: string; // "host:port"
    country?: string; // ISO-3166-1 alpha-2, set when fetched from a country-aware API
    source?: string; // which provider it came from
}

export type ProxySource =
    | "file"
    | "proxyscrape"
    | "flashproxy"
    | "proxifly"
    | "geonode"
    | "proxyradar"
    | "monosans"
    | "clearproxy"
    | "iplocate"
    | "jetkai"
    | "vakhov"
    | "thespeedx"
    | "proxylistworld"
    | "databay"
    | "worldpool"
    | "proxygenerator"
    | "stormsia"
    | "clarketm";

function getNative(): PluginNative<typeof import("./native")> | null {
    const native = (globalThis as { VencordNative?: { pluginHelpers?: Record<string, unknown>; }; }).VencordNative?.pluginHelpers?.QuestRegions as
        | PluginNative<typeof import("./native")>
        | undefined;
    return native ?? null;
}

async function fetchTextFromUrl(url: string): Promise<string> {
    const native = getNative();
    if (native) {
        const result = await native.fetchTextUrl(url);
        if (result.error) throw new Error(result.error);
        if (result.status < 200 || result.status >= 300) throw new Error(`HTTP ${result.status}`);
        return result.body;
    }

    const res = await fetch(url, { signal: signal() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
}

async function fetchJsonFromUrl<T>(url: string): Promise<T> {
    const text = await fetchTextFromUrl(url);
    return JSON.parse(text) as T;
}

function mergeUniqueProxies(lists: ProxyEntry[][]): ProxyEntry[] {
    const seen = new Set<string>();
    const merged: ProxyEntry[] = [];

    for (const list of lists) {
        for (const entry of list) {
            if (seen.has(entry.raw)) continue;
            seen.add(entry.raw);
            merged.push(entry);
        }
    }

    return merged;
}

// ─── Proxy list parser ────────────────────────────────────────────────────────

/**
 * Parses a plain-text proxy list (one "host:port" per line).
 * Strips protocol prefixes, blank lines, and comment lines.
 */
export function parseProxyList(raw: string, country?: string, source?: string): ProxyEntry[] {
    return raw
        .split(/[\r\n]+/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#"))
        .flatMap(line => {
            const firstToken = line.split(/\s+/)[0];
            const protocolMatch = /^([a-z0-9+.-]+):\/\//i.exec(firstToken);
            const protocol = protocolMatch?.[1]?.toLowerCase();
            if (protocol && protocol !== "http" && protocol !== "https") return [];

            const stripped = firstToken.replace(/^https?:\/\//i, "");
            const colons = stripped.split(":");
            if (colons.length < 2) return [];
            const host = colons[0];
            const port = parseInt(colons[1], 10);
            if (!host || isNaN(port) || port < 1 || port > 65535) return [];
            return [{ host, port, raw: `${host}:${port}`, ...(country ? { country } : {}), ...(source ? { source } : {}) }];
        });
}

// ─── Per-country proxy fetching ───────────────────────────────────────────────
//
// Each provider function accepts a country code (e.g. "US", "DE") and returns
// a list of ProxyEntry objects already tagged with that country.
// All are HTTP-only (no SOCKS) since the native tunnel uses HTTP CONNECT.

const FETCH_TIMEOUT_MS = 20_000;
const signal = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);
const MONOSANS_CACHE_TTL_MS = 10 * 60 * 1000;
let monosansCache: { at: number; proxies: ProxyEntry[]; } | null = null;
let jetKaiCache: { at: number; proxies: ProxyEntry[]; } | null = null;
let vakhovCache: { at: number; proxies: ProxyEntry[]; } | null = null;
let worldpoolCache: { at: number; proxies: ProxyEntry[]; } | null = null;
let proxyGeneratorCache: { at: number; proxies: ProxyEntry[]; } | null = null;
let proxyRadarQueue = Promise.resolve();
let nextProxyRadarAt = 0;

function withProxyRadarRateLimit<T>(task: () => Promise<T>): Promise<T> {
    const run = proxyRadarQueue.then(async () => {
        const delayMs = nextProxyRadarAt - Date.now();
        if (delayMs > 0) await new Promise<void>(resolve => setTimeout(resolve, delayMs));
        try {
            return await task();
        } finally {
            nextProxyRadarAt = Date.now() + 1100;
        }
    });
    proxyRadarQueue = run.then(() => undefined, () => undefined);
    return run;
}

/**
 * ProxyScrape v4 — official API, country-filtered, HTTP only.
 * https://docs.proxyscrape.com/api-reference/public-api/get-proxy-list
 */
export async function fetchProxyScrapeForCountry(country: string): Promise<ProxyEntry[]> {
    const url = `https://api.proxyscrape.com/v4/free-proxy-list/get?request=displayproxies&protocol=http&country=${country}&timeout=10000&ssl=all&anonymity=all`;
    console.debug(`[QuestRegions/Proxy] ProxyScrape → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, country, "proxyscrape");
        console.debug(`[QuestRegions/Proxy] ProxyScrape ${country}: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug(`[QuestRegions/Proxy] ProxyScrape ${country} failed:`, err instanceof Error ? err.message : err);
        return [];
    }
}

/**
 * FlashProxy — filtered TXT endpoint, HTTP only.
 * https://flashproxy.com/resources/free-proxies
 */
export async function fetchFlashProxyForCountry(country: string): Promise<ProxyEntry[]> {
    const url = `https://flashproxy.com/resources/free-proxies/txt?country=${country}&protocol=http&anonymity=all&limit=200`;
    console.debug(`[QuestRegions/Proxy] FlashProxy → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, country, "flashproxy");
        console.debug(`[QuestRegions/Proxy] FlashProxy ${country}: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug(`[QuestRegions/Proxy] FlashProxy ${country} failed:`, err instanceof Error ? err.message : err);
        return [];
    }
}

/**
 * Proxifly CDN (jsDelivr) — direct GitHub list, country-specific TXT files.
 * https://github.com/proxifly/free-proxy-list
 * Updated every 5 minutes.
 */
export async function fetchProxiflyForCountry(country: string): Promise<ProxyEntry[]> {
    const url = `https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/countries/${country}/data.txt`;
    console.debug(`[QuestRegions/Proxy] Proxifly → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        // Proxifly data.txt lines may be "protocol://host:port" — parseProxyList strips the prefix
        const entries = parseProxyList(text, country, "proxifly");
        console.debug(`[QuestRegions/Proxy] Proxifly ${country}: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug(`[QuestRegions/Proxy] Proxifly ${country} failed:`, err instanceof Error ? err.message : err);
        return [];
    }
}

/**
 * Geonode — unofficial but widely used JSON API, country-filtered.
 * Returns the first page (100 entries) of HTTP proxies.
 */
export async function fetchGeonodeForCountry(country: string): Promise<ProxyEntry[]> {
    const url = `https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&country=${country}&protocols=http`;
    console.debug(`[QuestRegions/Proxy] Geonode → ${url}`);
    try {
        const json = await fetchJsonFromUrl<{ data?: Array<{ ip?: string; port?: string | number; }> }>(url);
        const entries: ProxyEntry[] = (json.data ?? []).flatMap(item => {
            const host = item.ip ?? "";
            const port = typeof item.port === "string" ? parseInt(item.port, 10) : (item.port ?? NaN);
            if (!host || isNaN(port) || port < 1 || port > 65535) return [];
            return [{ host, port, raw: `${host}:${port}`, country, source: "geonode" }];
        });
        console.debug(`[QuestRegions/Proxy] Geonode ${country}: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug(`[QuestRegions/Proxy] Geonode ${country} failed:`, err instanceof Error ? err.message : err);
        return [];
    }
}

/**
 * ProxyRadar — country/type-filtered public API.
 * https://proxyradar.net/docs/api
 */
export async function fetchProxyRadarForCountry(country: string): Promise<ProxyEntry[]> {
    const url = `https://proxyradar.net/api/proxies?country=${country}&type=http,https&limit=200&format=json`;
    console.debug(`[QuestRegions/Proxy] ProxyRadar → ${url}`);
    try {
        const json = await withProxyRadarRateLimit(() => fetchJsonFromUrl<Array<{ proxy?: string; country?: string; type?: string; }>>(url));
        const entries = json.flatMap(item => parseProxyList(item.proxy ?? "", item.country?.toUpperCase() ?? country, item.type ? `proxyradar:${item.type}` : "proxyradar"));
        console.debug(`[QuestRegions/Proxy] ProxyRadar ${country}: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug(`[QuestRegions/Proxy] ProxyRadar ${country} failed:`, err instanceof Error ? err.message : err);
        return [];
    }
}

/**
 * ClearProxy checked country files.
 * https://github.com/ClearProxy/checked-proxy-list
 */
export async function fetchClearProxyForCountry(country: string): Promise<ProxyEntry[]> {
    const url = `https://raw.githubusercontent.com/ClearProxy/checked-proxy-list/main/http/raw/country/${country}.txt`;
    console.debug(`[QuestRegions/Proxy] ClearProxy → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, country, "clearproxy");
        console.debug(`[QuestRegions/Proxy] ClearProxy ${country}: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug(`[QuestRegions/Proxy] ClearProxy ${country} failed:`, err instanceof Error ? err.message : err);
        return [];
    }
}

/**
 * IPLocate verified country folders.
 * https://github.com/iplocate/free-proxy-list
 */
export async function fetchIPLocateForCountry(country: string): Promise<ProxyEntry[]> {
    const url = `https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/${country}/proxies.txt`;
    console.debug(`[QuestRegions/Proxy] IPLocate → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, country, "iplocate");
        console.debug(`[QuestRegions/Proxy] IPLocate ${country}: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug(`[QuestRegions/Proxy] IPLocate ${country} failed:`, err instanceof Error ? err.message : err);
        return [];
    }
}

/**
 * Databay public API and all-list CDN. Country CDN folders are not stable, so
 * use the API for country-specific candidates and the CDN files for fallback.
 * https://github.com/databay-labs/free-proxy-list
 */
export async function fetchDatabayForCountry(country: string): Promise<ProxyEntry[]> {
    const cc = country.toLowerCase();
    const urls = [
        `https://databay.com/api/v1/proxy-list?protocol=http&country=${cc}&ssl=strict&format=txt`,
        `https://databay.com/api/v1/proxy-list?protocol=http&country=${cc}&ssl=loose&format=txt`,
    ];

    const lists = await Promise.all(urls.map(async url => {
        console.debug(`[QuestRegions/Proxy] Databay → ${url}`);
        try {
            return parseProxyList(await fetchTextFromUrl(url), country, "databay");
        } catch (err) {
            console.debug("[QuestRegions/Proxy] Databay country failed:", err instanceof Error ? err.message : err);
            return [];
        }
    }));

    const merged = mergeUniqueProxies(lists);
    console.debug(`[QuestRegions/Proxy] Databay ${country}: ${merged.length} proxies`);
    return merged;
}

async function fetchMonosansAllCached(): Promise<ProxyEntry[]> {
    const now = Date.now();
    if (monosansCache && now - monosansCache.at < MONOSANS_CACHE_TTL_MS) return monosansCache.proxies;

    const url = "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies.json";
    console.debug(`[QuestRegions/Proxy] monosans ALL → ${url}`);
    try {
        const json = await fetchJsonFromUrl<Array<{
            protocol?: string;
            host?: string;
            port?: string | number;
            geolocation?: { country?: { iso_code?: string; }; };
        }>>(url);
        const proxies = json.flatMap(item => {
            if (item.protocol !== "http" && item.protocol !== "https") return [];
            const host = item.host ?? "";
            const port = typeof item.port === "string" ? parseInt(item.port, 10) : (item.port ?? NaN);
            if (!host || isNaN(port) || port < 1 || port > 65535) return [];
            const country = item.geolocation?.country?.iso_code?.toUpperCase();
            return [{
                host,
                port,
                raw: `${host}:${port}`,
                ...(country ? { country } : {}),
                source: `monosans:${item.protocol}`,
            }];
        });
        monosansCache = { at: now, proxies };
        console.debug(`[QuestRegions/Proxy] monosans ALL: ${proxies.length} proxies`);
        return proxies;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] monosans ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchMonosansForCountry(country: string): Promise<ProxyEntry[]> {
    const proxies = await fetchMonosansAllCached();
    const entries = proxies
        .filter(proxy => proxy.country === country)
        .map(proxy => ({ ...proxy, country }));
    console.debug(`[QuestRegions/Proxy] monosans ${country}: ${entries.length} proxies`);
    return entries;
}

async function fetchJetKaiAllCached(): Promise<ProxyEntry[]> {
    const now = Date.now();
    if (jetKaiCache && now - jetKaiCache.at < MONOSANS_CACHE_TTL_MS) return jetKaiCache.proxies;

    const url = "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/json/proxies.json";
    console.debug(`[QuestRegions/Proxy] JetKai ALL → ${url}`);
    try {
        const json = await fetchJsonFromUrl<{ http?: string[]; https?: string[]; }>(url);
        const proxies = [
            ...parseProxyList((json.http ?? []).join("\n"), undefined, "jetkai:http"),
            ...parseProxyList((json.https ?? []).join("\n"), undefined, "jetkai:https"),
        ];
        jetKaiCache = { at: now, proxies };
        console.debug(`[QuestRegions/Proxy] JetKai ALL: ${proxies.length} proxies`);
        return proxies;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] JetKai ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

async function fetchVakhovAllCached(): Promise<ProxyEntry[]> {
    const now = Date.now();
    if (vakhovCache && now - vakhovCache.at < MONOSANS_CACHE_TTL_MS) return vakhovCache.proxies;

    const url = "https://vakhov.github.io/fresh-proxy-list/proxylist.json";
    console.debug(`[QuestRegions/Proxy] Vakhov ALL → ${url}`);
    try {
        const json = await fetchJsonFromUrl<Array<{
            ip?: string;
            port?: string | number;
            country_code?: string;
            http?: string | number;
            ssl?: string | number;
        }>>(url);
        const proxies = json.flatMap(item => {
            if (String(item.http ?? "0") !== "1" && String(item.ssl ?? "0") !== "1") return [];
            const host = item.ip ?? "";
            const port = typeof item.port === "string" ? parseInt(item.port, 10) : (item.port ?? NaN);
            if (!host || isNaN(port) || port < 1 || port > 65535) return [];
            const country = item.country_code?.toUpperCase();
            return [{
                host,
                port,
                raw: `${host}:${port}`,
                ...(country ? { country } : {}),
                source: String(item.ssl ?? "0") === "1" ? "vakhov:https" : "vakhov:http",
            }];
        });
        vakhovCache = { at: now, proxies };
        console.debug(`[QuestRegions/Proxy] Vakhov ALL: ${proxies.length} proxies`);
        return proxies;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] Vakhov ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchVakhovForCountry(country: string): Promise<ProxyEntry[]> {
    const entries = (await fetchVakhovAllCached())
        .filter(proxy => proxy.country === country)
        .map(proxy => ({ ...proxy, country }));
    console.debug(`[QuestRegions/Proxy] Vakhov ${country}: ${entries.length} proxies`);
    return entries;
}

async function fetchWorldpoolAllCached(): Promise<ProxyEntry[]> {
    const now = Date.now();
    if (worldpoolCache && now - worldpoolCache.at < MONOSANS_CACHE_TTL_MS) return worldpoolCache.proxies;

    const url = "https://raw.githubusercontent.com/CelestialBrain/worldpool/main/data/proxies.json";
    console.debug(`[QuestRegions/Proxy] Worldpool ALL → ${url}`);
    try {
        const json = await fetchJsonFromUrl<Array<{
            host?: string;
            port?: string | number;
            protocol?: string;
            country?: string;
            hijacked?: boolean;
        }>>(url);
        const proxies = json.flatMap(item => {
            if (item.protocol !== "http" && item.protocol !== "https") return [];
            if (item.hijacked) return [];
            const host = item.host ?? "";
            const port = typeof item.port === "string" ? parseInt(item.port, 10) : (item.port ?? NaN);
            if (!host || isNaN(port) || port < 1 || port > 65535) return [];
            const country = item.country?.toUpperCase();
            return [{
                host,
                port,
                raw: `${host}:${port}`,
                ...(country ? { country } : {}),
                source: `worldpool:${item.protocol}`,
            }];
        });
        worldpoolCache = { at: now, proxies };
        console.debug(`[QuestRegions/Proxy] Worldpool ALL: ${proxies.length} proxies`);
        return proxies;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] Worldpool ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchWorldpoolForCountry(country: string): Promise<ProxyEntry[]> {
    const entries = (await fetchWorldpoolAllCached())
        .filter(proxy => proxy.country === country)
        .map(proxy => ({ ...proxy, country }));
    console.debug(`[QuestRegions/Proxy] Worldpool ${country}: ${entries.length} proxies`);
    return entries;
}

async function fetchProxyGeneratorAllCached(): Promise<ProxyEntry[]> {
    const now = Date.now();
    if (proxyGeneratorCache && now - proxyGeneratorCache.at < MONOSANS_CACHE_TTL_MS) return proxyGeneratorCache.proxies;

    const url = "https://raw.githubusercontent.com/proxygenerator1/ProxyGenerator/main/ALL/all.json";
    console.debug(`[QuestRegions/Proxy] ProxyGenerator ALL → ${url}`);
    try {
        const json = await fetchJsonFromUrl<Array<{
            ip?: string;
            port?: string | number;
            protocol?: string;
            scheme?: string;
            sites?: Record<string, boolean>;
        }>>(url);
        const proxies = json.flatMap(item => {
            const protocol = (item.protocol ?? item.scheme)?.toLowerCase();
            if (protocol !== "http" && protocol !== "https") return [];
            const host = item.ip ?? "";
            const port = typeof item.port === "string" ? parseInt(item.port, 10) : (item.port ?? NaN);
            if (!host || isNaN(port) || port < 1 || port > 65535) return [];
            return [{ host, port, raw: `${host}:${port}`, source: `proxygenerator:${protocol}` }];
        });
        proxyGeneratorCache = { at: now, proxies };
        console.debug(`[QuestRegions/Proxy] ProxyGenerator ALL: ${proxies.length} proxies`);
        return proxies;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] ProxyGenerator ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

// ─── All-country (no filter) fetchers ────────────────────────────────────────

/** Fetch all countries from ProxyScrape (used when source=proxyscrape without country context). */
export async function fetchProxyScrapeAll(): Promise<ProxyEntry[]> {
    const url = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&ssl=all&anonymity=all";
    console.debug(`[QuestRegions/Proxy] ProxyScrape ALL → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, undefined, "proxyscrape");
        console.debug(`[QuestRegions/Proxy] ProxyScrape ALL: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] ProxyScrape ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchProxiflyAll(): Promise<ProxyEntry[]> {
    const url = "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/all/data.txt";
    console.debug(`[QuestRegions/Proxy] Proxifly ALL → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, undefined, "proxifly");
        console.debug(`[QuestRegions/Proxy] Proxifly ALL: ${entries.length} HTTP proxies`);
        return entries;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] Proxifly ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchGeonodeAll(): Promise<ProxyEntry[]> {
    const url = "https://proxylist.geonode.com/api/proxy-list?limit=200&page=1&sort_by=lastChecked&sort_type=desc&protocols=http";
    console.debug(`[QuestRegions/Proxy] Geonode ALL → ${url}`);
    try {
        const json = await fetchJsonFromUrl<{ data?: Array<{ ip?: string; port?: string | number; country?: string; }> }>(url);
        const entries: ProxyEntry[] = (json.data ?? []).flatMap(item => {
            const host = item.ip ?? "";
            const port = typeof item.port === "string" ? parseInt(item.port, 10) : (item.port ?? NaN);
            if (!host || isNaN(port) || port < 1 || port > 65535) return [];
            return [{
                host,
                port,
                raw: `${host}:${port}`,
                ...(item.country ? { country: item.country } : {}),
                source: "geonode",
            }];
        });
        console.debug(`[QuestRegions/Proxy] Geonode ALL: ${entries.length} HTTP proxies`);
        return entries;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] Geonode ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchProxyRadarAll(): Promise<ProxyEntry[]> {
    const url = "https://proxyradar.net/api/proxies?type=http,https&limit=500&format=json";
    console.debug(`[QuestRegions/Proxy] ProxyRadar ALL → ${url}`);
    try {
        const json = await withProxyRadarRateLimit(() => fetchJsonFromUrl<Array<{ proxy?: string; country?: string; type?: string; }>>(url));
        const entries = json.flatMap(item => parseProxyList(item.proxy ?? "", item.country?.toUpperCase(), item.type ? `proxyradar:${item.type}` : "proxyradar"));
        console.debug(`[QuestRegions/Proxy] ProxyRadar ALL: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] ProxyRadar ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchClearProxyAll(): Promise<ProxyEntry[]> {
    const url = "https://raw.githubusercontent.com/ClearProxy/checked-proxy-list/main/http/raw/all.txt";
    console.debug(`[QuestRegions/Proxy] ClearProxy ALL → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, undefined, "clearproxy");
        console.debug(`[QuestRegions/Proxy] ClearProxy ALL: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] ClearProxy ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchIPLocateAll(): Promise<ProxyEntry[]> {
    const url = "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt";
    console.debug(`[QuestRegions/Proxy] IPLocate ALL → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, undefined, "iplocate");
        console.debug(`[QuestRegions/Proxy] IPLocate ALL: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] IPLocate ALL failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchTheSpeedXAll(): Promise<ProxyEntry[]> {
    const urls = [
        "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
        "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/https.txt",
    ];
    const lists = await Promise.all(urls.map(async url => {
        console.debug(`[QuestRegions/Proxy] TheSpeedX → ${url}`);
        try {
            return parseProxyList(await fetchTextFromUrl(url), undefined, "thespeedx");
        } catch (err) {
            console.debug("[QuestRegions/Proxy] TheSpeedX failed:", err instanceof Error ? err.message : err);
            return [];
        }
    }));
    const merged = mergeUniqueProxies(lists);
    console.debug(`[QuestRegions/Proxy] TheSpeedX ALL: ${merged.length} proxies`);
    return merged;
}

export async function fetchProxyListWorldAll(): Promise<ProxyEntry[]> {
    const url = "https://raw.githubusercontent.com/themiralay/Proxy-List-World/master/data.txt";
    console.debug(`[QuestRegions/Proxy] Proxy-List-World → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, undefined, "proxylistworld");
        console.debug(`[QuestRegions/Proxy] Proxy-List-World ALL: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] Proxy-List-World failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchDatabayAll(): Promise<ProxyEntry[]> {
    const urls = [
        "https://cdn.jsdelivr.net/gh/databay-labs/free-proxy-list/http.txt",
        "https://cdn.jsdelivr.net/gh/databay-labs/free-proxy-list/https.txt",
    ];
    const lists = await Promise.all(urls.map(async url => {
        console.debug(`[QuestRegions/Proxy] Databay ALL → ${url}`);
        try {
            return parseProxyList(await fetchTextFromUrl(url), undefined, "databay");
        } catch (err) {
            console.debug("[QuestRegions/Proxy] Databay ALL failed:", err instanceof Error ? err.message : err);
            return [];
        }
    }));
    const merged = mergeUniqueProxies(lists);
    console.debug(`[QuestRegions/Proxy] Databay ALL: ${merged.length} proxies`);
    return merged;
}

export async function fetchStormsiaAll(): Promise<ProxyEntry[]> {
    const url = "https://raw.githubusercontent.com/stormsia/proxy-list/main/working_proxies.txt";
    console.debug(`[QuestRegions/Proxy] stormsia → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, undefined, "stormsia");
        console.debug(`[QuestRegions/Proxy] stormsia ALL: ${entries.length} HTTP proxies`);
        return entries;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] stormsia failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

export async function fetchClarketmAll(): Promise<ProxyEntry[]> {
    const url = "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt";
    console.debug(`[QuestRegions/Proxy] clarketm → ${url}`);
    try {
        const text = await fetchTextFromUrl(url);
        const entries = parseProxyList(text, undefined, "clarketm");
        console.debug(`[QuestRegions/Proxy] clarketm ALL: ${entries.length} proxies`);
        return entries;
    } catch (err) {
        console.debug("[QuestRegions/Proxy] clarketm failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

// Kept for backward compat (old "api" source setting)
export async function fetchScrapedProxies(): Promise<ProxyEntry[]> {
    return fetchProxyScrapeAll();
}

export async function fetchProxiesGeneric(sources: ProxySource[]): Promise<ProxyEntry[]> {
    console.debug(`[QuestRegions/Proxy] fetchProxiesGeneric: sources=[${sources.join(",")}]`);

    const fetchers: Promise<ProxyEntry[]>[] = [];

    for (const source of sources) {
        switch (source) {
            case "proxyscrape": fetchers.push(fetchProxyScrapeAll()); break;
            case "proxifly": fetchers.push(fetchProxiflyAll()); break;
            case "geonode": fetchers.push(fetchGeonodeAll()); break;
            case "proxyradar": fetchers.push(fetchProxyRadarAll()); break;
            case "monosans": fetchers.push(fetchMonosansAllCached()); break;
            case "clearproxy": fetchers.push(fetchClearProxyAll()); break;
            case "iplocate": fetchers.push(fetchIPLocateAll()); break;
            case "jetkai": fetchers.push(fetchJetKaiAllCached()); break;
            case "vakhov": fetchers.push(fetchVakhovAllCached()); break;
            case "thespeedx": fetchers.push(fetchTheSpeedXAll()); break;
            case "proxylistworld": fetchers.push(fetchProxyListWorldAll()); break;
            case "databay": fetchers.push(fetchDatabayAll()); break;
            case "worldpool": fetchers.push(fetchWorldpoolAllCached()); break;
            case "proxygenerator": fetchers.push(fetchProxyGeneratorAllCached()); break;
            case "stormsia": fetchers.push(fetchStormsiaAll()); break;
            case "clarketm": fetchers.push(fetchClarketmAll()); break;
            case "flashproxy": break;
            case "file": break;
        }
    }

    const results = await Promise.all(fetchers);
    const merged = mergeUniqueProxies(results);
    console.debug(`[QuestRegions/Proxy] fetchProxiesGeneric: ${merged.length} unique proxies total`);
    return merged;
}

// ─── Country-aware proxy resolver ─────────────────────────────────────────────

/**
 * Fetches HTTP proxies for a specific country from all configured sources in parallel.
 * Sources that fail or return 0 results are silently dropped.
 * Results are deduplicated by "host:port".
 */
export async function fetchProxiesForCountry(
    country: string,
    sources: ProxySource[],
): Promise<ProxyEntry[]> {
    console.debug(`[QuestRegions/Proxy] fetchProxiesForCountry: country=${country} sources=[${sources.join(",")}]`);

    const fetchers: Promise<ProxyEntry[]>[] = [];

    for (const source of sources) {
        switch (source) {
            case "proxyscrape": fetchers.push(fetchProxyScrapeForCountry(country)); break;
            case "flashproxy": fetchers.push(fetchFlashProxyForCountry(country)); break;
            case "proxifly": fetchers.push(fetchProxiflyForCountry(country)); break;
            case "geonode": fetchers.push(fetchGeonodeForCountry(country)); break;
            case "proxyradar": fetchers.push(fetchProxyRadarForCountry(country)); break;
            case "monosans": fetchers.push(fetchMonosansForCountry(country)); break;
            case "clearproxy": fetchers.push(fetchClearProxyForCountry(country)); break;
            case "iplocate": fetchers.push(fetchIPLocateForCountry(country)); break;
            case "databay": fetchers.push(fetchDatabayForCountry(country)); break;
            case "worldpool": fetchers.push(fetchWorldpoolForCountry(country)); break;
            case "vakhov": fetchers.push(fetchVakhovForCountry(country)); break;
            case "jetkai": break;
            case "proxygenerator": break;
            case "stormsia": break;
            case "thespeedx": break;
            case "proxylistworld": break;
            case "clarketm": break;
            case "file": break; // handled externally
        }
    }

    const results = await Promise.all(fetchers);
    const merged = mergeUniqueProxies(results);
    console.debug(`[QuestRegions/Proxy] fetchProxiesForCountry: ${country} → ${merged.length} unique proxies total`);
    return merged;
}
