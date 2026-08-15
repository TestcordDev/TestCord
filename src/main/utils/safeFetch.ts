/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { lookup } from "dns/promises";
import { BlockList } from "net";

const privateNetworks = new BlockList();
for (const [subnet, bits] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
    ["64:ff9b::", 96]
] as const) {
    privateNetworks.addSubnet(subnet, bits);
}

function isPrivateAddress(address: string): boolean {
    const normalized = address.startsWith("::ffff:") && address.includes(".")
        ? address.slice(7)
        : address.replace(/^\[|\]$/g, "");
    return privateNetworks.check(normalized) || privateNetworks.check(address);
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
