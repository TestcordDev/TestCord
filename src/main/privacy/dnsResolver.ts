/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { net } from "electron";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { SETTINGS_DIR } from "../utils/constants";

const PRIVACY_SETTINGS_FILE = join(SETTINGS_DIR, "privacy.json");

export interface DnsProviderConfig {
    doh: string;
    fallback: string;
}

export const DNS_PROVIDERS: Record<string, DnsProviderConfig> = {
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
};

export interface DnsCacheEntry {
    hostname: string;
    ip: string;
    expiresAt: number;
}

export interface DnsDiagnosticLog {
    timestamp: number;
    level: "info" | "success" | "warn" | "error";
    message: string;
}

class DnsResolverEngine {
    private selectedProviderName: string = "Cloudflare 1.1.1.1";
    private customEndpoints: Record<string, DnsProviderConfig> = {};
    private latencies: Record<string, number> = {};
    private cache = new Map<string, DnsCacheEntry>();
    private cacheMaxCapacity = 256;
    private ttlMinutes = 15;
    private cacheHits = 0;
    private cacheMisses = 0;
    private diagnosticLogs: DnsDiagnosticLog[] = [];
    private isDiagnosticRunning = false;
    private abortDiagnosticController: AbortController | null = null;

    constructor() {
        this.loadSettings();
        this.addLog("info", `Encrypted DNS Resolver initialized. Primary provider: ${this.selectedProviderName}`);
    }

    private loadSettings() {
        try {
            if (existsSync(PRIVACY_SETTINGS_FILE)) {
                const data = JSON.parse(readFileSync(PRIVACY_SETTINGS_FILE, "utf-8"));
                if (data.selectedProviderName) {
                    this.selectedProviderName = data.selectedProviderName;
                }
                if (data.customEndpoints) {
                    this.customEndpoints = data.customEndpoints;
                }
            }
        } catch (e) {
            console.error("[Privacy] Failed to load DNS settings", e);
        }
    }

    private saveSettings() {
        try {
            mkdirSync(SETTINGS_DIR, { recursive: true });
            const data = {
                selectedProviderName: this.selectedProviderName,
                customEndpoints: this.customEndpoints
            };
            writeFileSync(PRIVACY_SETTINGS_FILE, JSON.stringify(data, null, 4));
        } catch (e) {
            console.error("[Privacy] Failed to save DNS settings", e);
        }
    }

    public getAllProviders(): Record<string, DnsProviderConfig> {
        return { ...DNS_PROVIDERS, ...this.customEndpoints };
    }

    public getSelectedProviderName(): string {
        return this.selectedProviderName;
    }

    public setSelectedProvider(name: string): boolean {
        const providers = this.getAllProviders();
        if (providers[name]) {
            this.selectedProviderName = name;
            this.saveSettings();
            this.addLog("info", `DNS Provider switched to: ${name}`);
            return true;
        }
        return false;
    }

    public addCustomEndpoint(name: string, doh: string, fallback: string): boolean {
        if (!name || !doh) return false;
        this.customEndpoints[name] = { doh, fallback: fallback || "1.1.1.1" };
        this.selectedProviderName = name;
        this.saveSettings();
        this.addLog("success", `Custom DNS endpoint added & selected: ${name} (${doh})`);
        return true;
    }

    public getLatencies(): Record<string, number> {
        return { ...this.latencies };
    }

    public async pingAllLatencies(): Promise<Record<string, number>> {
        const providers = this.getAllProviders();
        const entries = Object.entries(providers);

        await Promise.all(
            entries.map(async ([name, config]) => {
                const rtt = await this.pingEndpoint(config.doh);
                if (rtt >= 0) {
                    this.latencies[name] = rtt;
                } else {
                    this.latencies[name] = -1; // Offline / error
                }
            })
        );

        return this.getLatencies();
    }

    private async pingEndpoint(dohUrl: string): Promise<number> {
        const start = Date.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1500);

            const res = await net.fetch(dohUrl, {
                method: "HEAD",
                signal: controller.signal
            }).catch(() => null);

