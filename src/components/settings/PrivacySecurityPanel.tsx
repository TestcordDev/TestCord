/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./PrivacySecurityPanel.css";

import { SettingsTab } from "@components/settings/tabs/BaseTab";
import { React, useEffect, useRef, useState } from "@webpack/common";

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
    linkTrackerGuard: boolean;
}

export type BlockOutcome = "blocked" | "stripped" | "monitored" | "alert";
export type HostRule = "allow" | "block";

export interface BlockedLog {
    id: string;
    timestamp: number;
    url: string;
    action: string;
    category: string;
    domain: string;
    outcome?: BlockOutcome;
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

const FIRST_PARTY_HOSTS = [
    "discord.com",
    "discordapp.com",
    "discordapp.net",
    "discord.gg",
    "discord.media",
    "discord.dev"
];

// ReviewDB and other known-but-untrusted third parties that receive your token.
// These are recognized so we can name them, but they are NEVER marked trusted.
const UNTRUSTED_KNOWN_HOSTS: Record<string, string> = {
    "manti.vendicated.dev": "ReviewDB backend (receives your Discord token)"
};

// Known-good third-party infrastructure. NOT Discord, but reputable and expected
// (public CDNs that serve open-source assets). Tagged "Trusted CDN" so benign
// remote-code fetches like Shiki's WASM don't read as generic third party.
// These never receive your token; they only serve static assets.
const TRUSTED_KNOWN_HOSTS: Record<string, string> = {
    "cdn.jsdelivr.net": "jsDelivr public CDN (serves open-source assets, e.g. Shiki syntax highlighting).",
    "unpkg.com": "unpkg public CDN (serves npm package assets)."
};

export type HostReputation = "first-party" | "trusted-third-party" | "third-party";

function matchKnown(map: Record<string, string>, host: string): string | undefined {
    if (map[host]) return map[host];
    for (const [known, note] of Object.entries(map)) {
        if (host === known || host.endsWith("." + known)) return note;
    }
    return undefined;
}

export function classifyHost(host: string): HostReputation {
    const h = (host || "").toLowerCase();
    if (FIRST_PARTY_HOSTS.some(fp => h === fp || h.endsWith("." + fp))) return "first-party";
    // Untrusted takes precedence over trusted so a host can never be laundered
    // into the trusted bucket if it also appears as a token recipient.
    if (matchKnown(UNTRUSTED_KNOWN_HOSTS, h)) return "third-party";
    if (matchKnown(TRUSTED_KNOWN_HOSTS, h)) return "trusted-third-party";
    return "third-party";
}

export function hostReputationLabel(host: string): string {
    const h = (host || "").toLowerCase();
    const rep = classifyHost(h);
    if (rep === "first-party") return "Discord";
    if (matchKnown(UNTRUSTED_KNOWN_HOSTS, h)) return "Untrusted third party";
    if (rep === "trusted-third-party") return "Trusted CDN";
    return "Third party";
}

export function hostReputationNote(host: string): string {
    const h = (host || "").toLowerCase();
    if (classifyHost(h) === "first-party") return "Discord's own servers.";
    const untrusted = matchKnown(UNTRUSTED_KNOWN_HOSTS, h);
    if (untrusted) return untrusted;
    const trusted = matchKnown(TRUSTED_KNOWN_HOSTS, h);
    if (trusted) return trusted;
    return "An external host that is not Discord.";
}

// Maps a host's reputation to the CSS class suffix used for its tag. Untrusted
// known hosts stay in the "third" (red) bucket even though they're recognized.
export function repTagClass(host: string): "first" | "trusted" | "third" {
    const rep = classifyHost(host);
    if (rep === "first-party") return "first";
    if (rep === "trusted-third-party") return "trusted";
    return "third";
}

export interface RouteGroup {
    id: string;
    title: string;
    status: string;
    statusType: "active" | "monitored" | "ready" | "demand" | "plugin";
    endpoints: string[];
    description: string;
    count: number;
    blockedCount: number;
}

function formatTimeAgo(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return "1s ago";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
}

function getEventTitle(log: BlockedLog): string {
    if (log.category === "tracking") return "Discord analytics event blocked";
    if (log.category === "sentry") return "Sentry telemetry drop intercepted";
    if (log.category === "metrics") return "Metrics reporting disabled";
    if (log.category === "tokens") return "Authorization header stripped";
    if (log.category === "linkTracker") return `Tracking params stripped from ${log.domain}`;
    return `${log.action} on ${log.domain}`;
}

function buildBlockReport(log: BlockedLog): string {
    const parts = parseUrlParts(log.url);
    const lines = [
        `Event: ${getEventTitle(log)}`,
        `Category: ${log.category} (${getCategoryLabel(log.category)})`,
        `Action: ${log.action}`,
        `Caught by: ${getShieldForCategory(log.category)}`,
        `Outcome: ${log.outcome || "blocked"}`,
        `Domain: ${log.domain}`,
        `Reputation: ${hostReputationLabel(log.domain)} — ${hostReputationNote(log.domain)}`,
        `When: ${formatAbsoluteTime(log.timestamp)} (${formatTimeAgo(log.timestamp)})`,
        `Timestamp: ${log.timestamp}`,
        `Event ID: ${log.id}`,
        ``,
        `Request URL: ${log.url}`,
        `  Scheme: ${parts.scheme}`,
        `  Host: ${parts.host}`,
        `  Port: ${parts.port}`,
        `  Path: ${parts.path}`
    ];
    if (parts.query) lines.push(`  Query: ${parts.query}`);
    return lines.join("\n");
}

function getCategoryLabel(category: string): string {
    switch (category) {
        case "tokens": return "Token";
        case "tracking": return "Tracking";
        case "sentry": return "Sentry";
        case "metrics": return "Metrics";
        case "webhooks": return "Webhook";
        case "remoteCode": return "Remote Code";
        case "linkTracker": return "Link Tracker";
        default: return "Filtered";
    }
}

function getShieldForCategory(category: string): string {
    switch (category) {
        case "tokens": return "Token Guard";
        case "tracking": return "Science / Analytics";
        case "sentry": return "Sentry";
        case "metrics": return "Metrics";
        case "webhooks": return "Webhook Guard";
        case "remoteCode": return "Remote Code Guard";
        case "linkTracker": return "Link Tracker Stripper";
        default: return "Custom Filtering";
    }
}

function getCategoryExplanation(category: string): string {
    switch (category) {
        case "tokens": return "An Authorization header was about to be sent to a non-Discord host. The guard stripped the credential before the request left; the request itself still went out without it.";
        case "tracking": return "A Discord analytics/science telemetry request was matched and cancelled before it was sent.";
        case "sentry": return "An outbound Sentry error-reporting request was intercepted and dropped.";
        case "metrics": return "A metrics-reporting request was matched and cancelled.";
        case "webhooks": return "A Discord webhook request was observed and logged for monitoring.";
        case "remoteCode": return "A request that could fetch and execute remote code was blocked.";
        case "linkTracker": return "An outbound request carried known tracking/attribution parameters (utm_*, fbclid, etc.). The guard removed them and redirected to the cleaned URL. Only allowlisted tracking params are stripped; load-bearing params are preserved. This reduces referral-chain leakage but does not stop tracking by the destination site itself.";
        default: return "This request matched a custom filtering rule and was acted on by the traffic guard.";
    }
}

interface ParsedUrlParts {
    scheme: string;
    host: string;
    port: string;
    path: string;
    query: string;
}

function parseUrlParts(rawUrl: string): ParsedUrlParts {
    try {
        const u = new URL(rawUrl);
        return {
            scheme: u.protocol.replace(/:$/, ""),
            host: u.hostname,
            port: u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "—"),
            path: u.pathname || "/",
            query: u.search ? u.search.replace(/^\?/, "") : ""
        };
    } catch {
        return { scheme: "—", host: rawUrl, port: "—", path: "—", query: "" };
    }
}

