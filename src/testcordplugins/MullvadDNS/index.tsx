/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import type { DnsFamily, MullvadResolveResult, ResolveProtocol } from "./native";

const Native = VencordNative.pluginHelpers.MullvadDNS as PluginNative<typeof import("./native")>;

enum MullvadProfile {
    DNS = "dns",
    ADBLOCK = "adblock",
    BASE = "base",
    EXTENDED = "extended",
    FAMILY = "family",
    ALL = "all"
}

enum LogLevel {
    VERBOSE = "verbose",
    INFO = "info",
    WARN = "warn",
    ERROR = "error"
}

enum MullvadResolveMode {
    AUTOMATIC = "automatic",
    DOH = "doh",
    PLAIN_DNS = "plain_dns"
}

const logger = new Logger("MullvadDNS", "#a6da95");

const START_DELAY_MS = 2000;
const MS_PER_MINUTE = 60_000;
const DEFAULT_CACHE_MINUTES = 15;
const DEFAULT_TIMEOUT_MS = 5000;
const DNS_CACHE_MAX = 256;

const DEFAULT_DOMAINS = [
    "discord.com",
    "discordapp.com",
    "discordapp.net",
    "gateway.discord.gg",
    "media.discordapp.net",
    "cdn.discordapp.com",
    "status.discord.com",
    "ptb.discord.com",
    "canary.discord.com"
];

const DEFAULT_EXCLUDED_PATTERNS = [
    "/api/v9/oauth2",
    "/api/oauth2",
    "/oauth2/",
    "/api/v9/auth",
    "/api/v9/verify",
    "/api/v9/users/@me/settings-proto",
    "/api/v9/users/@me/applications-role-connection"
];

const MULLVAD_ENDPOINTS: Record<MullvadProfile, string> = {
    [MullvadProfile.DNS]: "https://dns.mullvad.net/dns-query",
    [MullvadProfile.ADBLOCK]: "https://adblock.dns.mullvad.net/dns-query",
    [MullvadProfile.BASE]: "https://base.dns.mullvad.net/dns-query",
    [MullvadProfile.EXTENDED]: "https://extended.dns.mullvad.net/dns-query",
    [MullvadProfile.FAMILY]: "https://family.dns.mullvad.net/dns-query",
    [MullvadProfile.ALL]: "https://all.dns.mullvad.net/dns-query"
};

const MULLVAD_DNS_SERVERS: Record<MullvadProfile, Record<DnsFamily, string>> = {
    [MullvadProfile.DNS]: {
        4: "194.242.2.2",
        6: "2a07:e340::2"
    },
    [MullvadProfile.ADBLOCK]: {
        4: "194.242.2.3",
        6: "2a07:e340::3"
    },
    [MullvadProfile.BASE]: {
        4: "194.242.2.4",
        6: "2a07:e340::4"
    },
    [MullvadProfile.EXTENDED]: {
        4: "194.242.2.5",
        6: "2a07:e340::5"
    },
    [MullvadProfile.FAMILY]: {
        4: "194.242.2.6",
        6: "2a07:e340::6"
    },
    [MullvadProfile.ALL]: {
        4: "194.242.2.9",
        6: "2a07:e340::9"
    }
};

const LOG_PRIORITY: Record<LogLevel, number> = {
    [LogLevel.VERBOSE]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3
};

interface DnsStatistics {
    totalRequests: number;
    successfulResolutions: number;
    failedResolutions: number;
    cacheHits: number;
    nativeCalls: number;
}

interface CacheEntry {
    addresses: string[];
    expiresAt: number;
    family: DnsFamily;
    hostname: string;
    server: string;
}

interface CacheStats {
    cacheSize: number;
    cachedHostnames: string[];
    cacheEntries: Record<string, string[]>;
}

interface MullvadDNSApi {
    name: string;
    version: string;
    isActive(): boolean;
    start(): Promise<void>;
    stop(): void;
    getDNSTable(): Promise<Record<string, string[]>>;
    getCurrentEndpoint(): string;
    getCacheStats(): CacheStats;
    getStatistics(): DnsStatistics;
    clearStatistics(): void;
    clearCache(): number;
}

declare global {
    interface Window {
        MullvadDNS?: MullvadDNSApi;
    }
}