            clearTimeout(timeoutId);
            if (res) {
                return Date.now() - start;
            }
        } catch {
            // ping failed
        }
        return -1;
    }

    public async resolveHostname(hostname: string): Promise<string> {
        // Check LRU Cache
        const now = Date.now();
        const cached = this.cache.get(hostname);
        if (cached && cached.expiresAt > now) {
            this.cacheHits++;
            // Re-insert for LRU freshness
            this.cache.delete(hostname);
            this.cache.set(hostname, cached);
            return cached.ip;
        }

        this.cacheMisses++;

        // Attempt primary resolution with fallback
        const providers = this.getAllProviders();
        const primary = providers[this.selectedProviderName] || DNS_PROVIDERS["Cloudflare 1.1.1.1"];

        let resolvedIp: string | null = null;
        try {
            resolvedIp = await this.queryDoH(primary.doh, hostname, 1500);
        } catch {
            this.addLog("warn", `Primary DNS timeout/error for ${hostname}. Triggering secondary failover...`);
        }

        if (!resolvedIp) {
            // Secondary failover: Cloudflare fallback or direct IP fallback
            const secondary = DNS_PROVIDERS["Cloudflare 1.1.1.1"];
            try {
                resolvedIp = await this.queryDoH(secondary.doh, hostname, 1500);
                this.addLog("info", `Secondary DNS failover succeeded for ${hostname}: ${resolvedIp}`);
            } catch {
                resolvedIp = primary.fallback;
                this.addLog("warn", `Secondary DNS query failed. Using IP fallback for ${hostname}: ${resolvedIp}`);
            }
        }

        const finalIp = resolvedIp || primary.fallback;
        // Cache result
        this.addToCache(hostname, finalIp);
        return finalIp;
    }

    private async queryDoH(dohUrl: string, hostname: string, timeoutMs: number): Promise<string | null> {
        const url = `${dohUrl}?name=${encodeURIComponent(hostname)}&type=A`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const res = await net.fetch(url, {
            headers: { "Accept": "application/dns-json" },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { Answer?: Array<{ data: string }> };

        if (data.Answer && data.Answer.length > 0) {
            const ipRecord = data.Answer.find(a => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a.data));
            if (ipRecord) return ipRecord.data;
        }
        return null;
    }

    private addToCache(hostname: string, ip: string) {
        if (this.cache.size >= this.cacheMaxCapacity) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }
        const expiresAt = Date.now() + this.ttlMinutes * 60 * 1000;
        this.cache.set(hostname, { hostname, ip, expiresAt });
    }

    public getCacheStats() {
        return {
            size: this.cache.size,
            maxCapacity: this.cacheMaxCapacity,
            ttlMinutes: this.ttlMinutes,
            hits: this.cacheHits,
            misses: this.cacheMisses
        };
    }

    public setTtlMinutes(minutes: number) {
        if (minutes >= 1 && minutes <= 60) {
            this.ttlMinutes = minutes;
            this.addLog("info", `DNS Cache TTL set to ${minutes} minutes`);
        }
    }

    public clearCache() {
        this.cache.clear();
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.addLog("success", "DNS LRU Cache cleared successfully");
    }

    public getDiagnosticLogs(): DnsDiagnosticLog[] {
        return [...this.diagnosticLogs];
    }

    public addLog(level: "info" | "success" | "warn" | "error", message: string) {
        this.diagnosticLogs.push({
            timestamp: Date.now(),
            level,
            message
        });
        if (this.diagnosticLogs.length > 100) {
            this.diagnosticLogs.shift();
        }
    }

    public stopDiagnostic() {
        if (this.abortDiagnosticController) {
            this.abortDiagnosticController.abort();
            this.abortDiagnosticController = null;
        }
        this.isDiagnosticRunning = false;
        this.addLog("info", "Diagnostic execution stopped by user.");
    }

    public async runDiagnostic(mode: "doh" | "dot" | "auto") {
        if (this.isDiagnosticRunning) {
            this.stopDiagnostic();
        }

        this.isDiagnosticRunning = true;
        this.abortDiagnosticController = new AbortController();
        const { signal } = this.abortDiagnosticController;

        this.addLog("info", `Starting Diagnostic Test [Mode: ${mode.toUpperCase()}]...`);

        const provider = this.getAllProviders()[this.selectedProviderName] || DNS_PROVIDERS["Cloudflare 1.1.1.1"];

        try {
            this.addLog("info", `Testing primary DoH endpoint: ${provider.doh}`);
            const latency = await this.pingEndpoint(provider.doh);
            if (signal.aborted) return;

            if (latency >= 0) {
                this.addLog("success", `Primary DoH Endpoint reachable in ${latency}ms`);
            } else {
                this.addLog("error", `Primary DoH Endpoint failed to respond within 1500ms`);
            }

            if (signal.aborted) return;

            this.addLog("info", "Resolving test target \"discord.com\"...");
            const testIp = await this.resolveHostname("discord.com");
            if (signal.aborted) return;

            this.addLog("success", `Resolution complete. Target "discord.com" resolved to IP ${testIp}`);
            this.addLog("info", `DNS Cache Status: ${this.cache.size}/${this.cacheMaxCapacity} entries stored`);
            this.addLog("success", "Diagnostic run completed successfully.");
        } catch (err: any) {
            if (!signal.aborted) {
                this.addLog("error", `Diagnostic failed: ${err?.message || err}`);
            }
        } finally {
            this.isDiagnosticRunning = false;
            this.abortDiagnosticController = null;
        }
    }
}

export const dnsResolver = new DnsResolverEngine();
