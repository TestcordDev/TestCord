/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Resolver } from "dns";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 15000;
const MAX_PRELOAD_HOSTNAMES = 100;
const MAX_DNS_SERVERS = 5;
const resolverCache = new Map();
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function normalizeServers(servers) {
    return servers
        .map(server => server.trim())
        .filter(Boolean)
        .slice(0, MAX_DNS_SERVERS);
}
function getTimeoutMs(timeoutMs) {
    return Math.max(1000, Math.min(timeoutMs, MAX_TIMEOUT_MS));
}
function getResolver(servers) {
    const cacheKey = servers.join(",");
    const cachedResolver = resolverCache.get(cacheKey);
    if (cachedResolver)
        return cachedResolver;
    const resolver = new Resolver();
    resolver.setServers(servers);
    resolverCache.set(cacheKey, resolver);
    return resolver;
}
function withTimeout(promise, timeoutMs) {
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("DNS request timed out.")), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout != null)
            clearTimeout(timeout);
    });
}
function resolveWithResolver(resolver, hostname, family) {
    return new Promise((resolve, reject) => {
        const callback = (error, addresses) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(addresses);
        };
        if (family === 6) {
            resolver.resolve6(hostname, callback);
            return;
        }
        resolver.resolve4(hostname, callback);
    });
}
async function resolveHost(hostname, servers, family, timeoutMs) {
    const normalizedServers = normalizeServers(servers);
    if (!normalizedServers.length) {
        return {
            success: false,
            hostname,
            server: "",
            family,
            addresses: [],
            error: "No DNS servers configured."
        };
    }
    try {
        const resolver = getResolver(normalizedServers);
        const addresses = await withTimeout(resolveWithResolver(resolver, hostname, family), getTimeoutMs(timeoutMs));
        return {
            success: addresses.length > 0,
            hostname,
            server: normalizedServers.join(", "),
            family,
            addresses,
            error: addresses.length > 0 ? undefined : "No addresses returned."
        };
    }
    catch (error) {
        return {
            success: false,
            hostname,
            server: normalizedServers.join(", "),
            family,
            addresses: [],
            error: getErrorMessage(error)
        };
    }
}
export async function resolveDNS(_event, hostname, servers, family = 4, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return resolveHost(hostname, servers, family, timeoutMs);
}
export async function preloadDNS(_event, hostnames, servers, family = 4, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const results = await Promise.all(hostnames.slice(0, MAX_PRELOAD_HOSTNAMES).map(async (hostname) => {
        const result = await resolveHost(hostname, servers, family, timeoutMs);
        return [hostname, result.addresses];
    }));
    return Object.fromEntries(results.filter(([, addresses]) => addresses.length));
}
