/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Resolver } from "dns";

export type DnsFamily = 4 | 6;
export type ResolveProtocol = "automatic" | "doh" | "plain_dns";

export interface MullvadResolveResult {
    success: boolean;
    hostname: string;
    endpoint: string;
    family: DnsFamily;
    addresses: string[];
    protocol: Exclude<ResolveProtocol, "automatic">;
    error?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 15000;
const MAX_PRELOAD_HOSTNAMES = 100;
const MAX_DOH_RESPONSE_BYTES = 4096;
const ALLOWED_DOH_HOSTS = new Set([
    "dns.mullvad.net",
    "adblock.dns.mullvad.net",
    "base.dns.mullvad.net",
    "extended.dns.mullvad.net",
    "family.dns.mullvad.net",
    "all.dns.mullvad.net"
]);
const DNS_HEADER_LENGTH = 12;
const DNS_CLASS_IN = 1;
const DNS_TYPE_A = 1;
const DNS_TYPE_AAAA = 28;
const DNS_FLAGS_RECURSION_DESIRED = 0x0100;
const DNS_POINTER_MASK = 0xc0;
const DNS_RESPONSE_CODE_MASK = 0x000f;

const resolverCache = new Map<string, Resolver>();

function getErrorMessage(error: unknown) {
    if (!(error instanceof Error)) return String(error);
    if (error.cause instanceof Error) return `${error.message}: ${error.cause.message}`;
    return error.message;
}

function getTimeoutMs(timeoutMs: number) {
    return Math.max(1000, Math.min(timeoutMs, MAX_TIMEOUT_MS));
}

function isAllowedDohEndpoint(endpoint: string) {
    try {
        const url = new URL(endpoint);
        return url.protocol === "https:" && url.pathname === "/dns-query" && ALLOWED_DOH_HOSTS.has(url.hostname);
    } catch {
        return false;
    }
}

async function readArrayBuffer(response: Response) {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_DOH_RESPONSE_BYTES) {
        throw new Error("DNS response was too large.");
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_DOH_RESPONSE_BYTES) {
        throw new Error("DNS response was too large.");
    }

    return buffer;
}

function pushUint16(bytes: number[], value: number) {
    bytes.push((value >> 8) & 0xff, value & 0xff);
}

function getQueryType(family: DnsFamily) {
    return family === 6 ? DNS_TYPE_AAAA : DNS_TYPE_A;
}

function encodeDnsQuery(hostname: string, family: DnsFamily) {
    const bytes: number[] = [];

    pushUint16(bytes, 0);
    pushUint16(bytes, DNS_FLAGS_RECURSION_DESIRED);
    pushUint16(bytes, 1);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);

    for (const label of hostname.split(".")) {
        const encodedLabel = new TextEncoder().encode(label);
        bytes.push(encodedLabel.length);

        for (const byte of encodedLabel) {
            bytes.push(byte);
        }
    }

    bytes.push(0);
    pushUint16(bytes, getQueryType(family));
    pushUint16(bytes, DNS_CLASS_IN);

    return new Uint8Array(bytes);
}

function readUint16(view: DataView, offset: number) {
    if (offset + 2 > view.byteLength) throw new Error("Invalid DNS response.");
    return view.getUint16(offset);
}

function skipName(message: Uint8Array, offset: number) {
    let currentOffset = offset;

    while (currentOffset < message.length) {
        const length = message[currentOffset];

        if ((length & DNS_POINTER_MASK) === DNS_POINTER_MASK) {
            return currentOffset + 2;
        }

        if (length === 0) {
            return currentOffset + 1;
        }

        currentOffset += length + 1;
    }

    throw new Error("Invalid DNS name.");
}

function formatIPv6(message: Uint8Array, offset: number) {
    const groups: string[] = [];

    for (let index = 0; index < 16; index += 2) {
        groups.push(((message[offset + index] << 8) | message[offset + index + 1]).toString(16));
    }

    return groups.join(":");
}