const settings = definePluginSettings({
    dnsProfile: {
        type: OptionType.SELECT,
        description: "Choose which Mullvad DNS profile to use.",
        options: [
            { label: "DNS", value: MullvadProfile.DNS },
            { label: "Adblock", value: MullvadProfile.ADBLOCK },
            { label: "Base", value: MullvadProfile.BASE, default: true },
            { label: "Extended", value: MullvadProfile.EXTENDED },
            { label: "Family", value: MullvadProfile.FAMILY },
            { label: "All", value: MullvadProfile.ALL }
        ]
    },
    resolverMode: {
        type: OptionType.SELECT,
        description: "Choose how Mullvad DNS should resolve hostnames.",
        options: [
            { label: "Automatic", value: MullvadResolveMode.AUTOMATIC, default: true },
            { label: "DNS over HTTPS", value: MullvadResolveMode.DOH },
            { label: "Plain DNS", value: MullvadResolveMode.PLAIN_DNS }
        ]
    },
    trackedDomains: {
        type: OptionType.STRING,
        description: "Domains to resolve, one per line.",
        default: DEFAULT_DOMAINS.join("\n"),
        multiline: true
    },
    excludedPatterns: {
        type: OptionType.STRING,
        description: "URL fragments to leave untouched, one per line.",
        default: DEFAULT_EXCLUDED_PATTERNS.join("\n"),
        multiline: true
    },
    preferIPv6: {
        type: OptionType.BOOLEAN,
        description: "Prefer IPv6 answers when Mullvad returns them.",
        default: false
    },
    rewriteFetch: {
        type: OptionType.BOOLEAN,
        description: "Rewrite fetch URLs to resolved IPs. This is experimental and can break HTTPS.",
        default: false,
        restartNeeded: true
    },
    preloadOnStart: {
        type: OptionType.BOOLEAN,
        description: "Preload DNS answers for tracked domains on startup.",
        default: true
    },
    cacheMinutes: {
        type: OptionType.SLIDER,
        description: "How long DNS answers stay cached.",
        markers: [1, 5, 15, 30, 60],
        default: DEFAULT_CACHE_MINUTES,
        stickToMarkers: true
    },
    requestTimeoutMs: {
        type: OptionType.SLIDER,
        description: "How long to wait before a DNS request times out.",
        markers: [1500, 3000, 5000, 10000],
        default: DEFAULT_TIMEOUT_MS,
        stickToMarkers: true
    },
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable detailed logging.",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications for DNS status changes.",
        default: false
    },
    autoStart: {
        type: OptionType.BOOLEAN,
        description: "Start the resolver when the plugin loads.",
        default: true
    },
    logLevel: {
        type: OptionType.SELECT,
        description: "Choose the logging level.",
        options: [
            { label: "Verbose", value: LogLevel.VERBOSE },
            { label: "Info", value: LogLevel.INFO, default: true },
            { label: "Warning", value: LogLevel.WARN },
            { label: "Error", value: LogLevel.ERROR }
        ]
    }
});

function shouldLog(level: LogLevel) {
    return settings.store.enableLogging && LOG_PRIORITY[level] >= LOG_PRIORITY[settings.store.logLevel ?? LogLevel.INFO];
}

const log = {
    verbose: (...message: unknown[]) => {
        if (shouldLog(LogLevel.VERBOSE)) logger.debug(...message);
    },
    info: (...message: unknown[]) => {
        if (shouldLog(LogLevel.INFO)) logger.info(...message);
    },
    warn: (...message: unknown[]) => {
        if (shouldLog(LogLevel.WARN)) logger.warn(...message);
    },
    error: (...message: unknown[]) => {
        if (shouldLog(LogLevel.ERROR)) logger.error(...message);
    }
};

