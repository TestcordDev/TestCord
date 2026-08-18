/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { lookup } from "dns/promises";

// Pure-JS range checks instead of net.BlockList: BlockList.addSubnet rejects
// IPv6 strings ("Invalid socket address") on several Electron/Node builds,
// which crashed the main process at module load.

function parseIPv4(addr: string): number | null {
    const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    let value = 0;
    for (let i = 1; i <= 4; i++) {
        const octet = Number(m[i]);
        if (octet > 255) return null;
        value = (value << 8) | octet;
    }
    return value >>> 0;
}

function parseIPv6(addr: string): bigint | null {
    let s = addr.replace(/^\[|\]$/g, "");

    if (s.includes(".")) {
        const idx = s.lastIndexOf(":");
        const embedded = parseIPv4(s.slice(idx + 1));
        if (idx === -1 || embedded === null) return null;
        s = s.slice(0, idx + 1) + ((embedded >>> 16) & 0xffff).toString(16) + ":" + (embedded & 0xffff).toString(16);
    }

    if ((s.match(/::/g) ?? []).length > 1) return null;
    if (s.includes("::")) {
        const [head = "", tail = ""] = s.split("::");
        const headGroups = head ? head.split(":") : [];
        const tailGroups = tail ? tail.split(":") : [];
        const missing = 8 - headGroups.length - tailGroups.length;
        if (missing < 0) return null;
        s = [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups].join(":");
    }

    const groups = s.split(":");
    if (groups.length !== 8) return null;

    let value = 0n;
    for (const g of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        value = (value << 16n) | BigInt(parseInt(g, 16));
    }
    return value;
}

const v4Range = (lo: string, hi: string) => {
    const loVal = parseIPv4(lo)!;
    const hiVal = parseIPv4(hi)!;
    return (ip: number) => ip >= loVal && ip <= hiVal;
};
const v6Range = (lo: string, hi: string) => {
    const loVal = parseIPv6(lo)!;
    const hiVal = parseIPv6(hi)!;
    return (ip: bigint) => ip >= loVal && ip <= hiVal;
};

// ::/96 covers unspecified, loopback and all IPv4-mapped/compatible addresses
const privateV4 = [
    v4Range("0.0.0.0", "0.255.255.255"),
    v4Range("10.0.0.0", "10.255.255.255"),
    v4Range("100.64.0.0", "100.127.255.255"),
    v4Range("127.0.0.0", "127.255.255.255"),
    v4Range("169.254.0.0", "169.254.255.255"),
    v4Range("172.16.0.0", "172.31.255.255"),
    v4Range("192.0.0.0", "192.0.0.255"),
    v4Range("192.168.0.0", "192.168.255.255"),
    v4Range("198.18.0.0", "198.19.255.255")
];
const privateV6 = [
    v6Range("::", "::ffff:ffff:ffff"),
    v6Range("fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"),
    v6Range("fe80::", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"),
    v6Range("64:ff9b::", "64:ff9b::ffff:ffff:ffff")
];

function isPrivateAddress(address: string): boolean {
    const normalized = address.startsWith("::ffff:") && address.includes(".")
        ? address.slice(7)
        : address.replace(/^\[|\]$/g, "");

    const asV4 = parseIPv4(normalized);
    if (asV4 !== null) return privateV4.some(inRange => inRange(asV4));

    const asV6 = parseIPv6(normalized);
    if (asV6 !== null) return privateV6.some(inRange => inRange(asV6));

    return false;
}

export interface SafeFetchOptions extends Omit<RequestInit, "redirect"> {
    /** Allowed hosts. Matches the host itself and its subdomains ("discord.com" allows "discord.com" and "canary.discord.com"). */
    allowedHosts?: readonly string[];
    /** Allow loopback/private/link-local targets. Renderer-controlled URLs must never enable this. */
    allowPrivateNetwork?: boolean;
    /** Redirect hops followed, re-validating every hop. Defaults to 3. */
    maxRedirects?: number;
}

export async function assertSafeUrl(rawUrl: string, options: Pick<SafeFetchOptions, "allowedHosts" | "allowPrivateNetwork"> = {}): Promise<URL> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error("Invalid URL");
    }

    if (url.protocol !== "https:") throw new Error("Only https URLs are allowed");

    if (options.allowedHosts && !options.allowedHosts.some(
        host => url.hostname === host || url.hostname.endsWith(`.${host}`)
    )) {
        throw new Error(`Host ${url.hostname} is not allowed`);
    }

    if (!options.allowPrivateNetwork) {
        const addresses = await lookup(url.hostname, { all: true });
        if (addresses.some(({ address }) => isPrivateAddress(address))) {
            throw new Error("Refusing to fetch a private network address");
        }
    }

    return url;
}

/**
 * fetch() for main-process natives handling renderer-controlled URLs.
 * Enforces https, optional host allowlist, blocks private/loopback targets and
 * re-validates every redirect hop. CSP and CORS do not apply to the main
 * process, so natives proxying renderer URLs through plain fetch() bypass both.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
    const { allowedHosts, allowPrivateNetwork, maxRedirects = 3, ...init } = options;

    let url = await assertSafeUrl(rawUrl, { allowedHosts, allowPrivateNetwork });
    let response = await fetch(url, { ...init, redirect: "manual" });

    for (let hops = 0; hops < maxRedirects && response.status >= 300 && response.status < 400; hops++) {
        const location = response.headers.get("location");
        if (!location) return response;
        url = await assertSafeUrl(new URL(location, url).toString(), { allowedHosts, allowPrivateNetwork });
        response = await fetch(url, { ...init, redirect: "manual" });
    }

    if (response.status >= 300 && response.status < 400) throw new Error("Too many redirects");
    return response;
}

/** response.text() with a size cap; content-length is checked first, then the streamed bytes. */
export async function readCappedText(response: Response, maxBytes = 8 * 1024 * 1024): Promise<string> {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) throw new Error("Response was too large");

    const reader = response.body?.getReader();
    if (!reader) return response.text();

    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) throw new Error("Response was too large");
        chunks.push(value);
    }

    return new TextDecoder().decode(concat(chunks, received));
}

function concat(chunks: Uint8Array[], totalBytes: number): Uint8Array {
    const out = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}