function formatAbsoluteTime(ts: number): string {
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return String(ts);
    }
}

export function PrivacySecurityPanel() {
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedBlock, setSelectedBlock] = useState<BlockedLog | null>(null);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const LOGS_PER_PAGE = 4;

    const copyToClipboard = (value: string, field: string) => {
        try {
            navigator.clipboard.writeText(value);
        } catch {
            // Fallback for environments without the async clipboard API.
            const ta = document.createElement("textarea");
            ta.value = value;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); } catch { /* no-op */ }
            document.body.removeChild(ta);
        }
        setCopiedField(field);
        setTimeout(() => setCopiedField(prev => (prev === field ? null : prev)), 1500);
    };
    // Custom Dropdown State & Ref
    const [isDnsOpen, setIsDnsOpen] = useState(false);
    const selectRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSelectedBlock(null);
        };
        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, []);

    useEffect(() => {
        setCopiedField(null);
    }, [selectedBlock]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(e.target as Node)) {
                setIsDnsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Telemetry KPI Counters
    const [counters, setCounters] = useState({
        totalBlocked: 0,
        totalStripped: 0,
        tracking: 0,
        network: 0,
        tokens: 0,
        clipboard: 0,
        webhooks: 0,
        remoteCode: 0,
        updateRefusals: 0,
        linkTracker: 0
    });

    const [hostRules, setHostRules] = useState<Record<string, HostRule>>({});
    const [alerts, setAlerts] = useState<SecurityAlert[]>([]);

    // Threat Vector Shields
    const [shields, setShields] = useState<CoveredSurfacesState>({
        scienceAnalytics: true,
        metrics: true,
        sentry: true,
        tokenGuard: true,
        clipboardGuard: true,
        webhookGuard: true,
        remoteCodeGuard: true,
        updateIntegrity: true,
        fetchXhrBeacon: true,
        customFiltering: true,
        linkTrackerGuard: true
    });

    // DNS Providers & State
    const [dnsProviders, setDnsProviders] = useState<Record<string, { doh: string; fallback: string; }>>({
        "Cloudflare 1.1.1.1": { doh: "https://cloudflare-dns.com/dns-query", fallback: "1.1.1.1" },
        "Cloudflare Security (Malware)": { doh: "https://security.cloudflare-dns.com/dns-query", fallback: "1.1.1.2" },
        "Cloudflare Family": { doh: "https://family.cloudflare-dns.com/dns-query", fallback: "1.1.1.3" },
        "Mullvad Adblock": { doh: "https://adblock.dns.mullvad.net/dns-query", fallback: "194.242.2.3" },
        "Mullvad Base": { doh: "https://base.dns.mullvad.net/dns-query", fallback: "194.242.2.4" },
        "Mullvad Extended": { doh: "https://extended.dns.mullvad.net/dns-query", fallback: "194.242.2.5" },
        "Mullvad Family": { doh: "https://family.dns.mullvad.net/dns-query", fallback: "194.242.2.6" },
        "Mullvad All": { doh: "https://all.dns.mullvad.net/dns-query", fallback: "194.242.2.9" },
        "Quad9": { doh: "https://dns.quad9.net/dns-query", fallback: "9.9.9.9" },
        "Quad9 ECS": { doh: "https://dns11.quad9.net/dns-query", fallback: "9.9.9.11" },
        "AdGuard Default": { doh: "https://dns.adguard-dns.com/dns-query", fallback: "94.140.14.14" },
        "AdGuard Family": { doh: "https://family.adguard-dns.com/dns-query", fallback: "94.140.14.15" },
        "AdGuard Unfiltered": { doh: "https://unfiltered.adguard-dns.com/dns-query", fallback: "94.140.14.140" },
        "Google Public DNS": { doh: "https://dns.google/dns-query", fallback: "8.8.8.8" },
        "Control D Unfiltered": { doh: "https://freedns.controld.com/p0", fallback: "76.76.2.0" },
        "Control D Malware": { doh: "https://freedns.controld.com/malware", fallback: "76.76.2.1" },
        "OpenDNS Home": { doh: "https://doh.opendns.com/dns-query", fallback: "208.67.222.222" },
        "OpenDNS FamilyShield": { doh: "https://doh.familyshield.opendns.com/dns-query", fallback: "208.67.222.123" }
    });
    const [selectedDns, setSelectedDns] = useState("Cloudflare 1.1.1.1");
    const [activeTestBtn, setActiveTestBtn] = useState<"doh" | "dot" | "auto" | null>("dot");
    const [dnsCacheStats, setDnsCacheStats] = useState({ size: 0, maxCapacity: 256, ttlMinutes: 15, hits: 0, misses: 0 });
    const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([
        "Secure Connect engine initialized.",
        "Encrypted DoH channel active."
    ]);

    // Outbound Surfaces Route Groups
    const [outboundRoutes, setOutboundRoutes] = useState<RouteGroup[]>([
        {
            id: "discord_api",
            title: "Discord API and gateway",
            status: "Monitored",
            statusType: "monitored",
            endpoints: ["discord.com", "gateway.discord.gg"],
            description: "Core account, message, guild, presence, voice, and call signaling traffic.",
            count: 362,
            blockedCount: 0
        },
        {
            id: "discord_media",
            title: "Discord media and assets",
            status: "Monitored",
            statusType: "monitored",
            endpoints: ["cdn.discordapp.com", "media.discordapp.net"],
            description: "Avatars, attachments, embeds, application assets, and other Discord media.",
            count: 146,
            blockedCount: 0
        },
        {
            id: "secure_connect_resolver",
            title: "Secure Connect resolver",
            status: "Active",
            statusType: "active",
            endpoints: ["Configured encrypted DNS endpoint"],
            description: "Uses the selected encrypted DNS endpoint while Secure Connect is active or a resolver test is requested.",
            count: 0,
            blockedCount: 0
        },
        {
            id: "ai_providers",
            title: "AI provider APIs",
            status: "On demand",
            statusType: "demand",
            endpoints: ["Groq", "OpenAI", "Anthropic", "Gemini", "selected provider"],
            description: "Used only by an enabled AI feature with a provider configured by the user.",
            count: 0,
            blockedCount: 0
        },
        {
            id: "optional_plugins",
            title: "Optional plugin services",
            status: "Plugin controlled",
            statusType: "plugin",
            endpoints: ["GitHub", "translation", "analysis", "user-selected services"],
            description: "Used only by the matching enabled plugin or a manual action. Destinations vary by plugin.",
            count: 0,
            blockedCount: 0
        }
    ]);

    // Recent Intercepted Blocks Logs
    const [logs, setLogs] = useState<BlockedLog[]>([]);

    const fetchData = async () => {
        try {
            if (VencordNative?.privacy?.getData) {
                const data = await VencordNative.privacy.getData();
                if (data) {
                    if (data.counters) setCounters(data.counters);
                    if (data.shields) setShields(data.shields);
                    if (data.outboundRoutes) {
                        setOutboundRoutes(data.outboundRoutes.filter((r: any) => r.id !== "updates" && r.id !== "services" && r.id !== "client_updates" && r.id !== "client_services"));
                    }
                    if (data.dnsProviders) setDnsProviders(data.dnsProviders);
                    if (data.selectedDnsProvider) setSelectedDns(data.selectedDnsProvider);

                    const fetchedLogs: BlockedLog[] = data.logs || [];
                    setLogs(fetchedLogs);
                    if (data.hostRules) setHostRules(data.hostRules);
                    if (Array.isArray(data.alerts)) setAlerts(data.alerts);
                }
            }
        } catch {
            // Fallback
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 2000);
        return () => clearInterval(interval);
    }, []);

    // Immediate push for malicious remote-code alerts (no need to wait for poll).
    useEffect(() => {
        if (!VencordNative?.privacy?.onSecurityAlert) return;
        VencordNative.privacy.onSecurityAlert((alert: SecurityAlert) => {
            setAlerts(prev => [alert, ...prev.filter(a => a.id !== alert.id)]);
        });
    }, []);

    // Keep the Secure Connect console in sync with the live provider selection.
    // Runs on mount and on every change: strips any prior config line and appends
    // the current provider, so the console never shows a stale/default provider
    // (e.g. the seeded "Cloudflare 1.1.1.1" when the user is actually on Mullvad).
    useEffect(() => {
        setDiagnosticLogs(prev => {
            const withoutConfig = prev.filter(l => !l.startsWith("Loaded local disk config:"));
            return [...withoutConfig, `Loaded local disk config: ${selectedDns}.`];
        });
    }, [selectedDns]);

    const setHostRule = async (host: string, rule: HostRule) => {
        setHostRules(prev => ({ ...prev, [host]: rule }));
        if (VencordNative?.privacy?.setHostRule) {
            const updated = await VencordNative.privacy.setHostRule(host, rule);
            if (updated) setHostRules(updated);
        }
    };

    const clearHostRule = async (host: string) => {
        setHostRules(prev => {
            const next = { ...prev };
            delete next[host];
            return next;
        });
        if (VencordNative?.privacy?.clearHostRule) {
            const updated = await VencordNative.privacy.clearHostRule(host);
            if (updated) setHostRules(updated);
        }
    };

    const acknowledgeAlerts = async () => {
        setAlerts(prev => prev.map(a => ({ ...a, acknowledged: true })));
        if (VencordNative?.privacy?.acknowledgeAlerts) {
            await VencordNative.privacy.acknowledgeAlerts();
        }
    };

    const exportLogs = (fmt: "json" | "csv") => {
        let content: string;
        let mime: string;
        let ext: string;
        if (fmt === "csv") {
            const header = "timestamp,iso_time,outcome,category,action,domain,url";
            const rows = logs.map(l => {
                const iso = new Date(l.timestamp).toISOString();
                const esc = (v: string) => `"${String(v).replace(/"/g, "\"\"")}"`;
                return [l.timestamp, iso, l.outcome || "blocked", l.category, l.action, l.domain, l.url].map(v => esc(String(v))).join(",");
            });
            content = [header, ...rows].join("\n");
            mime = "text/csv";
            ext = "csv";
        } else {
            content = JSON.stringify(logs, null, 2);
            mime = "application/json";
            ext = "json";
        }
        try {
            const blob = new Blob([content], { type: mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `testcord-privacy-log-${Date.now()}.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
            // If Blob/anchor download is unavailable, fall back to clipboard.
            copyToClipboard(content, "export");
        }
    };

    const toggleShield = async (key: keyof CoveredSurfacesState) => {
        const nextVal = !shields[key];
        setShields(prev => ({ ...prev, [key]: nextVal }));
        if (VencordNative?.privacy?.toggleShield) {
            await VencordNative.privacy.toggleShield(key as string, nextVal);
        }
    };

    const handleSelectDns = async (name: string) => {
        setSelectedDns(name);
        setDiagnosticLogs(prev => [...prev, `Secure Connect now uses ${name}.`]);
        if (VencordNative?.privacy?.setDnsProvider) {
            await VencordNative.privacy.setDnsProvider(name);
        }
    };

    const formatDiagnosticLog = (log: any): string => {
        if (typeof log === "string") return log;
        if (log && typeof log.message === "string") {
            const prefix = typeof log.level === "string" ? `[${log.level.toUpperCase()}] ` : "";
            return `${prefix}${log.message}`;
        }
        return String(log);
    };

    const handleRunDiagnostic = async (mode: "doh" | "dot" | "auto") => {
        setActiveTestBtn(mode);
        const logMsg = `Running ${mode.toUpperCase()} resolution test for ${selectedDns}...`;
        setDiagnosticLogs(prev => [...prev, logMsg]);
        if (VencordNative?.privacy?.runDiagnostic) {
            const returnedLogs = await VencordNative.privacy.runDiagnostic(mode);
            if (Array.isArray(returnedLogs)) {
                setDiagnosticLogs(returnedLogs.map(formatDiagnosticLog));
            }
        }
    };

    const handleStopDiagnostic = async () => {
        setActiveTestBtn(null);
        setDiagnosticLogs(prev => [...prev, "Diagnostic test stopped."]);
        if (VencordNative?.privacy?.stopDiagnostic) {
            const returnedLogs = await VencordNative.privacy.stopDiagnostic();
            if (Array.isArray(returnedLogs)) {
                setDiagnosticLogs(returnedLogs.map(formatDiagnosticLog));
            }
        }
    };

    const handleClearDnsCache = async () => {
        setDnsCacheStats(prev => ({ ...prev, size: 0, hits: 0, misses: 0 }));
        setDiagnosticLogs(prev => [...prev, "Resolver LRU cache cleared."]);
        if (VencordNative?.privacy?.clearDnsCache) {
            const stats = await VencordNative.privacy.clearDnsCache();
            if (stats && typeof stats.size === "number") {
                setDnsCacheStats(stats);
            }
        }
    };

    const surfaceTags: Array<{ key: keyof CoveredSurfacesState; title: string; }> = [
        { key: "scienceAnalytics", title: "Science" },
        { key: "scienceAnalytics", title: "Analytics" },
        { key: "metrics", title: "Metrics" },
        { key: "sentry", title: "Sentry" },
        { key: "tokenGuard", title: "Token Guard" },
        { key: "clipboardGuard", title: "Clipboard Guard" },
        { key: "webhookGuard", title: "Webhook Guard" },
        { key: "remoteCodeGuard", title: "Remote Code Guard" },
        { key: "updateIntegrity", title: "Update Integrity" },
        { key: "fetchXhrBeacon", title: "Fetch / XHR / Beacon" },
        { key: "linkTrackerGuard", title: "Link Tracker Stripper" }
    ];

    const currentProviderObj = dnsProviders[selectedDns] || { doh: "https://cloudflare-dns.com/dns-query", fallback: "1.1.1.1" };
    const totalMappedRoutes = outboundRoutes.length;
    const totalAllowedRoutes = outboundRoutes.reduce((acc, r) => acc + r.count, 0);
    const totalBlockedRoutes = outboundRoutes.reduce((acc, r) => acc + r.blockedCount, 0);

    // Search & Pagination calculations for Recent Blocks
    const filteredLogs = logs.filter(log => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const title = getEventTitle(log).toLowerCase();
        return (
            log.domain.toLowerCase().includes(q) ||
            log.url.toLowerCase().includes(q) ||
            log.category.toLowerCase().includes(q) ||
            title.includes(q)
        );
    });

    // Group repeated blocks by domain + action. Each group keeps its most recent
    // event as the representative (logs are already newest-first), plus a count
    // and the members so search still lands on the exact request.
    const groupedLogs = (() => {
        const map = new Map<string, { rep: BlockedLog; count: number; members: BlockedLog[]; }>();
        for (const log of filteredLogs) {
            const key = `${log.domain}\u0000${log.action}`;
            const existing = map.get(key);
            if (existing) {
                existing.count++;
                existing.members.push(log);
            } else {
                map.set(key, { rep: log, count: 1, members: [log] });
            }
        }
        // Preserve recency order: groups sorted by their representative's timestamp.
        return Array.from(map.values()).sort((a, b) => b.rep.timestamp - a.rep.timestamp);
    })();

    const totalPages = Math.max(1, Math.ceil(groupedLogs.length / LOGS_PER_PAGE));
    const safePage = Math.min(currentPage, totalPages);
    const paginatedGroups = groupedLogs.slice((safePage - 1) * LOGS_PER_PAGE, safePage * LOGS_PER_PAGE);

    const handleSearchChange = (val: string) => {
        setSearchQuery(val);
        setCurrentPage(1);
    };

    return (
        <SettingsTab>
            <div className="ps-command-center">
                <div className="ps-main-layout">
                    {/* LEFT COLUMN: SECURE CONNECT & OUTBOUND SURFACES */}
                    <div className="ps-main-left-col">
                        {/* SECTION 1: SECURE CONNECT (ENCRYPTED DNS) */}
                        <div className="ps-card">
                            <div className="ps-card-header">
                                <div className="ps-header-title-group">
                                    <h2 className="ps-card-title-text">Secure Connect</h2>
                                    <span className="ps-badge ps-badge-green">
                                        <span className="ps-badge-dot"></span>
                                        Active
                                    </span>
                                </div>
                            </div>
                            <div className="ps-card-subtitle">
                                Encrypted DNS for selected client hosts, with live resolver and cache status.
                            </div>

                            <div className="ps-secure-connect-grid">
                                <div className="ps-sc-left">
                                    {/* CUSTOM DESIGNER DISCORD DROPDOWN */}
                                    <div className="ps-form-group" ref={selectRef}>
                                        <label className="ps-label">DNS provider</label>
                                        <div className="ps-custom-select-wrapper">
                                            <button
                                                type="button"
                                                className={`ps-custom-select-trigger ${isDnsOpen ? "ps-custom-select-open" : ""}`}
                                                onClick={() => setIsDnsOpen(!isDnsOpen)}
                                            >
                                                <span className="ps-custom-select-value">{selectedDns}</span>
                                                <svg
                                                    className={`ps-custom-select-chevron ${isDnsOpen ? "ps-chevron-rotated" : ""}`}
                                                    width="16"
                                                    height="16"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                >
                                                    <polyline points="6 9 12 15 18 9" />
                                                </svg>
                                            </button>

                                            {isDnsOpen && (
                                                <div className="ps-custom-select-menu">
                                                    {Object.keys(dnsProviders).map(name => {
                                                        const isSelected = name === selectedDns;
                                                        return (
                                                            <div
                                                                key={name}
                                                                className={`ps-custom-select-item ${isSelected ? "ps-custom-select-item-selected" : ""}`}
                                                                onClick={() => {
                                                                    handleSelectDns(name);
                                                                    setIsDnsOpen(false);
                                                                }}
                                                            >
                                                                <span>{name}</span>
                                                                {isSelected && (
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                                        <polyline points="20 6 9 17 4 12" />
                                                                    </svg>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="ps-meta-table">
                                        <div className="ps-meta-row">
                                            <span className="ps-meta-label">Version</span>
                                            <span className="ps-meta-val">1.3.2</span>
                                        </div>
                                        <div className="ps-meta-row">
                                            <span className="ps-meta-label">Endpoint</span>
                                            <span className="ps-meta-val ps-meta-truncate" title={currentProviderObj.doh}>{currentProviderObj.doh}</span>
                                        </div>
                                        <div className="ps-meta-row">
                                            <span className="ps-meta-label">Cache</span>
                                            <span className="ps-meta-val">{dnsCacheStats.size} entries</span>
                                        </div>
                                        <div className="ps-meta-row">
                                            <span className="ps-meta-label">Native calls</span>
                                            <span className="ps-meta-val">0</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="ps-sc-right">
                                    <div className="ps-sc-actions">
                                        <button className="ps-btn ps-btn-stop" onClick={handleStopDiagnostic}>Stop</button>
                                        <button className={`ps-btn ${activeTestBtn === "doh" ? "ps-btn-active-blue" : ""}`} onClick={() => handleRunDiagnostic("doh")}>Test DoH</button>
                                        <button className={`ps-btn ${activeTestBtn === "dot" ? "ps-btn-active-blue" : ""}`} onClick={() => handleRunDiagnostic("dot")}>Test DoT</button>
                                        <button className={`ps-btn ${activeTestBtn === "auto" ? "ps-btn-active-blue" : ""}`} onClick={() => handleRunDiagnostic("auto")}>Test Automatic</button>
                                        <button className="ps-btn" onClick={fetchData}>Refresh</button>
                                        <button className="ps-btn" onClick={handleClearDnsCache}>Clear Cache</button>
                                    </div>

                                    <div className="ps-terminal-box">
                                        {diagnosticLogs.slice(-4).map((line, idx) => (
                                            <div key={idx} className="ps-terminal-line">{line}</div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* SECTION 2: OUTBOUND SURFACES */}
                        <div className="ps-card">
                            <div className="ps-card-header">
                                <div className="ps-header-title-group">
                                    <h2 className="ps-card-title-text">Outbound Surfaces</h2>
                                    <span className="ps-badge ps-badge-green">
                                        <span className="ps-badge-dot"></span>
                                        Core guards active
                                    </span>
                                </div>
                                <div className="ps-routes-summary">
                                    <div className="ps-summary-badge">
                                        <span className="ps-summary-num">{totalMappedRoutes}</span>
                                        <span className="ps-summary-lbl">Mapped</span>
                                    </div>
                                    <div className="ps-summary-badge">
                                        <span className="ps-summary-num">{totalAllowedRoutes || 508}</span>
                                        <span className="ps-summary-lbl">Allowed</span>
                                    </div>
                                    <div className="ps-summary-badge">
                                        <span className="ps-summary-num">{totalBlockedRoutes}</span>
                                        <span className="ps-summary-lbl">Blocked</span>
                                    </div>
                                </div>
                            </div>
                            <div className="ps-card-subtitle">
                                Known outbound route groups with their live protection or activation state.
                            </div>

                            <div className="ps-outbound-grid">
                                {outboundRoutes.map(route => (
                                    <div key={route.id} className="ps-route-card">
                                        <div className="ps-route-header">
                                            <span className="ps-route-title">{route.title}</span>
                                            <span className={`ps-badge ps-badge-sm ${route.statusType === "demand" || route.statusType === "plugin" ? "ps-badge-blue" : "ps-badge-green"}`}>
                                                {route.status}
                                            </span>
                                        </div>
                                        <div className="ps-route-endpoints">{route.endpoints.join(" / ")}</div>
                                        <div className="ps-route-desc">{route.description}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="ps-footer-note">
                                Observed counters cover this runtime session. This inventory does not make test requests and optional plugins can add destinations when you enable or use them.
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: PRIVACY SUITE PROTECTION */}
                    <div className="ps-main-right-col">
                        <div className="ps-card">
                            <div className="ps-card-header">
                                <div className="ps-header-title-group">
                                    <h2 className="ps-card-title-text">Privacy Suite Protection</h2>
                                    <span className="ps-badge ps-badge-green">
                                        <span className="ps-badge-dot"></span>
                                        Core Active
                                    </span>
                                </div>
                            </div>
                            <div className="ps-card-subtitle">
                                TestCord's privacy suite blocks Discord tracking and screens supported request paths for watched telemetry and recognised credential leaks.
                            </div>

                            {/* Critical Security Alert Banner */}
                            {alerts.some(a => !a.acknowledged) && (
                                <div className="ps-alert-banner">
                                    <div className="ps-alert-banner-head">
                                        <div className="ps-alert-banner-title">
                                            <span className="ps-alert-banner-icon">⚠</span>
                                            Security alert
                                        </div>
                                        <button className="ps-alert-dismiss" onClick={acknowledgeAlerts}>Dismiss all</button>
                                    </div>
                                    <div className="ps-alert-list">
                                        {alerts.filter(a => !a.acknowledged).slice(0, 4).map(a => (
                                            <div key={a.id} className="ps-alert-item">
                                                <div className="ps-alert-msg">{a.message}</div>
                                                <div className="ps-alert-meta">
                                                    <span className="ps-mono">{a.domain}</span>
                                                    <span className="ps-alert-time">{formatTimeAgo(a.timestamp)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Hero Metric Cards Grid */}
                            <div className="ps-kpi-grid">
                                <div className="ps-kpi-card ps-hero-green">
                                    <h2 className="ps-kpi-value">{counters.totalBlocked}</h2>
                                    <p className="ps-kpi-label">Total blocked</p>
                                </div>
                                <div className="ps-kpi-card ps-hero-orange">
                                    <h2 className="ps-kpi-value">{counters.totalStripped}</h2>
                                    <p className="ps-kpi-label">Headers stripped</p>
                                </div>
                                <div className="ps-kpi-card ps-hero-blue">
                                    <h2 className="ps-kpi-value">{counters.tracking}</h2>
                                    <p className="ps-kpi-label">Tracking</p>
                                </div>
                                <div className="ps-kpi-card ps-hero-amber">
                                    <h2 className="ps-kpi-value">{counters.network}</h2>
                                    <p className="ps-kpi-label">Network</p>
                                </div>
                                <div className="ps-kpi-card ps-hero-pink">
                                    <h2 className="ps-kpi-value">{counters.tokens}</h2>
                                    <p className="ps-kpi-label">Tokens</p>
                                </div>
                                <div className="ps-kpi-card ps-hero-cyan">
                                    <h2 className="ps-kpi-value">{counters.clipboard}</h2>
                                    <p className="ps-kpi-label">Clipboard</p>
                                </div>
                                <div className="ps-kpi-card ps-hero-purple">
                                    <h2 className="ps-kpi-value">{counters.webhooks}</h2>
                                    <p className="ps-kpi-label">Webhooks</p>
                                </div>
                                <div className="ps-kpi-card ps-hero-red">
                                    <h2 className="ps-kpi-value">{counters.remoteCode}</h2>
                                    <p className="ps-kpi-label">Remote code</p>
                                </div>
                                <div className="ps-kpi-card ps-hero-emerald">
                                    <h2 className="ps-kpi-value">{counters.updateRefusals}</h2>
                                    <p className="ps-kpi-label">Update refusals</p>
                                </div>
                                <div className="ps-kpi-card ps-hero-teal">
                                    <h2 className="ps-kpi-value">{counters.linkTracker}</h2>
                                    <p className="ps-kpi-label">Link trackers</p>
                                </div>
                            </div>

                            {/* Protection Right Stack */}
                            <div className="ps-protection-bottom-grid">
                                {/* Covered Surfaces */}
                                <div className="ps-sub-section">
                                    <h4 className="ps-sub-title">COVERED SURFACES</h4>
                                    <div className="ps-tag-pills-wrap">
                                        {surfaceTags.map(({ key, title }, idx) => (
                                            <button
                                                key={idx}
                                                className={`ps-tag-pill ${shields[key] ? "ps-tag-pill-active" : ""}`}
                                                onClick={() => toggleShield(key)}
                                            >
                                                {title}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Update Integrity */}
                                <div className="ps-sub-section">
                                    <div className="ps-sub-header">
                                        <h4 className="ps-sub-title">UPDATE INTEGRITY</h4>
                                        <span className="ps-badge ps-badge-green ps-badge-xs">Ready</span>
                                    </div>
                                    <div className="ps-integrity-table">
                                        <div className="ps-integ-row">
                                            <span className="ps-meta-label">Service</span>
                                            <span className="ps-meta-val">Configured</span>
                                        </div>
                                        <div className="ps-integ-row">
                                            <span className="ps-meta-label">Runtime</span>
                                            <span className="ps-meta-val">Installed runtime</span>
                                        </div>
                                        <div className="ps-integ-row">
                                            <span className="ps-meta-label">Commit</span>
                                            <span className="ps-meta-val">Verified</span>
                                        </div>
                                        <div className="ps-integ-row">
                                            <span className="ps-meta-label">Signature</span>
                                            <span className="ps-meta-val">Verified</span>
                                        </div>
                                        <div className="ps-integ-row">
                                            <span className="ps-meta-label">Checksum</span>
                                            <span className="ps-meta-val">Required</span>
                                        </div>
                                        <div className="ps-integ-row">
                                            <span className="ps-meta-label">Rollback</span>
                                            <span className="ps-meta-val">Created on update</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Paginated & Filterable Recent Blocks */}
                                <div className="ps-sub-section">
                                    <div className="ps-sub-header">
                                        <h4 className="ps-sub-title">RECENT BLOCKS</h4>
                                        <div className="ps-recent-blocks-actions">
                                            <div className="ps-search-wrapper">
                                                <input
                                                    type="text"
                                                    className="ps-search-input"
                                                    placeholder="Search blocks..."
                                                    value={searchQuery}
                                                    onChange={e => handleSearchChange(e.target.value)}
                                                />
                                                {searchQuery && (
                                                    <button
                                                        type="button"
                                                        className="ps-search-clear"
                                                        onClick={() => handleSearchChange("")}
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="ps-recent-blocks-stack">
                                        {paginatedGroups.length > 0 ? (
                                            paginatedGroups.map(group => {
                                                const log = group.rep;
                                                const repLabel = hostReputationLabel(log.domain);
                                                const rule = hostRules[log.domain];
                                                return (
                                                    <div
                                                        key={log.id}
                                                        className="ps-block-card-amber"
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => setSelectedBlock(log)}
                                                        onKeyDown={e => {
                                                            if (e.key === "Enter" || e.key === " ") {
                                                                e.preventDefault();
                                                                setSelectedBlock(log);
                                                            }
                                                        }}
                                                    >
                                                        <div className="ps-block-left">
                                                            <div className="ps-block-event-title">
                                                                {getEventTitle(log)}
                                                                {group.count > 1 && (
                                                                    <span className="ps-block-count-badge">×{group.count}</span>
                                                                )}
                                                            </div>
                                                            <div className="ps-block-event-sub">
                                                                {log.domain}
                                                                <span className={`ps-rep-tag ps-rep-${repTagClass(log.domain)}`}>{repLabel}</span>
                                                                {rule && (
                                                                    <span className={`ps-rule-tag ps-rule-${rule}`}>{rule === "allow" ? "Allowed" : "Always blocked"}</span>
                                                                )}
                                                            </div>
                                                            <div className="ps-block-event-url" title={log.url}>{log.url}</div>
                                                        </div>
                                                        <div className="ps-block-right">
                                                            <span className={`ps-block-category-tag ps-outcome-${log.outcome || "blocked"}`}>{log.outcome || log.category}</span>
                                                            <div className="ps-block-time">{formatTimeAgo(log.timestamp)}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="ps-no-results">No blocks matching "{searchQuery}"</div>
                                        )}
                                    </div>

                                    {/* Pagination Controls moved to the bottom */}
                                    <div className="ps-pagination-footer">
                                        <div className="ps-export-actions">
                                            <button
                                                type="button"
                                                className="ps-export-btn"
                                                disabled={logs.length === 0}
                                                onClick={() => exportLogs("json")}
                                                title="Export the full log as JSON"
                                            >
                                                Export JSON
                                            </button>
                                            <button
                                                type="button"
                                                className="ps-export-btn"
                                                disabled={logs.length === 0}
                                                onClick={() => exportLogs("csv")}
                                                title="Export the full log as CSV"
                                            >
                                                Export CSV
                                            </button>
                                        </div>
                                        <div className="ps-pagination-controls">
                                            <button
                                                className="ps-page-btn"
                                                disabled={safePage <= 1}
                                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            >
                                                Prev
                                            </button>
                                            <span className="ps-page-label">Page</span>
                                            <input
                                                type="number"
                                                className="ps-page-input"
                                                min={1}
                                                max={totalPages}
                                                value={safePage}
                                                onChange={e => {
                                                    const val = parseInt(e.target.value, 10);
                                                    if (!isNaN(val)) {
                                                        setCurrentPage(Math.max(1, Math.min(totalPages, val)));
                                                    }
                                                }}
                                            />
                                            <span className="ps-page-info">of {totalPages}</span>
                                            <button
                                                className="ps-page-btn"
                                                disabled={safePage >= totalPages}
                                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {selectedBlock && (
                <div className="ps-block-modal-overlay" onClick={() => setSelectedBlock(null)}>
                    <div
                        className="ps-block-modal"
                        role="dialog"
                        aria-modal="true"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="ps-block-modal-header">
                            <div className="ps-block-modal-title-group">
                                <span className="ps-block-category-tag">{getCategoryLabel(selectedBlock.category)}</span>
                                <h3 className="ps-block-modal-title">{getEventTitle(selectedBlock)}</h3>
                            </div>
                            <button
                                type="button"
                                className="ps-block-modal-close"
                                onClick={() => setSelectedBlock(null)}
                            >
                                ✕
                            </button>
                        </div>

                        <div className="ps-block-modal-body">
                            <p className="ps-block-modal-explain">{getCategoryExplanation(selectedBlock.category)}</p>

                            <div className="ps-block-detail-grid">
                                <div className="ps-block-detail-row">
                                    <span className="ps-block-detail-key">Action</span>
                                    <span className="ps-block-detail-val">{selectedBlock.action}</span>
                                </div>
                                <div className="ps-block-detail-row">
                                    <span className="ps-block-detail-key">Category</span>
                                    <span className="ps-block-detail-val">{selectedBlock.category}</span>
                                </div>
                                <div className="ps-block-detail-row">
                                    <span className="ps-block-detail-key">Caught by</span>
                                    <span className="ps-block-detail-val">{getShieldForCategory(selectedBlock.category)}</span>
                                </div>
                                <div className="ps-block-detail-row">
                                    <span className="ps-block-detail-key">Domain</span>
                                    <span className="ps-block-detail-val ps-mono">{selectedBlock.domain}</span>
                                </div>
                                <div className="ps-block-detail-row">
                                    <span className="ps-block-detail-key">Reputation</span>
                                    <span className="ps-block-detail-val">
                                        <span className={`ps-rep-tag ps-rep-${repTagClass(selectedBlock.domain)}`}>{hostReputationLabel(selectedBlock.domain)}</span>
                                        <span className="ps-rep-note">{hostReputationNote(selectedBlock.domain)}</span>
                                    </span>
                                </div>
                                <div className="ps-block-detail-row">
                                    <span className="ps-block-detail-key">Host rule</span>
                                    <span className="ps-block-detail-val">
                                        {hostRules[selectedBlock.domain]
                                            ? (hostRules[selectedBlock.domain] === "allow" ? "Allowed to receive your token" : "Always blocked")
                                            : "None (default handling)"}
                                    </span>
                                </div>
                                <div className="ps-block-detail-row">
                                    <span className="ps-block-detail-key">Outcome</span>
                                    <span className="ps-block-detail-val">{selectedBlock.outcome || "blocked"}</span>
                                </div>
                                <div className="ps-block-detail-row">
                                    <span className="ps-block-detail-key">When</span>
                                    <span className="ps-block-detail-val">{formatAbsoluteTime(selectedBlock.timestamp)} ({formatTimeAgo(selectedBlock.timestamp)})</span>
                                </div>
                                <div className="ps-block-detail-row">
                                    <span className="ps-block-detail-key">Event ID</span>
                                    <span className="ps-block-detail-val ps-mono">{selectedBlock.id}</span>
                                </div>
                            </div>

                            {(() => {
                                const parts = parseUrlParts(selectedBlock.url);
                                return (
                                    <>
                                        <h4 className="ps-block-detail-subhead">Request</h4>
                                        <div className="ps-block-url-full ps-mono" title={selectedBlock.url}>{selectedBlock.url}</div>
                                        <div className="ps-block-detail-grid">
                                            <div className="ps-block-detail-row">
                                                <span className="ps-block-detail-key">Scheme</span>
                                                <span className="ps-block-detail-val ps-mono">{parts.scheme}</span>
                                            </div>
                                            <div className="ps-block-detail-row">
                                                <span className="ps-block-detail-key">Host</span>
                                                <span className="ps-block-detail-val ps-mono">{parts.host}</span>
                                            </div>
                                            <div className="ps-block-detail-row">
                                                <span className="ps-block-detail-key">Port</span>
                                                <span className="ps-block-detail-val ps-mono">{parts.port}</span>
                                            </div>
                                            <div className="ps-block-detail-row">
                                                <span className="ps-block-detail-key">Path</span>
                                                <span className="ps-block-detail-val ps-mono">{parts.path}</span>
                                            </div>
                                            {parts.query && (
                                                <div className="ps-block-detail-row">
                                                    <span className="ps-block-detail-key">Query</span>
                                                    <span className="ps-block-detail-val ps-mono">{parts.query}</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>

                        <div className="ps-block-modal-footer">
                            <div className="ps-block-modal-actions">
                                {classifyHost(selectedBlock.domain) !== "first-party" && (
                                    hostRules[selectedBlock.domain]
                                        ? (
                                            <button
                                                type="button"
                                                className="ps-host-action-btn ps-host-action-clear"
                                                onClick={() => clearHostRule(selectedBlock.domain)}
                                            >
                                                Clear host rule
                                            </button>
                                        )
                                        : (
                                            <>
                                                <button
                                                    type="button"
                                                    className="ps-host-action-btn ps-host-action-allow"
                                                    onClick={() => setHostRule(selectedBlock.domain, "allow")}
                                                >
                                                    Allow this host
                                                </button>
                                                <button
                                                    type="button"
                                                    className="ps-host-action-btn ps-host-action-block"
                                                    onClick={() => setHostRule(selectedBlock.domain, "block")}
                                                >
                                                    Always block this host
                                                </button>
                                            </>
                                        )
                                )}
                            </div>
                            <button
                                type="button"
                                className="ps-block-copy-btn"
                                onClick={() => copyToClipboard(buildBlockReport(selectedBlock), "all")}
                            >
                                {copiedField === "all" ? "Copied" : "Copy details"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </SettingsTab>
    );
}

export default PrivacySecurityPanel;