function showPluginToast(message: string, type = Toasts.Type.MESSAGE) {
    if (settings.store.showNotifications) {
        showToast(`[MullvadDNS] ${message}`, type);
    }
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function getConfiguredLines(value: string | undefined, fallback: string[]) {
    const lines = (value ?? "")
        .split("\n")
        .map(line => line.trim().toLowerCase())
        .filter(Boolean)
        .map(line => line.startsWith("*.") ? line.slice(2) : line);

    return lines.length ? lines : fallback;
}

function getTrackedDomains() {
    return getConfiguredLines(settings.store.trackedDomains, DEFAULT_DOMAINS);
}

function getExcludedPatterns() {
    return getConfiguredLines(settings.store.excludedPatterns, DEFAULT_EXCLUDED_PATTERNS);
}

function hostnameMatches(hostname: string) {
    const normalizedHostname = hostname.toLowerCase();

    return getTrackedDomains().some(domain =>
        normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`)
    );
}

function shouldExcludeURL(url: URL) {
    const urlText = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
    return getExcludedPatterns().some(pattern => urlText.includes(pattern));
}

function getEndpoint() {
    return MULLVAD_ENDPOINTS[settings.store.dnsProfile ?? MullvadProfile.BASE];
}

function getPlainDnsServer(family = getLookupFamily()) {
    return MULLVAD_DNS_SERVERS[settings.store.dnsProfile ?? MullvadProfile.BASE][family];
}

function getResolverMode(): ResolveProtocol {
    return settings.store.resolverMode ?? MullvadResolveMode.AUTOMATIC;
}

function getLookupFamily(): DnsFamily {
    return settings.store.preferIPv6 ? 6 : 4;
}

function getCacheDurationMs() {
    return (settings.store.cacheMinutes ?? DEFAULT_CACHE_MINUTES) * MS_PER_MINUTE;
}

function getTimeoutMs() {
    return settings.store.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
}

function getCacheKey(hostname: string) {
    return `${getResolverMode()}:${getEndpoint()}:${getLookupFamily()}:${hostname.toLowerCase()}`;
}

function createFetchInput(input: RequestInfo | URL, url: string): RequestInfo | URL {
    if (!(input instanceof Request)) {
        return url;
    }

    return new Request(url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        mode: input.mode,
        credentials: input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        integrity: input.integrity,
        keepalive: input.keepalive,
        signal: input.signal
    });
}

function rewriteUrl(url: URL, address: string) {
    const rewrittenUrl = new URL(url.toString());
    const { port } = rewrittenUrl;
    const host = address.includes(":") ? `[${address}]` : address;

    rewrittenUrl.host = port ? `${host}:${port}` : host;
    return rewrittenUrl.toString();
}

export default definePlugin({
    name: "MullvadDNS",
    description: "Resolve Discord hosts through Mullvad DNS over HTTPS.",
    tags: ["Privacy", "Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,

    start() {
        const PLUGIN_NAME = "MullvadDNS";
        const VERSION = "2.1.0";

        const originalFetch = window.fetch;
        let fetchPatched: typeof window.fetch | null = null;
        let isActive = false;
        let startTimer: number | undefined;
        let startGeneration = 0;
        const dnsCache = new Map<string, CacheEntry>();
        const statistics: DnsStatistics = {
            totalRequests: 0,
            successfulResolutions: 0,
            failedResolutions: 0,
            cacheHits: 0,
            nativeCalls: 0
        };

        function cacheResult(cacheKey: string, result: MullvadResolveResult) {
            dnsCache.set(cacheKey, {
                addresses: result.addresses,
                expiresAt: Date.now() + getCacheDurationMs(),
                family: result.family,
                hostname: result.hostname,
                server: result.endpoint
            });
            while (dnsCache.size > DNS_CACHE_MAX) {
                const oldest = dnsCache.keys().next().value;
                if (!oldest) break;
                dnsCache.delete(oldest);
            }
        }

        async function resolveHostname(hostname: string): Promise<CacheEntry | null> {
            const cacheKey = getCacheKey(hostname);
            const cached = dnsCache.get(cacheKey);

            if (cached && cached.expiresAt > Date.now()) {
                statistics.cacheHits++;
                log.verbose(`Cache hit for ${hostname}.`);
                return cached;
            }

            dnsCache.delete(cacheKey);

            if (!Native) {
                log.error("Native resolver is not available.");
                return null;
            }

            statistics.nativeCalls++;
            const result = await Native.resolveDNS(hostname, getEndpoint(), getLookupFamily(), getTimeoutMs(), getResolverMode(), getPlainDnsServer());

            if (result.success && result.addresses.length) {
                cacheResult(cacheKey, result);
                log.info(`Resolved ${hostname} to ${result.addresses[0]} with Mullvad ${result.protocol}.`);
                return dnsCache.get(cacheKey) ?? null;
            }

            if (settings.store.preferIPv6) {
                statistics.nativeCalls++;
                const fallback = await Native.resolveDNS(hostname, getEndpoint(), 4, getTimeoutMs(), getResolverMode(), getPlainDnsServer(4));

                if (fallback.success && fallback.addresses.length) {
                    cacheResult(cacheKey, fallback);
                    log.info(`Resolved ${hostname} to ${fallback.addresses[0]} with Mullvad ${fallback.protocol}.`);
                    return dnsCache.get(cacheKey) ?? null;
                }

                log.warn(`DNS lookup failed for ${hostname}: ${fallback.error ?? result.error ?? "No addresses returned."}`);
                return null;
            }

            log.warn(`DNS lookup failed for ${hostname}: ${result.error ?? "No addresses returned."}`);
            return null;
        }

        async function preloadRecords() {
            await Promise.all(getTrackedDomains().map(domain => resolveHostname(domain)));
            log.info(`Preloaded ${dnsCache.size} DNS cache entries.`);
        }

        function patchFetch() {
            if (fetchPatched) return true;

            const patchedFetch: typeof window.fetch = async (input, init) => {
                try {
                    const urlText = input instanceof Request ? input.url : String(input);
                    const url = new URL(urlText);

                    statistics.totalRequests++;

                    if (!hostnameMatches(url.hostname) || shouldExcludeURL(url)) {
                        log.verbose(`Skipped ${url.hostname}${url.pathname}.`);
                        return originalFetch.call(window, input, init);
                    }

                    const result = await resolveHostname(url.hostname);
                    if (!result) {
                        statistics.failedResolutions++;
                        return originalFetch.call(window, input, init);
                    }

                    const address = result.addresses[0];
                    const rewrittenUrl = rewriteUrl(url, address);
                    const rewrittenInput = createFetchInput(input, rewrittenUrl);

                    statistics.successfulResolutions++;
                    log.info(`Rewrote ${url.hostname} to ${address}.`);
                    showPluginToast(`Resolved ${url.hostname} through Mullvad.`, Toasts.Type.SUCCESS);

                    return originalFetch.call(window, rewrittenInput, init);
                } catch (error) {
                    statistics.failedResolutions++;
                    log.error(`Fetch patch error: ${getErrorMessage(error)}`);
                    return originalFetch.call(window, input, init);
                }
            };

            window.fetch = patchedFetch;
            fetchPatched = patchedFetch;
            log.info("Fetch patch enabled.");
            return true;
        }

        const MullvadDNS: MullvadDNSApi = {
            name: PLUGIN_NAME,
            version: VERSION,
            isActive: () => isActive,

            async start() {
                const generation = ++startGeneration;
                if (isActive) {
                    log.warn("Plugin is already active.");
                    return;
                }

                if (!Native) {
                    log.error("Native resolver is not available.");
                    showPluginToast("Native resolver is not available.", Toasts.Type.FAILURE);
                    return;
                }

                log.info(`Starting ${PLUGIN_NAME} ${VERSION} with ${getEndpoint()}.`);
                log.info(`Resolver mode: ${getResolverMode()}.`);

                if (settings.store.preloadOnStart) {
                    await preloadRecords();
                    if (generation !== startGeneration) return;
                }

                if (settings.store.rewriteFetch) {
                    log.warn("Fetch URL rewriting is experimental and can break HTTPS requests.");

                    if (!patchFetch()) {
                        showPluginToast("Fetch patch failed.", Toasts.Type.FAILURE);
                        return;
                    }
                } else {
                    log.info("Fetch rewrite is disabled. DNS results are available through the debug API.");
                }

                isActive = true;
                showPluginToast(`${PLUGIN_NAME} activated.`, Toasts.Type.SUCCESS);
            },

            stop() {
                startGeneration++;
                if (startTimer != null) {
                    window.clearTimeout(startTimer);
                    startTimer = undefined;
                }

                if (fetchPatched && window.fetch === fetchPatched) {
                    window.fetch = originalFetch;
                    log.info("Fetch restored.");
                } else if (fetchPatched) {
                    log.warn("Fetch changed after MullvadDNS patched it, so it was left untouched.");
                }

                fetchPatched = null;
                dnsCache.clear();
                if (!isActive) {
                    log.warn("Plugin is not active.");
                    return;
                }
                isActive = false;

                showPluginToast(`${PLUGIN_NAME} deactivated.`);
                log.info("Plugin stopped.");
            },

            async getDNSTable() {
                const results = await Promise.all(getTrackedDomains().map(async domain => {
                    const result = await resolveHostname(domain);
                    return [domain, result?.addresses ?? []] as const;
                }));

                return Object.fromEntries(results);
            },

            getCurrentEndpoint: () => getEndpoint(),
            getCacheStats: () => ({
                cacheSize: dnsCache.size,
                cachedHostnames: Array.from(dnsCache.values()).map(entry => entry.hostname),
                cacheEntries: Object.fromEntries(Array.from(dnsCache.values()).map(entry => [entry.hostname, entry.addresses]))
            }),
            getStatistics: () => ({ ...statistics }),
            clearStatistics() {
                statistics.totalRequests = 0;
                statistics.successfulResolutions = 0;
                statistics.failedResolutions = 0;
                statistics.cacheHits = 0;
                statistics.nativeCalls = 0;
                log.info("Statistics cleared.");
            },
            clearCache() {
                const { size } = dnsCache;
                dnsCache.clear();
                log.info(`Cleared ${size} DNS cache entries.`);
                return size;
            }
        };

        if (settings.store.autoStart) {
            startTimer = window.setTimeout(() => {
                void MullvadDNS.start();
            }, START_DELAY_MS);
        } else {
            log.info("Auto start is disabled.");
        }

        window.MullvadDNS = MullvadDNS;
        log.info(`${PLUGIN_NAME} ${VERSION} loaded.`);
    },

    stop() {
        try {
            window.MullvadDNS?.stop();
            window.MullvadDNS = undefined;
            log.info("Plugin unloaded.");
        } catch (error) {
            log.error(`Error during shutdown: ${getErrorMessage(error)}`);
        }
    }
});
