/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, net, session } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export type BlockOutcome = "blocked" | "stripped" | "monitored" | "alert";
export type HostRule = "allow" | "block";

export interface BlockedEventLog {
    id: string;
    timestamp: number;
    url: string;
    action: string;
    category: string;
    domain: string;
    outcome: BlockOutcome;
}

export interface AllowedEventLog {
    id: string;
    timestamp: number;
    url: string;
    domain: string;
    method: string;
    resourceType: string;
    routeGroup?: string;
}

export interface SecurityAlert {
    id: string;
    timestamp: number;
    url: string;
    domain: string;
    keyword: string;
    message: string;
    acknowledged: boolean;
}

export interface CoveredSurfacesState {
    scienceAnalytics: boolean;
    metrics: boolean;
    sentry: boolean;
    experimentalTracing: boolean;
    experimentalRtcDiagnostics: boolean;
    experimentalRemoteLogging: boolean;
    tokenGuard: boolean;
    webhookGuard: boolean;
    remoteCodeGuard: boolean;
    fetchXhrBeacon: boolean;
    linkTrackerGuard: boolean;
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
    experimentalTracing: false,
    experimentalRtcDiagnostics: false,
    experimentalRemoteLogging: false,
    tokenGuard: true,
    webhookGuard: true,
    remoteCodeGuard: true,
    fetchXhrBeacon: true,
    linkTrackerGuard: true
};

const BLOCKED_PATTERNS = [
    "/api/v*/science",
    "/api/v*/track",
    "/api/v*/metrics",
    "sentry.io"
];

// Wildcard patterns are compiled once here instead of being rebuilt with
// new RegExp on every intercepted request (that ran for ALL traffic).
const BLOCKED_PATTERN_REGEXES = BLOCKED_PATTERNS
    .filter(p => p.includes("*"))
    .map(p => new RegExp(p.replace(/\*/g, ".*")));
const BLOCKED_PATTERN_SUBSTRINGS = BLOCKED_PATTERNS.filter(p => !p.includes("*"));

// Hosts that are considered first-party (Discord itself). Everything else is
// third-party. Note: ReviewDB / manti.vendicated.dev is intentionally NOT here
// — it receives your Discord token and is treated as an untrusted third party.
const FIRST_PARTY_HOSTS = [
    "discord.com",
    "discordapp.com",
    "discordapp.net",
    "discord.gg",
    "discord.media",
    "discord.dev"
];

// Substrings in a script/code URL that indicate a likely malicious payload.
// A match triggers a hard block + immediate user alert.
const MALICIOUS_KEYWORDS = [
    "rat",
    "stealer",
    "keylogger",
    "grabber",
    "tokengrab",
    "token-grab",
    "webhookspam",
    "nitrogen",
    "exfil",
    "backdoor",
    "trojan",
    "infostealer",
    "discordrat"
];

// Extensions that represent fetchable, runnable code.
const CODE_EXTENSION_REGEX = /\.(?:js|mjs|cjs|wasm|ts)$/;

