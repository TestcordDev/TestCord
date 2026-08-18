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
// Our wrappers stay installed even when stopped if someone wrapped fetch/XHR
// after us — restoring would clobber theirs. While `enabled` is false the
// wrappers simply pass through, so nothing records and nothing breaks.
let fetchInstalled = false;
let xhrInstalled = false;
let originalFetch: typeof window.fetch | null = null;
let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;

const records: NetworkRequestRecord[] = [];
const listeners = new Set<() => void>();

function fetchWrapper(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    if (!enabled) return originalFetch!.call(this, input as any, init);
    const url = typeof input === "string" ? input
        : input instanceof URL ? input.href
        : input.url;
    const method = init?.method ?? "GET";
    // Capture the stack synchronously: inside the .then callback the plugin's
    // frames are gone and attribution would always come back "unknown".
    const stack = captureStack();
    const promise = originalFetch!.call(this, input as any, init);
    promise.then(
        res => record(url, method, res.status, stack),
        () => record(url, method, 0, stack)
    );
    return promise;
}

function xhrOpenWrapper(this: XMLHttpRequest, method: string, url: string, ...rest: any[]) {
    const xhr = this as any;
    xhr.__vc_net_method = method;
    try {
        xhr.__vc_net_url = new URL(String(url), location.href).href;
    } catch {
        xhr.__vc_net_url = String(url);
    }
    return (originalXhrOpen as any).call(this, method, url, ...rest);
}

function xhrSendWrapper(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const xhr = this as any;
    xhr.__vc_net_stack = captureStack();
    // One listener per XHR instance, refreshed implicitly on reuse — multiple
    // send() calls must not stack duplicate loadend listeners.
    if (!xhr.__vc_net_listener) {
        xhr.__vc_net_listener = function (this: XMLHttpRequest) {
            const self = this as any;
            if (!self.__vc_net_url) return;
            record(self.__vc_net_url, self.__vc_net_method ?? "GET", this.status, self.__vc_net_stack ?? "");
        };
        xhr.addEventListener("loadend", xhr.__vc_net_listener);
    }
    return originalXhrSend!.call(this, body);
}

function isDiscordDomain(domain: string): boolean {
    const lower = domain.toLowerCase();
    return DISCORD_DOMAINS.some(d => lower === d || lower.endsWith("." + d));
}

function captureStack(): string {
    try {
        return new Error().stack ?? "";
    } catch {
        return "";
    }
}

function guessPluginFromStack(stack: string): string {
    try {
        for (const pattern of PLUGIN_PATH_PATTERNS) {
            const match = stack.match(pattern);
            if (match) return match[1];
        }
    } catch {
        // Stack inspection is best-effort.
    }
    return "unknown";
}

function extractDomain(url: string): string | null {
    try {
        // Resolve against the page origin so relative URLs (same-origin
        // Discord traffic) attribute to the page host instead of an
        // "invalid" pseudo-domain.
        return new URL(url, location.href).hostname;
    } catch {
        return null;
    }
}

function record(url: string, method: string, status: number, stack: string) {
    const domain = extractDomain(url);
    // Unparsable URLs are not attributed to anything useful — skip them.
    if (!domain || isDiscordDomain(domain)) return;

    const plugin = guessPluginFromStack(stack);
    records.push({ url, method: method.toUpperCase(), domain, plugin, at: Date.now(), status });

    if (records.length > MAX_RECORDS) records.shift();

    notify();
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

        if (!fetchInstalled) {
            originalFetch = window.fetch;
            window.fetch = fetchWrapper as typeof window.fetch;
            fetchInstalled = true;
        }

        if (!xhrInstalled) {
            originalXhrOpen = XMLHttpRequest.prototype.open;
            originalXhrSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = xhrOpenWrapper as typeof XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.send = xhrSendWrapper as typeof XMLHttpRequest.prototype.send;
            xhrInstalled = true;
        }

        void DataStore.set(DB_KEY_PREF, true);
        notify();
    },

    /**
     * Stop intercepting. Restores the originals only when our wrappers are
     * still the outermost — if something wrapped fetch/XHR after us, we leave
     * the chain intact and just pass through, so their patches survive.
     */
    stop() {
        if (!enabled) return;
        enabled = false;

        if (fetchInstalled && window.fetch === (fetchWrapper as typeof window.fetch)) {
            window.fetch = originalFetch!;
            originalFetch = null;
            fetchInstalled = false;
        }
        if (xhrInstalled
            && XMLHttpRequest.prototype.open === (xhrOpenWrapper as typeof XMLHttpRequest.prototype.open)
            && XMLHttpRequest.prototype.send === (xhrSendWrapper as typeof XMLHttpRequest.prototype.send)
        ) {
            XMLHttpRequest.prototype.open = originalXhrOpen!;
            XMLHttpRequest.prototype.send = originalXhrSend!;
            originalXhrOpen = originalXhrSend = null;
            xhrInstalled = false;
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