function parseDnsResponse(message: Uint8Array, family: DnsFamily) {
    if (message.length < DNS_HEADER_LENGTH) {
        throw new Error("DNS response was too short.");
    }

    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    const responseCode = readUint16(view, 2) & DNS_RESPONSE_CODE_MASK;

    if (responseCode !== 0) {
        throw new Error(`DNS returned response code ${responseCode}.`);
    }

    const questionCount = readUint16(view, 4);
    const answerCount = readUint16(view, 6);
    const expectedType = getQueryType(family);
    const addresses: string[] = [];
    let offset = DNS_HEADER_LENGTH;

    for (let index = 0; index < questionCount; index++) {
        offset = skipName(message, offset) + 4;
    }

    for (let index = 0; index < answerCount; index++) {
        offset = skipName(message, offset);

        if (offset + 10 > message.length) {
            throw new Error("DNS answer was incomplete.");
        }

        const recordType = readUint16(view, offset);
        const recordClass = readUint16(view, offset + 2);
        const dataLength = readUint16(view, offset + 8);
        const dataOffset = offset + 10;

        if (dataOffset + dataLength > message.length) {
            throw new Error("DNS answer data was incomplete.");
        }

        if (recordClass === DNS_CLASS_IN && recordType === expectedType) {
            if (family === 4 && dataLength === 4) {
                addresses.push(Array.from(message.slice(dataOffset, dataOffset + dataLength)).join("."));
            }

            if (family === 6 && dataLength === 16) {
                addresses.push(formatIPv6(message, dataOffset));
            }
        }

        offset = dataOffset + dataLength;
    }

    return addresses;
}

function getResolver(server: string) {
    const cachedResolver = resolverCache.get(server);
    if (cachedResolver) return cachedResolver;

    const resolver = new Resolver();
    resolver.setServers([server]);
    resolverCache.set(server, resolver);
    return resolver;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("DNS request timed out.")), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout != null) clearTimeout(timeout);
    });
}

function resolvePlainDns(hostname: string, server: string, family: DnsFamily) {
    const resolver = getResolver(server);

    return new Promise<string[]>((resolve, reject) => {
        const callback = (error: NodeJS.ErrnoException | null, addresses: string[]) => {
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

async function resolveDoh(hostname: string, endpoint: string, family: DnsFamily, timeoutMs: number): Promise<MullvadResolveResult> {
    try {
        if (!isAllowedDohEndpoint(endpoint)) throw new Error("DoH endpoint is not allowed.");

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Accept: "application/dns-message",
                "Content-Type": "application/dns-message"
            },
            body: encodeDnsQuery(hostname, family),
            signal: AbortSignal.timeout(getTimeoutMs(timeoutMs))
        });

        if (!response.ok) {
            throw new Error(`Mullvad DNS returned ${response.status}.`);
        }

        const addresses = parseDnsResponse(new Uint8Array(await readArrayBuffer(response)), family);

        return {
            success: addresses.length > 0,
            hostname,
            endpoint,
            family,
            addresses,
            protocol: "doh",
            error: addresses.length > 0 ? undefined : "No addresses returned."
        };
    } catch (error) {
        return {
            success: false,
            hostname,
            endpoint,
            family,
            addresses: [],
            protocol: "doh",
            error: getErrorMessage(error)
        };
    }
}

async function resolvePlain(hostname: string, endpoint: string, server: string, family: DnsFamily, timeoutMs: number): Promise<MullvadResolveResult> {
    try {
        const addresses = await withTimeout(resolvePlainDns(hostname, server, family), getTimeoutMs(timeoutMs));

        return {
            success: addresses.length > 0,
            hostname,
            endpoint,
            family,
            addresses,
            protocol: "plain_dns",
            error: addresses.length > 0 ? undefined : "No addresses returned."
        };
    } catch (error) {
        return {
            success: false,
            hostname,
            endpoint,
            family,
            addresses: [],
            protocol: "plain_dns",
            error: getErrorMessage(error)
        };
    }
}

export async function resolveDNS(
    _event: Electron.IpcMainInvokeEvent,
    hostname: string,
    endpoint: string,
    family: DnsFamily = 4,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    protocol: ResolveProtocol = "automatic",
    plainDnsServer = ""
) {
    if (protocol === "plain_dns") {
        return resolvePlain(hostname, endpoint, plainDnsServer, family, timeoutMs);
    }

    const dohResult = await resolveDoh(hostname, endpoint, family, timeoutMs);
    if (dohResult.success || protocol === "doh" || !plainDnsServer) return dohResult;

    const plainResult = await resolvePlain(hostname, endpoint, plainDnsServer, family, timeoutMs);
    if (plainResult.success) return plainResult;

    return {
        ...plainResult,
        error: `${dohResult.error ?? "DoH failed."} Plain DNS fallback failed: ${plainResult.error ?? "No addresses returned."}`
    };
}

export async function preloadDNS(
    _event: Electron.IpcMainInvokeEvent,
    hostnames: string[],
    endpoint: string,
    family: DnsFamily = 4,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    protocol: ResolveProtocol = "automatic",
    plainDnsServer = ""
) {
    const results = await Promise.all(hostnames.slice(0, MAX_PRELOAD_HOSTNAMES).map(async hostname => {
        const result = await resolveDNS(_event, hostname, endpoint, family, timeoutMs, protocol, plainDnsServer);
        return [hostname, result.addresses] as const;
    }));

    return Object.fromEntries(results.filter(([, addresses]) => addresses.length));
}
