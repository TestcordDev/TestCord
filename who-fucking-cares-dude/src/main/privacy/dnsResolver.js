/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { app, net } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { connect as tlsConnect } from "tls";
import { SETTINGS_DIR } from "../utils/constants";
const PRIVACY_SETTINGS_FILE = join(SETTINGS_DIR, "privacy.json");
export const DNS_PROVIDERS = {
    "Cloudflare 1.1.1.1": { doh: "https://cloudflare-dns.com/dns-query", fallback: "1.1.1.1", dot: "cloudflare-dns.com" },
    "Cloudflare Security (Malware)": { doh: "https://security.cloudflare-dns.com/dns-query", fallback: "1.1.1.2", dot: "security.cloudflare-dns.com" },
    "Cloudflare Family": { doh: "https://family.cloudflare-dns.com/dns-query", fallback: "1.1.1.3", dot: "family.cloudflare-dns.com" },
    "Mullvad Adblock": { doh: "https://adblock.dns.mullvad.net/dns-query", fallback: "194.242.2.3", dot: "adblock.dns.mullvad.net" },
    "Mullvad Base": { doh: "https://base.dns.mullvad.net/dns-query", fallback: "194.242.2.4", dot: "base.dns.mullvad.net" },
    "Mullvad Extended": { doh: "https://extended.dns.mullvad.net/dns-query", fallback: "194.242.2.5", dot: "extended.dns.mullvad.net" },
    "Mullvad Family": { doh: "https://family.dns.mullvad.net/dns-query", fallback: "194.242.2.6", dot: "family.dns.mullvad.net" },
    "Mullvad All": { doh: "https://all.dns.mullvad.net/dns-query", fallback: "194.242.2.9", dot: "all.dns.mullvad.net" },
    "Quad9": { doh: "https://dns.quad9.net/dns-query", fallback: "9.9.9.9", dot: "dns.quad9.net" },
    "Quad9 ECS": { doh: "https://dns11.quad9.net/dns-query", fallback: "9.9.9.11", dot: "dns11.quad9.net" },
    "AdGuard Default": { doh: "https://dns.adguard-dns.com/dns-query", fallback: "94.140.14.14", dot: "dns.adguard-dns.com" },
    "AdGuard Family": { doh: "https://family.adguard-dns.com/dns-query", fallback: "94.140.14.15", dot: "family.adguard-dns.com" },
    "AdGuard Unfiltered": { doh: "https://unfiltered.adguard-dns.com/dns-query", fallback: "94.140.14.140", dot: "unfiltered.adguard-dns.com" },
    "Google Public DNS": { doh: "https://dns.google/dns-query", fallback: "8.8.8.8", dot: "dns.google" },
    "Control D Unfiltered": { doh: "https://freedns.controld.com/p0", fallback: "76.76.2.0", dot: "p0.freedns.controld.com" },
    "Control D Malware": { doh: "https://freedns.controld.com/malware", fallback: "76.76.2.1", dot: "p1.freedns.controld.com" },
    "OpenDNS Home": { doh: "https://doh.opendns.com/dns-query", fallback: "208.67.222.222", dot: "dns.opendns.com" },
    "OpenDNS FamilyShield": { doh: "https://doh.familyshield.opendns.com/dns-query", fallback: "208.67.222.123", dot: "familyshield.opendns.com" }
};
class DnsResolverEngine {
    selectedProviderName = "Cloudflare 1.1.1.1";
    customEndpoints = {};
    latencies = {};
    cache = new Map();
    cacheMaxCapacity = 256;
    ttlMinutes = 15;
    cacheHits = 0;
    cacheMisses = 0;
    diagnosticLogs = [];
    isDiagnosticRunning = false;
    abortDiagnosticController = null;
    isInitialized = false;
    /**
     * Whether encrypted DNS is applied to the Electron session at all. Mirrors
     * the Custom DNS toggle in the Privacy & Security panel; when false the
     * app keeps using the system resolver.
     */
    dnsEnabled = true;
    constructor() {
        this.loadSettings();
        this.addLog("info", `Encrypted DNS Resolver initialized. Primary provider: ${this.selectedProviderName}`);
        if (app.isReady()) {
            this.applyToElectronSession();
        }
        else {
            app.whenReady().then(() => this.applyToElectronSession());
        }
    }
    init() {
        if (this.isInitialized)
            return;
        this.isInitialized = true;
        if (app.isReady()) {
            this.applyToElectronSession();
        }
        else {
            app.whenReady().then(() => this.applyToElectronSession());
        }
    }
    applyToElectronSession() {
        if (!this.dnsEnabled) {
            this.addLog("info", "Encrypted DNS is disabled; the app is using the system resolver.");
            return;
        }
        try {
            const providers = this.getAllProviders();
            const primary = providers[this.selectedProviderName] || DNS_PROVIDERS["Cloudflare 1.1.1.1"];
            if (typeof app.configureHostResolver === "function") {
                try {
                    app.configureHostResolver({
                        enableBuiltInResolver: true,
                        secureDnsMode: "secure",
                        secureDnsServers: [primary.doh]
                    });
                    this.addLog("info", `Applied Encrypted DNS (DoH) to Electron session in SECURE mode: ${primary.doh}`);
                }
                catch (err) {
                    app.configureHostResolver({
                        enableBuiltInResolver: true,
                        secureDnsMode: "automatic",
                        secureDnsServers: [primary.doh]
                    });
                    this.addLog("info", `Applied Encrypted DNS (DoH) to Electron session in AUTOMATIC mode: ${primary.doh}`);
                }
            }
            else {
                this.addLog("warn", "app.configureHostResolver is not supported in this Electron environment.");
            }
        }
        catch (e) {
            console.error("[Privacy] Failed to apply DNS configuration to Electron session", e);
            this.addLog("error", `Failed to apply DNS configuration to Electron session: ${e?.message || e}`);
        }
    }
    loadSettings() {
        try {
            if (existsSync(PRIVACY_SETTINGS_FILE)) {
                const data = JSON.parse(readFileSync(PRIVACY_SETTINGS_FILE, "utf-8"));
                if (data.selectedProviderName) {
                    this.selectedProviderName = data.selectedProviderName;
                }
                if (data.customEndpoints) {
                    this.customEndpoints = data.customEndpoints;
                }
                if (typeof data.dnsEnabled === "boolean") {
                    this.dnsEnabled = data.dnsEnabled;
                }
            }
        }
        catch (e) {
            console.error("[Privacy] Failed to load DNS settings", e);
        }
    }
    saveSettings() {
        try {
            mkdirSync(SETTINGS_DIR, { recursive: true });
            const data = {
                selectedProviderName: this.selectedProviderName,
                customEndpoints: this.customEndpoints,
                dnsEnabled: this.dnsEnabled
            };
            writeFileSync(PRIVACY_SETTINGS_FILE, JSON.stringify(data, null, 4));
        }
        catch (e) {
            console.error("[Privacy] Failed to save DNS settings", e);
        }
    }
    isEnabled() {
        return this.dnsEnabled;
    }
    /**
     * Enable or disable encrypted DNS for the whole Electron session. Persists
     * across restarts and reconfigures the host resolver immediately: enabling
     * applies the selected provider, disabling falls back to the system
     * resolver.
     */
    setEnabled(enabled) {
        this.dnsEnabled = enabled;
        this.saveSettings();
        if (enabled) {
            this.applyToElectronSession();
        }
        else {
            this.disableElectronSession();
        }
        return this.dnsEnabled;
    }
    disableElectronSession() {
        try {
            if (typeof app.configureHostResolver === "function") {
                // No secureDns* options — Electron goes back to the system resolver.
                app.configureHostResolver({ enableBuiltInResolver: true });
                this.addLog("info", "Encrypted DNS disabled; the app is using the system resolver.");
            }
            else {
                this.addLog("warn", "app.configureHostResolver is not supported in this Electron environment.");
            }
        }
        catch (e) {
            console.error("[Privacy] Failed to disable DNS configuration on Electron session", e);
            this.addLog("error", `Failed to disable DNS configuration on Electron session: ${e?.message || e}`);
        }
    }
    getAllProviders() {
        return { ...DNS_PROVIDERS, ...this.customEndpoints };
    }
    getSelectedProviderName() {
        return this.selectedProviderName;
    }
    setSelectedProvider(name) {
        const providers = this.getAllProviders();
        if (providers[name]) {
            this.selectedProviderName = name;
            this.saveSettings();
            this.applyToElectronSession();
            this.addLog("info", `DNS Provider switched to: ${name}`);
            return true;
        }
        return false;
    }
    addCustomEndpoint(name, doh, fallback) {
        if (!name || !doh)
            return false;
        this.customEndpoints[name] = { doh, fallback: fallback || "1.1.1.1" };
        this.selectedProviderName = name;
        this.saveSettings();
        this.applyToElectronSession();
        this.addLog("success", `Custom DNS endpoint added & selected: ${name} (${doh})`);
        return true;
    }
    getLatencies() {
        return { ...this.latencies };
    }
    async pingAllLatencies() {
        const providers = this.getAllProviders();
        const entries = Object.entries(providers);
        await Promise.all(entries.map(async ([name, config]) => {
            const rtt = await this.pingEndpoint(config.doh);
            if (rtt >= 0) {
                this.latencies[name] = rtt;
            }
            else {
                this.latencies[name] = -1; // Offline / error
            }
        }));
        return this.getLatencies();
    }
    async pingEndpoint(dohUrl) {
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
        }
        catch {
            // ping failed
        }
        return -1;
    }
    /**
     * Resolve a hostname over the encrypted pipeline. Returns null when the
     * name cannot be resolved — never the provider's own fallback IP, which
     * would misdirect requests and pollute the cache with wrong answers.
     */
    async resolveHostname(hostname) {
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
        let resolvedIp = null;
        try {
            resolvedIp = await this.queryDoH(primary.doh, hostname, 1500);
        }
        catch {
            this.addLog("warn", `Primary DNS timeout/error for ${hostname}. Triggering secondary failover...`);
        }
        if (!resolvedIp) {
            // Secondary failover — pointless when the primary IS the secondary.
            const secondary = DNS_PROVIDERS["Cloudflare 1.1.1.1"];
            if (primary.doh !== secondary.doh) {
                try {
                    resolvedIp = await this.queryDoH(secondary.doh, hostname, 1500);
                    this.addLog("info", `Secondary DNS failover succeeded for ${hostname}: ${resolvedIp}`);
                }
                catch {
                    this.addLog("warn", `Secondary DNS query failed for ${hostname}.`);
                }
            }
        }
        if (!resolvedIp) {
            this.addLog("warn", `Could not resolve ${hostname} over encrypted DNS; leaving it unresolved.`);
            return null;
        }
        this.addToCache(hostname, resolvedIp);
        return resolvedIp;
    }
    async queryDoH(dohUrl, hostname, timeoutMs) {
        const url = `${dohUrl}?name=${encodeURIComponent(hostname)}&type=A`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const res = await net.fetch(url, {
            headers: { "Accept": "application/dns-json" },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.Answer && data.Answer.length > 0) {
            const ipRecord = data.Answer.find(a => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a.data));
            if (ipRecord)
                return ipRecord.data;
        }
        return null;
    }
    // Build a DNS wire-format query packet for an A record.
    buildDnsQuery(hostname) {
        const id = Math.floor(Math.random() * 0xffff);
        const header = Buffer.alloc(12);
        header.writeUInt16BE(id, 0); // transaction id
        header.writeUInt16BE(0x0100, 2); // flags: standard query, recursion desired
        header.writeUInt16BE(1, 4); // QDCOUNT = 1
        // ANCOUNT / NSCOUNT / ARCOUNT stay 0
        const labels = hostname.split(".").filter(Boolean);
        const qnameParts = [];
        for (const label of labels) {
            const len = Buffer.byteLength(label, "ascii");
            const buf = Buffer.alloc(1 + len);
            buf.writeUInt8(len, 0);
            buf.write(label, 1, "ascii");
            qnameParts.push(buf);
        }
        qnameParts.push(Buffer.from([0])); // root label terminator
        const qtypeClass = Buffer.alloc(4);
        qtypeClass.writeUInt16BE(1, 0); // QTYPE = A
        qtypeClass.writeUInt16BE(1, 2); // QCLASS = IN
        return Buffer.concat([header, ...qnameParts, qtypeClass]);
    }
    // Parse the first A record from a DNS wire-format response.
    parseDnsAnswer(msg) {
        if (msg.length < 12)
            return null;
        const qdcount = msg.readUInt16BE(4);
        const ancount = msg.readUInt16BE(6);
        if (ancount === 0)
            return null;
        let offset = 12;
        // Skip the question section (qdcount entries).
        for (let q = 0; q < qdcount; q++) {
            while (offset < msg.length) {
                const len = msg.readUInt8(offset);
                if (len === 0) {
                    offset += 1;
                    break;
                }
                if ((len & 0xc0) === 0xc0) {
                    offset += 2;
                    break;
                } // compression pointer
                offset += 1 + len;
            }
            offset += 4; // QTYPE + QCLASS
        }
        // Walk the answer records.
        for (let a = 0; a < ancount; a++) {
            if (offset >= msg.length)
                break;
            // NAME: pointer or label sequence
            if ((msg.readUInt8(offset) & 0xc0) === 0xc0) {
                offset += 2;
            }
            else {
                while (offset < msg.length) {
                    const len = msg.readUInt8(offset);
                    if (len === 0) {
                        offset += 1;
                        break;
                    }
                    offset += 1 + len;
                }
            }
            if (offset + 10 > msg.length)
                break;
            const type = msg.readUInt16BE(offset);
            const rdlength = msg.readUInt16BE(offset + 8);
            offset += 10;
            if (type === 1 && rdlength === 4 && offset + 4 <= msg.length) {
                return `${msg.readUInt8(offset)}.${msg.readUInt8(offset + 1)}.${msg.readUInt8(offset + 2)}.${msg.readUInt8(offset + 3)}`;
            }
            offset += rdlength;
        }
        return null;
    }
    // Resolve a hostname over DNS-over-TLS (RFC 7858, TCP/853).
    queryDoT(dotHost, serverIp, hostname, timeoutMs) {
        return new Promise((resolve, reject) => {
            const query = this.buildDnsQuery(hostname);
            // DoT frames the DNS message with a 2-byte big-endian length prefix.
            const framed = Buffer.alloc(2 + query.length);
            framed.writeUInt16BE(query.length, 0);
            query.copy(framed, 2);
            const socket = tlsConnect({
                host: serverIp,
                port: 853,
                servername: dotHost, // SNI + cert validation against the DoT hostname
                minVersion: "TLSv1.2"
            });
            let settled = false;
            let responseBuf = Buffer.alloc(0);
            let expectedLen = -1;
            const cleanup = () => {
                clearTimeout(timer);
                socket.removeAllListeners();
                socket.destroy();
            };
            const finish = (ip) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                resolve(ip);
            };
            const fail = (err) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                reject(err);
            };
            const timer = setTimeout(() => fail(new Error(`DoT timeout after ${timeoutMs}ms`)), timeoutMs);
            socket.on("secureConnect", () => {
                if (!socket.authorized) {
                    fail(new Error(`DoT TLS cert not authorized: ${socket.authorizationError}`));
                    return;
                }
                socket.write(framed);
            });
            socket.on("data", (chunk) => {
                responseBuf = Buffer.concat([responseBuf, chunk]);
                if (expectedLen < 0 && responseBuf.length >= 2) {
                    expectedLen = responseBuf.readUInt16BE(0);
                }
                if (expectedLen >= 0 && responseBuf.length >= expectedLen + 2) {
                    const dnsMsg = responseBuf.subarray(2, 2 + expectedLen);
                    finish(this.parseDnsAnswer(dnsMsg));
                }
            });
            socket.on("error", err => fail(err instanceof Error ? err : new Error(String(err))));
            socket.on("end", () => {
                if (!settled)
                    fail(new Error("DoT connection closed before a full response"));
            });
        });
    }
    addToCache(hostname, ip) {
        if (this.cache.size >= this.cacheMaxCapacity) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey)
                this.cache.delete(oldestKey);
        }
        const expiresAt = Date.now() + this.ttlMinutes * 60 * 1000;
        this.cache.set(hostname, { hostname, ip, expiresAt });
    }
    getCacheStats() {
        return {
            size: this.cache.size,
            maxCapacity: this.cacheMaxCapacity,
            ttlMinutes: this.ttlMinutes,
            hits: this.cacheHits,
            misses: this.cacheMisses
        };
    }
    setTtlMinutes(minutes) {
        if (minutes >= 1 && minutes <= 60) {
            this.ttlMinutes = minutes;
            this.addLog("info", `DNS Cache TTL set to ${minutes} minutes`);
        }
    }
    clearCache() {
        this.cache.clear();
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.addLog("success", "DNS LRU Cache cleared successfully");
    }
    getDiagnosticLogs() {
        return [...this.diagnosticLogs];
    }
    addLog(level, message) {
        this.diagnosticLogs.push({
            timestamp: Date.now(),
            level,
            message
        });
        if (this.diagnosticLogs.length > 100) {
            this.diagnosticLogs.shift();
        }
    }
    stopDiagnostic() {
        if (this.abortDiagnosticController) {
            this.abortDiagnosticController.abort();
            this.abortDiagnosticController = null;
        }
        this.isDiagnosticRunning = false;
        this.addLog("info", "Diagnostic execution stopped by user.");
    }
    async runDiagnostic(mode) {
        if (this.isDiagnosticRunning) {
            this.stopDiagnostic();
        }
        this.isDiagnosticRunning = true;
        this.abortDiagnosticController = new AbortController();
        const { signal } = this.abortDiagnosticController;
        this.addLog("info", `Starting Diagnostic Test [Mode: ${mode.toUpperCase()}]...`);
        const provider = this.getAllProviders()[this.selectedProviderName] || DNS_PROVIDERS["Cloudflare 1.1.1.1"];
        try {
            if (mode === "doh" || mode === "auto") {
                if (signal.aborted)
                    return;
                this.addLog("info", `Testing DoH endpoint: ${provider.doh}`);
                const latency = await this.pingEndpoint(provider.doh);
                if (signal.aborted)
                    return;
                if (latency >= 0) {
                    this.addLog("success", `DoH endpoint reachable in ${latency}ms`);
                    this.addLog("info", "Resolving test target \"discord.com\" over DoH...");
                    const dohIp = await this.queryDoH(provider.doh, "discord.com", 1500).catch(() => null);
                    if (signal.aborted)
                        return;
                    if (dohIp) {
                        this.addLog("success", `DoH resolution complete. "discord.com" -> ${dohIp}`);
                    }
                    else {
                        this.addLog("warn", "DoH endpoint reachable but returned no A record for the test target.");
                    }
                }
                else {
                    this.addLog("error", "DoH endpoint failed to respond within 1500ms.");
                }
            }
            if (signal.aborted)
                return;
            if (mode === "dot" || mode === "auto") {
                if (!provider.dot) {
                    this.addLog("warn", `Provider "${this.selectedProviderName}" has no DoT (port 853) endpoint configured; skipping DoT test.`);
                }
                else {
                    this.addLog("info", `Testing DoT endpoint: ${provider.dot}:853 (via ${provider.fallback})`);
                    try {
                        const start = Date.now();
                        const dotIp = await this.queryDoT(provider.dot, provider.fallback, "discord.com", 2000);
                        if (signal.aborted)
                            return;
                        const rtt = Date.now() - start;
                        if (dotIp) {
                            this.addLog("success", `DoT endpoint reachable in ${rtt}ms. "discord.com" -> ${dotIp}`);
                        }
                        else {
                            this.addLog("warn", `DoT handshake succeeded in ${rtt}ms but returned no A record for the test target.`);
                        }
                    }
                    catch (dotErr) {
                        if (!signal.aborted) {
                            this.addLog("error", `DoT test failed: ${dotErr?.message || dotErr}`);
                        }
                    }
                }
            }
            if (signal.aborted)
                return;
            // Populate the resolver cache via the normal failover path so the cache row reflects the run.
            const testIp = await this.resolveHostname("discord.com");
            if (signal.aborted)
                return;
            if (testIp) {
                this.addLog("info", `Resolver cache target "discord.com" -> ${testIp}`);
            }
            else {
                this.addLog("warn", "Resolver could not resolve the cache test target \"discord.com\".");
            }
            this.addLog("info", `DNS cache status: ${this.cache.size}/${this.cacheMaxCapacity} entries stored`);
            this.addLog("success", `Diagnostic run [${mode.toUpperCase()}] completed.`);
        }
        catch (err) {
            if (!signal.aborted) {
                this.addLog("error", `Diagnostic failed: ${err?.message || err}`);
            }
        }
        finally {
            this.isDiagnosticRunning = false;
            this.abortDiagnosticController = null;
        }
    }
}
export const dnsResolver = new DnsResolverEngine();
