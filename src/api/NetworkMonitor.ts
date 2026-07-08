/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Lightweight network egress monitor.
 *
 * Wraps `window.fetch` and `XMLHttpRequest` to record requests that go to
 * non-Discord hosts — i.e. requests that are likely from plugins phoning home
 * rather than Discord's own API/CDN traffic.
 *
 * Each request is attributed to a plugin (best-effort) by inspecting the
 * call stack for known plugin folder names.
 *
 * The monitor is opt-in: it does nothing until `NetworkMonitor.start()` is
 * called. It can be toggled from the Plugin Health tab.
 */

import * as DataStore from "@api/DataStore";

export interface NetworkRequestRecord {
    url: string;
    method: string;
    domain: string;
    /** Best-effort plugin name from stack trace, or "unknown". */
    plugin: string;
    /** ms since epoch. */
    at: number;
    /** HTTP status (0 if the request failed before getting a response). */
    status: number;
}

export interface NetworkDomainSummary {
    domain: string;
    totalRequests: number;
    plugins: Set<string>;
    lastAt: number;
    lastUrl: string;
}

const MAX_RECORDS = 500;
const DB_KEY_PREF = "NetworkMonitor_enabled";

const DISCORD_DOMAINS = [
    "discord.com",
    "discordapp.com",
    "discordapp.net",
    "discord-attachments.com",
    "discord.media",
    "gateway.discord.gg",
    "cdn.discordapp.com",
    "images.discordapp.net",
    "media.discordapp.net",
    "assets.discordapp.net",
    "discord.gg",
    "discordstatus.com",
    "equicord.org",
    "vencord.dev",
    "github.com",
    "raw.githubusercontent.com",
    "cdn.jsdelivr.net",
    "unpkg.com"
];

const PLUGIN_PATH_PATTERNS = [
    /testcordplugins[/\\]([^/\\]+?)[/\\]/,
    /equicordplugins[/\\]([^/\\]+?)[/\\]/,
    /userplugins[/\\]([^/\\]+?)[/\\]/,
    /[/\\]plugins[/\\]([^/\\]+?)[/\\]/
];

let enabled = false;
let originalFetch: typeof window.fetch | null = null;
let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;

const records: NetworkRequestRecord[] = [];
const listeners = new Set<() => void>();

function isDiscordDomain(domain: string): boolean {
    const lower = domain.toLowerCase();
    return DISCORD_DOMAINS.some(d => lower === d || lower.endsWith("." + d));
}

function guessPluginFromStack(): string {
    try {
        const stack = new Error().stack ?? "";
        for (const pattern of PLUGIN_PATH_PATTERNS) {
            const match = stack.match(pattern);
            if (match) return match[1];
        }
    } catch {
        // Stack inspection is best-effort.
    }
    return "unknown";
}

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return "invalid";
    }
}

function record(url: string, method: string, status: number) {
    const domain = extractDomain(url);
    if (isDiscordDomain(domain)) return;

    const plugin = guessPluginFromStack();
    records.push({ url, method: method.toUpperCase(), domain, plugin, at: Date.now(), status });

    if (records.length > MAX_RECORDS) records.shift();

    for (const listener of listeners) {
        try { listener(); } catch { /* ignore */ }
    }
}

function notify() {
    for (const listener of listeners) {
        try { listener(); } catch { /* ignore */ }
    }
}

export const NetworkMonitor = {
    /** Whether the monitor is currently intercepting requests. */
    isEnabled() { return enabled; },

    /** Start intercepting fetch and XHR. Safe to call multiple times. */
    start() {
        if (enabled) return;
        enabled = true;

        // --- fetch ---
        originalFetch = window.fetch;
        window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
            const url = typeof input === "string" ? input
                : input instanceof URL ? input.href
                : input.url;
            const method = init?.method ?? "GET";
            const promise = originalFetch!.call(this, input as any, init);
            promise.then(
                res => record(url, method, res.status),
                () => record(url, method, 0)
            );
            return promise;
        };

        // --- XMLHttpRequest ---
        originalXhrOpen = XMLHttpRequest.prototype.open;
        originalXhrSend = XMLHttpRequest.prototype.send;

        const origOpen = originalXhrOpen as any;
        const origSend = originalXhrSend as any;

        XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string, ...rest: any[]) {
            (this as any).__vc_net_method = method;
            (this as any).__vc_net_url = url;
            return origOpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
            const url = (this as any).__vc_net_url ?? "";
            const method = (this as any).__vc_net_method ?? "GET";
            this.addEventListener("loadend", () => {
                record(url, method, this.status);
            });
            return origSend.call(this, body);
        };

        void DataStore.set(DB_KEY_PREF, true);
        notify();
    },

    /** Stop intercepting and restore originals. */
    stop() {
        if (!enabled) return;
        enabled = false;

        if (originalFetch) {
            window.fetch = originalFetch;
            originalFetch = null;
        }
        if (originalXhrOpen) {
            XMLHttpRequest.prototype.open = originalXhrOpen;
            originalXhrOpen = null;
        }
        if (originalXhrSend) {
            XMLHttpRequest.prototype.send = originalXhrSend;
            originalXhrSend = null;
        }

        void DataStore.set(DB_KEY_PREF, false);
        notify();
    },

    /** Toggle on/off. Returns the new state. */
    toggle() {
        if (enabled) this.stop();
        else this.start();
        return enabled;
    },

    /** Load the persisted enabled/disabled preference. */
    async loadPreference(): Promise<boolean> {
        try {
            const val = await DataStore.get<boolean>(DB_KEY_PREF);
            return val === true;
        } catch {
            return false;
        }
    },

    /** Get all recorded requests (newest last). */
    getRecords(): readonly NetworkRequestRecord[] {
        return records;
    },

    /** Get aggregated per-domain summaries (sorted by request count, desc). */
    getDomainSummaries(): NetworkDomainSummary[] {
        const map = new Map<string, NetworkDomainSummary>();
        for (const r of records) {
            let s = map.get(r.domain);
            if (!s) {
                s = { domain: r.domain, totalRequests: 0, plugins: new Set(), lastAt: 0, lastUrl: "" };
                map.set(r.domain, s);
            }
            s.totalRequests++;
            if (r.plugin !== "unknown") s.plugins.add(r.plugin);
            if (r.at > s.lastAt) {
                s.lastAt = r.at;
                s.lastUrl = r.url;
            }
        }
        return [...map.values()].sort((a, b) => b.totalRequests - a.totalRequests);
    },

    /** Clear all recorded requests. */
    clearRecords() {
        if (records.length === 0) return;
        records.length = 0;
        notify();
    },

    /** Subscribe to changes. Returns an unsubscribe function. */
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
};