// Boundary-compiled once: threat scanning used to build a fresh RegExp per
// keyword on every scanned URL.
const MALICIOUS_KEYWORD_REGEXES = MALICIOUS_KEYWORDS.map(kw => ({
    keyword: kw,
    pattern: new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`)
}));

// Explicit allowlist of known tracking/attribution query parameters that are
// safe to strip. This is deliberately an allowlist (delete only these) rather
// than a denylist (delete everything unfamiliar), so load-bearing params a site
// needs for routing or content are never touched. Matched case-insensitively.
const TRACKING_PARAMS = [
    // Google Analytics / Urchin
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_id", "utm_name", "utm_cid", "utm_reader", "utm_referrer",
    // Google Ads / DoubleClick
    "gclid", "dclid", "gclsrc", "gbraid", "wbraid", "gad_source",
    // Facebook / Meta
    "fbclid", "fb_action_ids", "fb_action_types", "fb_source", "fb_ref",
    // Microsoft / Bing
    "msclkid",
    // Instagram
    "igshid", "igsh",
    // TikTok
    "ttclid",
    // Twitter / X
    "twclid",
    // LinkedIn
    "li_fat_id",
    // Reddit
    "rdt_cid",
    // Snapchat
    "sccid",
    // Pinterest
    "epik",
    // Impact / Commission Junction affiliate attribution
    "irclickid", "cjevent",
    // Mailchimp
    "mc_eid", "mc_cid",
    // HubSpot
    "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp", "hsctatracking",
    // Yandex
    "yclid", "_openstat",
    // Marketo / Vero / Piwik / Matomo
    "mkt_tok", "vero_id", "vero_conv", "pk_campaign", "pk_kwd", "pk_source", "pk_medium"
];

// Params that look like tracking but are load-bearing on specific hosts and
// must never be stripped there. Keyed by hostname suffix. "si" carries session
// state on YouTube/Spotify; "ref" routes content on some platforms.
const PARAM_STRIP_EXCEPTIONS: Record<string, string[]> = {
    "youtube.com": ["si"],
    "youtu.be": ["si"],
    "spotify.com": ["si"],
    "open.spotify.com": ["si"]
};

function isFirstParty(host: string): boolean {
    return FIRST_PARTY_HOSTS.some(h => host === h || host.endsWith("." + h));
}

class TrafficGuardEngine {
    private isInitialized = false;
    private shields: CoveredSurfacesState = { ...DEFAULT_SURFACES };
    private counters = {
        totalBlocked: 0,
        totalStripped: 0,
        tracking: 0,
        network: 0,
        tokens: 0,
        webhooks: 0,
        remoteCode: 0,
        sentry: 0,
        metrics: 0,
        linkTracker: 0
    };
    private logs: BlockedEventLog[] = [];
    private maxLogs = 500;
    private allowedLogs: AllowedEventLog[] = [];
    private maxAllowedLogs = 1000;
    private alerts: SecurityAlert[] = [];
    private maxAlerts = 100;

    private hostRules = new Map<string, HostRule>();
    private hostRulesPath = "";

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
        },
        {
            id: "badge_spoofer",
            title: "Badge Spoofer (/api/v9/science)",
            status: "Permitted",
            endpoints: ["discord.com/api/v9/science?source=badge_spoofer", "badge_spoofer"],
            description: "Permits spoofed playtime and game-launch telemetry for profile badge progression without being blocked by Science / Analytics shields",
            count: 0,
            blockedCount: 0
        }
    ];

    public init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.loadHostRules();
        this.setupWebRequestInterceptors();
    }

    // ---- Host rule persistence -------------------------------------------

    private resolveHostRulesPath(): string {
        if (this.hostRulesPath) return this.hostRulesPath;
        let base: string;
        try {
            base = app.getPath("userData");
        } catch {
            base = ".";
        }
        this.hostRulesPath = join(base, "TestCordHostRules.json");
        return this.hostRulesPath;
    }

    private loadHostRules() {
        try {
            const path = this.resolveHostRulesPath();
            if (!existsSync(path)) return;
            const raw = readFileSync(path, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                if (typeof parsed.maxLogs === "number" && parsed.maxLogs >= 50) {
                    this.maxLogs = parsed.maxLogs;
                    this.maxAllowedLogs = parsed.maxLogs;
                }
                if (parsed.shields && typeof parsed.shields === "object") {
                    for (const [key, value] of Object.entries(parsed.shields)) {
                        if (key in DEFAULT_SURFACES && typeof value === "boolean") {
                            this.shields[key as keyof CoveredSurfacesState] = value;
                        }
                    }
                }
                const rulesObj = parsed.rules && typeof parsed.rules === "object" ? parsed.rules : parsed;
                for (const [host, rule] of Object.entries(rulesObj)) {
                    if (rule === "allow" || rule === "block") {
                        this.hostRules.set(host, rule);
                    }
                }
            }
        } catch {
            // Corrupt or unreadable rules file — start clean rather than crash.
            this.hostRules.clear();
            this.shields = { ...DEFAULT_SURFACES };
        }
    }

    private saveHostRules() {
        try {
            const path = this.resolveHostRulesPath();
            const dir = dirname(path);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const rules: Record<string, HostRule> = {};
            for (const [host, rule] of this.hostRules) rules[host] = rule;
            const obj = {
                maxLogs: this.maxLogs,
                shields: { ...this.shields },
                rules
            };
            writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
        } catch {
            // Best-effort persistence; an I/O failure must not break traffic handling.
        }
    }

    public getMaxLogs(): number {
        return this.maxLogs;
    }

    public setMaxLogs(limit: number): number {
        const num = Math.max(50, Math.min(20000, Math.floor(limit)));
        this.maxLogs = num;
        this.maxAllowedLogs = num;
        while (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }
        while (this.allowedLogs.length > this.maxAllowedLogs) {
            this.allowedLogs.pop();
        }
        this.saveHostRules();
        return this.maxLogs;
    }

    private ruleForHost(host: string): HostRule | undefined {
        if (this.hostRules.has(host)) return this.hostRules.get(host);
        // Match subdomains against a rule set on the parent host.
        for (const [ruleHost, rule] of this.hostRules) {
            if (host === ruleHost || host.endsWith("." + ruleHost)) return rule;
        }
        return undefined;
    }

    public getHostRules(): Record<string, HostRule> {
        const obj: Record<string, HostRule> = {};
        for (const [host, rule] of this.hostRules) obj[host] = rule;
        return obj;
    }

    public setHostRule(host: string, rule: HostRule) {
        if (!host) return this.getHostRules();
        this.hostRules.set(host, rule);
        this.saveHostRules();
        return this.getHostRules();
    }

    public clearHostRule(host: string) {
        this.hostRules.delete(host);
        this.saveHostRules();
        return this.getHostRules();
    }

    // ---- Threat scanning --------------------------------------------------

    private scanPathForThreat(loweredPath: string): string | null {
        const segments = loweredPath.split("/").filter(Boolean);
        for (const { keyword, pattern } of MALICIOUS_KEYWORD_REGEXES) {
            if (segments.some(seg => pattern.test(seg))) return keyword;
        }
        return null;
    }

    // Returns a cleaned URL if any allowlisted tracking params were present, or
    // null if nothing needed stripping. Only removes params on the explicit
    // allowlist, and honours per-host exceptions for load-bearing params.
    private stripTrackingParams(url: string): string | null {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return null;
        }

        // No query string means nothing to strip.
        if (!parsed.search) return null;

        const host = parsed.hostname.toLowerCase();
        const exceptions = new Set<string>();
        for (const [suffix, params] of Object.entries(PARAM_STRIP_EXCEPTIONS)) {
            if (host === suffix || host.endsWith("." + suffix)) {
                for (const p of params) exceptions.add(p.toLowerCase());
            }
        }

        // Build a case-insensitive lookup of the params actually present, so we
        // can delete the real key regardless of its casing.
        const removed: string[] = [];
        const keys = [...parsed.searchParams.keys()];
        for (const key of keys) {
            const lower = key.toLowerCase();
            if (exceptions.has(lower)) continue;
            if (TRACKING_PARAMS.includes(lower)) {
                parsed.searchParams.delete(key);
                removed.push(key);
            }
        }

        if (removed.length === 0) return null;
        return parsed.toString();
    }

    private raiseAlert(url: string, domain: string, keyword: string) {
        const alert: SecurityAlert = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: Date.now(),
            url,
            domain,
            keyword,
            message: `Blocked a suspected malicious remote-code request to ${domain} (matched "${keyword}").`,
            acknowledged: false
        };
        this.alerts.unshift(alert);
        if (this.alerts.length > this.maxAlerts) this.alerts.pop();

        // Push immediately to any open renderer windows so the user is warned
        // without waiting for the next poll.
        try {
            for (const win of BrowserWindow.getAllWindows()) {
                win.webContents.send("TestCordPrivacySecurityAlert", alert);
            }
        } catch {
            // Renderer push is best-effort; the alert is still returned via getData.
        }
    }

    public getAlerts(): SecurityAlert[] {
        return [...this.alerts];
    }

    public acknowledgeAlerts() {
        this.alerts = this.alerts.map(a => ({ ...a, acknowledged: true }));
        return this.getAlerts();
    }

    // ---- Interceptors -----------------------------------------------------

    private setupWebRequestInterceptors() {
        const filter = { urls: ["<all_urls>"] };

        session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
            const { url } = details;

            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                return callback({ cancel: false });
            }

            // One parse per request; everything below reuses these parts.
            let parsedUrl: URL;
            try {
                parsedUrl = new URL(url);
            } catch {
                parsedUrl = null as unknown as URL;
            }
            const host = parsedUrl?.hostname ?? url;
            const loweredPath = parsedUrl ? parsedUrl.pathname.toLowerCase() : "";

            // Explicit per-host block rule — cancel outright.
            if (this.ruleForHost(host) === "block") {
                this.counters.totalBlocked++;
                this.trackOutboundRoute(url, true);
                this.logBlockedEvent(url, "Blocked by Host Rule", "hostRule", "blocked");
                return callback({ cancel: true });
            }

            // Remote-code guard: inspect fetchable code from non-first-party hosts.
            if (this.shields.remoteCodeGuard && !isFirstParty(host) && CODE_EXTENSION_REGEX.test(loweredPath)) {
                const keyword = this.scanPathForThreat(loweredPath);
                if (keyword) {
                    // Malicious signature — hard block + immediate alert.
                    this.counters.totalBlocked++;
                    this.counters.remoteCode++;
                    this.trackOutboundRoute(url, true);
                    this.logBlockedEvent(url, `Malicious Remote Code Blocked ("${keyword}")`, "remoteCode", "alert");
                    this.raiseAlert(url, host, keyword);
                    return callback({ cancel: true });
                }
                // No signature — log for visibility and let it through. Counted
                // and logged only here so the request isn't double-bookkept in
                // the allowed list as well.
                this.logBlockedEvent(url, "Remote Code Observed", "remoteCode", "monitored");
                this.trackOutboundRoute(url, false);
                return callback({ cancel: false });
            }

            // Telemetry blocking. Each surface owns its patterns exclusively:
            // turning a specific shield off stops its requests even while the
            // generic Fetch/XHR/Beacon shield is on. The generic shield only
            // applies to telemetry-shaped patterns none of the specific
            // shields already claimed.
            const path = loweredPath;
            const isDiscordApi = isFirstParty(host) && path.includes("/api/");
            const isBadgeSpoofer = isDiscordApi && (url.includes("source=badge_spoofer") || url.includes("badge_spoofer=true") || url.includes("badge_spoofer=1"));

            // Badge Spoofer: Explicitly permit spoofed playtime & game telemetry payloads through without telemetry shield blocking
            if (isBadgeSpoofer) {
                this.trackOutboundRoute(url, false);
                this.logAllowedEvent(url, details.method, details.resourceType, host);
                return callback({ cancel: false });
            }

            const isScienceTrack = isDiscordApi && (path.includes("/science") || path.includes("/track"));
            const isMetrics = isDiscordApi && path.includes("/metrics");
            const isSentry = url.includes("sentry.io");
            const isTracing = isDiscordApi && /\/tracing(?:\/|$)/.test(path);
            const isRtcDiagnostics = isDiscordApi && /\/(?:rtc|voice)\/(?:quality-report|diagnostics)(?:\/|$)/.test(path);
            const isRemoteLogging = isDiscordApi && /\/debug-logs?(?:\/|$)/.test(path);
            const isResidualPattern = !isSentry && !isMetrics && !isScienceTrack && (
                BLOCKED_PATTERN_SUBSTRINGS.some(p => url.includes(p))
                || BLOCKED_PATTERN_REGEXES.some(re => re.test(url))
            );

            const shouldBlockTelemetry =
                (isSentry && this.shields.sentry)
                || (isMetrics && this.shields.metrics)
                || (isScienceTrack && this.shields.scienceAnalytics)
                || (isTracing && this.shields.experimentalTracing)
                || (isRtcDiagnostics && this.shields.experimentalRtcDiagnostics)
                || (isRemoteLogging && this.shields.experimentalRemoteLogging)
                || (isResidualPattern && this.shields.fetchXhrBeacon);

            if (shouldBlockTelemetry) {
                this.counters.totalBlocked++;
                this.counters.network++;
                if (isSentry) this.counters.sentry++;
                else if (isMetrics) this.counters.metrics++;
                else this.counters.tracking++;

                this.trackOutboundRoute(url, true);

                let category = "tracking";
                if (isSentry) category = "sentry";
                else if (isMetrics) category = "metrics";
                else if (isTracing) category = "tracing";
                else if (isRtcDiagnostics) category = "rtcDiagnostics";
                else if (isRemoteLogging) category = "remoteLogging";

                this.logBlockedEvent(url, "Dropped & Stripped", category, "blocked");
                return callback({ cancel: true });
            }

            // Webhook guard: observe and log, but let the request through.
            // Logged only here so it doesn't also appear in the allowed list.
            if (url.includes("/api/webhooks/") && this.shields.webhookGuard) {
                this.counters.webhooks++;
                this.logBlockedEvent(url, "Webhook Payload Monitored", "webhooks", "monitored");
                this.trackOutboundRoute(url, false);
                return callback({ cancel: false });
            }

            // Link tracker stripper: remove allowlisted tracking params from
            // links the user opens. Gated to top-level navigations only
            // (details.resourceType === "mainFrame") so background API/XHR/fetch
            // traffic is never rewritten mid-flight — a functional query param on
            // some third-party API call must not be stripped. First-party hosts
            // are skipped entirely, so Discord's own params are left untouched.
            if (this.shields.linkTrackerGuard && !isFirstParty(host) && details.resourceType === "mainFrame") {
                const cleaned = this.stripTrackingParams(url);
                if (cleaned && cleaned !== url) {
                    this.counters.totalStripped++;
                    this.counters.linkTracker++;
                    this.logBlockedEvent(url, `Tracking Params Stripped \u2192 ${cleaned}`, "linkTracker", "stripped");
                    // The redirected request re-enters this interceptor and is
                    // counted as allowed there; don't count it here as well.
                    return callback({ redirectURL: cleaned });
                }
            }

            this.trackOutboundRoute(url, false);
            this.logAllowedEvent(url, details.method, details.resourceType, host);
            callback({ cancel: false });
        });

        session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
            const { url } = details;

            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                return callback({ requestHeaders: details.requestHeaders });
            }

            let host = "";
            try {
                host = new URL(url).hostname;
            } catch {
                host = url;
            }

            const isDiscordDomain = isFirstParty(host);
            const rule = this.ruleForHost(host);

            // An explicit allow rule means the user trusts this host with the
            // token — do not strip.
            if (rule === "allow") {
                return callback({ requestHeaders: details.requestHeaders });
            }

            const shouldStrip = details.requestHeaders
                && details.requestHeaders.Authorization
                && (!isDiscordDomain || rule === "block")
                && (this.shields.tokenGuard || rule === "block");

            if (shouldStrip) {
                delete details.requestHeaders.Authorization;
                this.counters.totalStripped++;
                this.counters.tokens++;
                this.logBlockedEvent(url, "Authorization Header Stripped", "tokens", "stripped");
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

    public logBlockedEvent(url: string, action: string, category: string, outcome: BlockOutcome = "blocked", knownDomain?: string) {
        let domain = knownDomain ?? "unknown";
        if (!domain || domain === "unknown") {
            try {
                domain = new URL(url).hostname;
            } catch {
                domain = url;
            }
        }

        const log: BlockedEventLog = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: Date.now(),
            url,
            action,
            category,
            domain,
            outcome
        };

        this.logs.unshift(log);
        if (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }
    }

    public logAllowedEvent(url: string, method = "GET", resourceType = "xhr", knownDomain?: string) {
        let domain = knownDomain ?? "unknown";
        if (!domain || domain === "unknown") {
            try {
                domain = new URL(url).hostname;
            } catch {
                domain = url;
            }
        }

        let routeGroup = "Outbound";
        for (const route of this.outboundRoutes) {
            if (route.endpoints.some(ep => url.includes(ep))) {
                routeGroup = route.title;
                break;
            }
        }

        const log: AllowedEventLog = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: Date.now(),
            url,
            domain,
            method: method || "GET",
            resourceType: resourceType || "xhr",
            routeGroup
        };

        this.allowedLogs.unshift(log);
        if (this.allowedLogs.length > this.maxAllowedLogs) {
            this.allowedLogs.pop();
        }
    }

    public getAllowedLogs(): AllowedEventLog[] {
        return [...this.allowedLogs];
    }

    public clearAllowedLogs() {
        this.allowedLogs = [];
    }

    public incrementCounter(key: keyof typeof this.counters, amount = 1, url?: string) {
        if (this.counters[key] !== undefined) {
            this.counters[key] += amount;

            const isStrip = key === "tokens";
            if (key !== "totalBlocked" && key !== "totalStripped") {
                if (isStrip) this.counters.totalStripped += amount;
                else this.counters.totalBlocked += amount;
            }

            // Renderer-patch reports carry no real request URL. Use a synthetic
            // testcord:// URL so the log entry is visibly not an intercepted
            // network request instead of fabricating a plausible-looking one.
            const targetUrl = url || `testcord://renderer-patch/${key}`;
            let action = "Blocked by renderer patch";
            let outcome: BlockOutcome = "blocked";
            if (key === "tokens") { action = "Authorization Header Stripped"; outcome = "stripped"; }
            else if (key === "sentry") action = "Sentry Telemetry Blocked";
            else if (key === "metrics") action = "Metrics Reporting Disabled";

            for (let i = 0; i < amount; i++) {
                this.logBlockedEvent(targetUrl, action, key as string, outcome);
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
            // Persist so a shield's state survives restarts, like host rules.
            this.saveHostRules();
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

    public async postScienceEvents(payload: any, token?: string, cookie?: string, superProps?: string): Promise<{ status: number; body?: any; error?: string }> {
        return new Promise(resolve => {
            try {
                const bodyStr = JSON.stringify(payload);
                const req = net.request({
                    method: "POST",
                    protocol: "https:",
                    hostname: "discord.com",
                    path: "/api/v9/science?source=badge_spoofer"
                });

                req.setHeader("content-type", "application/json");
                req.setHeader("accept", "*/*");
                if (token) req.setHeader("authorization", token);
                if (cookie) req.setHeader("cookie", cookie);
                if (superProps) req.setHeader("x-super-properties", superProps);
                req.setHeader("x-badge-spoofer", "1");

                req.on("response", res => {
                    let resData = "";
                    res.on("data", chunk => resData += chunk.toString());
                    res.on("end", () => {
                        this.trackOutboundRoute("https://discord.com/api/v9/science?source=badge_spoofer", false);
                        this.logAllowedEvent("https://discord.com/api/v9/science?source=badge_spoofer", "POST", "xhr");
                        resolve({ status: res.statusCode, body: resData });
                    });
                });

                req.on("error", err => {
                    resolve({ status: 0, error: err.message });
                });

                req.write(bodyStr);
                req.end();
            } catch (err: any) {
                resolve({ status: 0, error: err.message || String(err) });
            }
        });
    }
}

export const trafficGuard = new TrafficGuardEngine();
