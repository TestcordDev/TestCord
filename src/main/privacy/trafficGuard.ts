/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { session } from "electron";

export interface BlockedEventLog {
    id: string;
    timestamp: number;
    url: string;
    action: string;
    category: string;
    domain: string;
}

export interface CoveredSurfacesState {
    scienceAnalytics: boolean;
    metrics: boolean;
    sentry: boolean;
    tokenGuard: boolean;
    clipboardGuard: boolean;
    webhookGuard: boolean;
    remoteCodeGuard: boolean;
    updateIntegrity: boolean;
    fetchXhrBeacon: boolean;
    customFiltering: boolean;
}

export interface OutboundRouteGroup {
    id: string;
    title: string;
    status: string;
    endpoints: string[];
    description: string;
    count: number;
    blockedCount: number;
}

const DEFAULT_SURFACES: CoveredSurfacesState = {
    scienceAnalytics: true,
    metrics: true,
    sentry: true,
    tokenGuard: true,
    clipboardGuard: true,
    webhookGuard: true,
    remoteCodeGuard: true,
    updateIntegrity: true,
    fetchXhrBeacon: true,
    customFiltering: true
};

const BLOCKED_PATTERNS = [
    "/api/v*/science",
    "/api/v*/track",
    "/api/v*/metrics",
    "sentry.io"
];

class TrafficGuardEngine {
    private isInitialized = false;
    private shields: CoveredSurfacesState = { ...DEFAULT_SURFACES };
    private counters = {
        totalBlocked: 0,
        tracking: 0,
        network: 0,
        tokens: 0,
        clipboard: 0,
        webhooks: 0,
        remoteCode: 0,
        updateRefusals: 0
    };
    private logs: BlockedEventLog[] = [];
    private maxLogs = 500;

    private outboundRoutes: OutboundRouteGroup[] = [
        {
            id: "discord_api",
            title: "Discord API & Gateway",
            status: "Monitored",
            endpoints: ["discord.com/api", "gateway.discord.gg"],
            description: "Core messaging & real-time gateway connections",
            count: 0,
            blockedCount: 0
        },
        {
            id: "discord_media",
            title: "Discord Media & Assets",
            status: "Monitored",
            endpoints: ["cdn.discordapp.com", "media.discordapp.net"],
            description: "User avatars, attachments, and static assets",
            count: 0,
            blockedCount: 0
        },

        {
            id: "secure_connect",
            title: "Secure Connect Resolver",
            status: "Active",
            endpoints: ["cloudflare-dns.com", "dns.mullvad.net", "dns.quad9.net"],
            description: "Encrypted DoH/DoT resolution endpoints",
            count: 0,
            blockedCount: 0
        },
        {
            id: "ai_providers",
            title: "AI Provider APIs",
            status: "On Demand",
            endpoints: ["api.groq.com", "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com"],
            description: "LLM endpoint integration for AI plugins",
            count: 0,
            blockedCount: 0
        },
        {
            id: "plugin_services",
            title: "Optional Plugin Services",
            status: "Plugin Controlled",
            endpoints: ["api.github.com", "translate-pa.googleapis.com", "manti.vendicated.dev", "decor.fieryflames.dev"],
            description: "External theme & third-party plugin integrations",
            count: 0,
            blockedCount: 0
        }
    ];

    public init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.setupWebRequestInterceptors();
    }

    private setupWebRequestInterceptors() {
        const filter = { urls: ["<all_urls>"] };

        // 1. Network Level Telemetry & Surface Dropper
        session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
            const { url } = details;
            this.trackOutboundRoute(url, false);

            // Check if blocked by telemetry patterns or shields
            const isScienceTrack = (url.includes("/science") || url.includes("/track")) && this.shields.scienceAnalytics;
            const isMetrics = url.includes("/metrics") && this.shields.metrics;
            const isSentry = url.includes("sentry.io") && this.shields.sentry;
            const isPatternMatch = BLOCKED_PATTERNS.some(p => {
                if (p.includes("*")) {
                    const regex = new RegExp(p.replace(/\*/g, ".*"));
                    return regex.test(url);
                }
                return url.includes(p);
            });

            if ((isScienceTrack || isMetrics || isSentry || (isPatternMatch && this.shields.fetchXhrBeacon))) {
                this.counters.totalBlocked++;
                this.counters.tracking++;
                this.counters.network++;
                this.trackOutboundRoute(url, true);

                let category = "tracking";
                if (isSentry) category = "sentry";
                else if (isMetrics) category = "metrics";

                this.logBlockedEvent(url, "Dropped & Stripped", category);
                return callback({ cancel: true });
            }

            // Webhook monitoring guard
            if (url.includes("/api/webhooks/") && this.shields.webhookGuard) {
                this.counters.webhooks++;
                this.logBlockedEvent(url, "Webhook Payload Monitored", "webhooks");
            }

            callback({ cancel: false });
        });

        // 2. Token Guard Header Sanitizer
        session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
            const { url } = details;
            const isDiscordDomain = url.includes("discord.com") || url.includes("discordapp.com");

            if (!isDiscordDomain && details.requestHeaders.Authorization && this.shields.tokenGuard) {
                delete details.requestHeaders.Authorization;
                this.counters.totalBlocked++;
                this.counters.tokens++;
                this.logBlockedEvent(url, "Authorization Header Stripped", "tokens");
            }

            callback({ requestHeaders: details.requestHeaders });
        });
    }

    private trackOutboundRoute(url: string, blocked: boolean) {
        for (const route of this.outboundRoutes) {
            if (route.endpoints.some(ep => url.includes(ep))) {
                if (blocked) route.blockedCount++;
                else route.count++;
                break;
            }
        }
    }

    public logBlockedEvent(url: string, action: string, category: string) {
        let domain = "unknown";
        try {
            domain = new URL(url).hostname;
        } catch {
            domain = url;
        }

        const log: BlockedEventLog = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: Date.now(),
            url,
            action,
            category,
            domain
        };

        this.logs.unshift(log);
        if (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }
    }

    public incrementCounter(key: keyof typeof this.counters, amount = 1, url?: string) {
        if (this.counters[key] !== undefined) {
            this.counters[key] += amount;
            if (key !== "totalBlocked") {
                this.counters.totalBlocked += amount;
            }

            const targetUrl = url || (key === "tracking" ? "https://discord.com/api/v9/science" : "https://discord.com/api");
            let action = "Dropped & Stripped";
            if (key === "tokens") action = "Authorization Header Stripped";
            else if (key === "sentry") action = "Sentry Telemetry Blocked";
            else if (key === "metrics") action = "Metrics Reporting Disabled";

            for (let i = 0; i < amount; i++) {
                this.logBlockedEvent(targetUrl, action, key as string);
            }
        }
    }

    public getCounters() {
        return { ...this.counters };
    }

    public getShields(): CoveredSurfacesState {
        return { ...this.shields };
    }

    public setShield(key: keyof CoveredSurfacesState, value: boolean) {
        if (this.shields[key] !== undefined) {
            this.shields[key] = value;
        }
    }

    public getOutboundRoutes(): OutboundRouteGroup[] {
        return this.outboundRoutes.map(r => ({ ...r }));
    }

    public getLogs(): BlockedEventLog[] {
        return [...this.logs];
    }

    public clearLogs() {
        this.logs = [];
    }
}

export const trafficGuard = new TrafficGuardEngine();
