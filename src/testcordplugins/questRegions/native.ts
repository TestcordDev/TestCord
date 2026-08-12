/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
import * as http from "http";
import * as https from "https";

export interface NativeWebhookResponse {
    status: number;
    data: string;
}

export interface NativeProxyResponse {
    status: number;
    body: string;
    error?: string;
}

export interface NativePreflightResponse {
    ok: boolean;
    ms: number;
    error?: string;
}

export type NativeProxyCheckService = "proxycheck" | "ip-api" | "ipify";

export interface NativeBatchProxyCheckEntry {
    ip: string;
    proxy: boolean;
    hosting: boolean;
    countryCode: string | null;
    error?: string;
}

export interface NativeFetchResponse {
    status: number;
    body: string;
    error?: string;
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export async function sendWebhook(_: IpcMainInvokeEvent, webhookUrl: string, payload: string): Promise<NativeWebhookResponse> {
    try {
        const url = new URL(webhookUrl);
        url.searchParams.set("wait", "true");

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
        });

        return {
            status: response.status,
            data: await response.text(),
        };
    } catch (error) {
        return {
            status: -1,
            data: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function fetchTextUrl(_: IpcMainInvokeEvent, url: string): Promise<NativeFetchResponse> {
    try {
        const response = await fetch(url);
        return {
            status: response.status,
            body: await response.text(),
        };
    } catch (error) {
        return {
            status: -1,
            body: "",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function fetchUrlViaProxy(_: IpcMainInvokeEvent, url: string, proxy: string): Promise<NativeProxyResponse> {
    console.debug(`[QuestRegions/Native] fetchUrlViaProxy called — url=${url} proxy=${proxy}`);
    try {
        const target = new URL(url);
        if (target.protocol !== "https:") return { status: -1, body: "", error: "Only https URLs are supported" };

        const [host, portStr] = proxy.split(":");
        const port = parseInt(portStr, 10);
        if (!host || isNaN(port)) return { status: -1, body: "", error: "Invalid proxy format (expected host:port)" };

        const socket = await openProxyTunnel(host, port, target.hostname, Number(target.port) || HTTPS_PORT);
        const result = await new Promise<{ status: number; body: string; }>((resolve, reject) => {
            const timer = setTimeout(() => {
                req.destroy();
                reject(new Error("Proxy URL request timed out"));
            }, PROXY_REQUEST_TIMEOUT_MS);

            const req = https.request({
                createConnection: () => socket,
                hostname: target.hostname,
                port: Number(target.port) || HTTPS_PORT,
                method: "GET",
                path: `${target.pathname}${target.search}`,
                headers: {
                    "Accept": "application/json",
                    "Host": target.hostname,
                    "User-Agent": "discord-api-fetcher/raw-bot",
                    "Connection": "close",
                },
            });

            req.on("response", res => {
                clearTimeout(timer);
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
                res.on("error", reject);
            });
            req.on("error", reject);
            req.end();
        });
        socket.destroy();
        return result;
    } catch (error) {
        return {
            status: -1,
            body: "",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// ─── Proxy helpers ────────────────────────────────────────────────────────────

const DISCORD_API_HOST = "discord.com";
const HTTPS_PORT = 443;
const PROXY_CONNECT_TIMEOUT_MS = 10000;
const PROXY_REQUEST_TIMEOUT_MS = 15000;
const PROXY_CHECK_TIMEOUT_MS = 8000;

/**
 * Opens a CONNECT tunnel through an HTTP proxy and returns a TLS socket
 * connected to discord.com:443 via that tunnel.
 */
function openProxyTunnel(proxyHost: string, proxyPort: number, targetHost = DISCORD_API_HOST, targetPort = HTTPS_PORT): Promise<import("tls").TLSSocket> {
    return new Promise((resolve, reject) => {
        console.debug(`[QuestRegions/Native] CONNECT tunnel → ${proxyHost}:${proxyPort} → ${targetHost}:${targetPort}`);

        const timer = setTimeout(() => {
            req.destroy();
            const err = new Error(`Proxy CONNECT timed out (${proxyHost}:${proxyPort})`);
            console.debug(`[QuestRegions/Native] CONNECT timeout: ${err.message}`);
            reject(err);
        }, PROXY_CONNECT_TIMEOUT_MS);

        const req = http.request({
            host: proxyHost,
            port: proxyPort,
            method: "CONNECT",
            path: `${targetHost}:${targetPort}`,
            timeout: PROXY_CONNECT_TIMEOUT_MS,
        });

        req.on("connect", (_res, socket) => {
            clearTimeout(timer);
            console.debug(`[QuestRegions/Native] CONNECT established via ${proxyHost}:${proxyPort}, upgrading to TLS`);
            const tls = require("tls") as typeof import("tls");
            const tlsSocket = tls.connect({
                socket,
                servername: targetHost,
                rejectUnauthorized: true,
            }, () => {
                console.debug(`[QuestRegions/Native] TLS handshake complete via ${proxyHost}:${proxyPort}`);
                resolve(tlsSocket);
            });
            tlsSocket.on("error", err => {
                console.debug(`[QuestRegions/Native] TLS error via ${proxyHost}:${proxyPort}:`, err.message);
                reject(err);
            });
        });

        req.on("error", err => {
            clearTimeout(timer);
            console.debug(`[QuestRegions/Native] CONNECT request error (${proxyHost}:${proxyPort}):`, err.message);
            reject(err);
        });
        req.end();
    });
}

function parseProxy(proxy: string): { host: string; port: number; } | null {
    const [host, portStr] = proxy.split(":");
    const port = parseInt(portStr, 10);
    if (!host || isNaN(port) || port < 1 || port > 65535) return null;
    return { host, port };
}

async function fetchJsonDirect<T>(url: string): Promise<T> {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(PROXY_CHECK_TIMEOUT_MS),
        headers: { "Accept": "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
}

async function fetchJsonDirectPost<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(PROXY_CHECK_TIMEOUT_MS),
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
}

async function checkProxyIpWithService(proxyHost: string, service: NativeProxyCheckService): Promise<void> {
    if (service === "ipify") return;

    if (service === "ip-api") {
        const url = `http://ip-api.com/json/${encodeURIComponent(proxyHost)}?fields=status,message,proxy,hosting`;
        const data = await fetchJsonDirect<{ status?: string; message?: string; proxy?: boolean; hosting?: boolean; }>(url);
        if (data.status !== "success") throw new Error(data.message || "ip-api lookup failed");
        if (!data.proxy && !data.hosting) throw new Error("ip-api did not classify this IP as proxy/hosting");
        return;
    }

    const url = `https://proxycheck.io/v2/${encodeURIComponent(proxyHost)}?vpn=1`;
    const data = await fetchJsonDirect<Record<string, unknown>>(url);
    const entry = data[proxyHost];
    if (!entry || typeof entry !== "object") throw new Error("proxycheck.io returned no IP result");
    const result = entry as { proxy?: string; vpn?: string; type?: string; };
    if (result.proxy !== "yes" && result.vpn !== "yes" && !result.type) {
        throw new Error("proxycheck.io did not classify this IP as proxy/VPN");
    }
}

async function checkProxyExitWithIpify(proxyHost: string, proxyPort: number): Promise<void> {
    const socket = await openProxyTunnel(proxyHost, proxyPort, "api.ipify.org", HTTPS_PORT);
    try {
        const result = await new Promise<{ status: number; body: string; }>((resolve, reject) => {
            const timer = setTimeout(() => {
                req.destroy();
                reject(new Error("ipify request timed out"));
            }, PROXY_CHECK_TIMEOUT_MS);

            const req = https.request({
                createConnection: () => socket,
                hostname: "api.ipify.org",
                port: HTTPS_PORT,
                method: "GET",
                path: "/?format=json",
                headers: {
                    "Accept": "application/json",
                    "Host": "api.ipify.org",
                    "Connection": "close",
                },
            });

            req.on("response", res => {
                clearTimeout(timer);
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
                res.on("error", reject);
            });
            req.on("error", reject);
            req.end();
        });

        if (result.status < 200 || result.status >= 300) throw new Error(`ipify HTTP ${result.status}`);
        const parsed = JSON.parse(result.body) as { ip?: string; };
        if (parsed.ip !== proxyHost) throw new Error(`ipify returned ${parsed.ip ?? "unknown"} instead of ${proxyHost}`);
    } finally {
        socket.destroy();
    }
}

/**
 * Makes an HTTPS request through a proxy tunnel.
 * Returns status code and response body.
 */
function proxyRequest(
    socket: import("tls").TLSSocket,
    method: string,
    path: string,
    token: string,
    body?: string,
): Promise<{ status: number; body: string; }> {
    return new Promise((resolve, reject) => {
        console.debug(`[QuestRegions/Native] → ${method} https://${DISCORD_API_HOST}${path}${body ? ` body=${body}` : ""}`);

        const timer = setTimeout(() => {
            req.destroy();
            const err = new Error("Proxy request timed out");
            console.debug(`[QuestRegions/Native] Request timed out: ${method} ${path}`);
            reject(err);
        }, PROXY_REQUEST_TIMEOUT_MS);

        const headers: Record<string, string> = {
            "Authorization": token,
            "Host": DISCORD_API_HOST,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9166 Chrome/124.0.6367.243 Electron/30.4.0 Safari/537.36",
            "Content-Type": "application/json",
            "Connection": "close",
        };
        if (body) headers["Content-Length"] = Buffer.byteLength(body).toString();

        const req = https.request({
            createConnection: () => socket,
            hostname: DISCORD_API_HOST,
            port: HTTPS_PORT,
            method,
            path,
            headers,
        });

        req.on("response", res => {
            clearTimeout(timer);
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
                const responseBody = Buffer.concat(chunks).toString("utf8");
                console.debug(`[QuestRegions/Native] ← ${method} ${path} status=${res.statusCode} body=${responseBody.slice(0, 300)}${responseBody.length > 300 ? "…" : ""}`);
                resolve({ status: res.statusCode ?? 0, body: responseBody });
            });
            res.on("error", err => {
                console.debug(`[QuestRegions/Native] Response stream error (${method} ${path}):`, err.message);
                reject(err);
            });
        });

        req.on("error", err => {
            clearTimeout(timer);
            console.debug(`[QuestRegions/Native] Request error (${method} ${path}):`, err.message);
            reject(err);
        });
        if (body) req.write(body);
        req.end();
    });
}

// ─── Exported IPC handlers ────────────────────────────────────────────────────

/**
 * Fetches /quests/@me through a proxy.
 * proxy format: "host:port"
 */
export async function fetchQuestsViaProxy(
    _: IpcMainInvokeEvent,
    proxy: string,
    token: string,
): Promise<NativeProxyResponse> {
    console.debug(`[QuestRegions/Native] fetchQuestsViaProxy called — proxy=${proxy} tokenLen=${token.length}`);
    try {
        const [host, portStr] = proxy.split(":");
        const port = parseInt(portStr, 10);
        if (!host || isNaN(port)) {
            console.debug(`[QuestRegions/Native] fetchQuestsViaProxy: invalid proxy format "${proxy}"`);
            return { status: -1, body: "", error: "Invalid proxy format (expected host:port)" };
        }

        console.debug(`[QuestRegions/Native] fetchQuestsViaProxy: opening tunnel ${host}:${port}`);
        const socket = await openProxyTunnel(host, port);
        const result = await proxyRequest(socket, "GET", "/api/v9/quests/@me", token);
        socket.destroy();
        console.debug(`[QuestRegions/Native] fetchQuestsViaProxy: done — status=${result.status}`);
        return { status: result.status, body: result.body };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.debug("[QuestRegions/Native] fetchQuestsViaProxy error:", msg);
        return { status: -1, body: "", error: msg };
    }
}

export async function preflightProxy(
    _: IpcMainInvokeEvent,
    proxy: string,
    service: NativeProxyCheckService = "proxycheck",
): Promise<NativePreflightResponse> {
    const startedAt = Date.now();
    try {
        const parsed = parseProxy(proxy);
        if (!parsed) {
            return { ok: false, ms: Date.now() - startedAt, error: "Invalid proxy format (expected host:port)" };
        }
        const { host, port } = parsed;

        if (service === "ipify") {
            await checkProxyExitWithIpify(host, port);
        } else {
            await checkProxyIpWithService(host, service);
            const socket = await openProxyTunnel(host, port);
            socket.destroy();
        }

        return { ok: true, ms: Date.now() - startedAt };
    } catch (error) {
        return {
            ok: false,
            ms: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function batchCheckProxyIps(
    _: IpcMainInvokeEvent,
    service: NativeProxyCheckService,
    ips: string[],
): Promise<NativeBatchProxyCheckEntry[]> {
    const uniqueIps = Array.from(new Set(ips.filter(Boolean)));
    if (uniqueIps.length === 0) return [];
    if (service === "ipify") return [];

    try {
        if (service === "ip-api") {
            const data = await fetchJsonDirectPost<Array<{
                query?: string;
                status?: string;
                message?: string;
                countryCode?: string;
                proxy?: boolean;
                hosting?: boolean;
            }>>(
                "http://ip-api.com/batch?fields=status,message,query,countryCode,proxy,hosting",
                uniqueIps.map(query => ({ query })),
            );

            return data.map(entry => ({
                ip: entry.query ?? "",
                proxy: Boolean(entry.proxy),
                hosting: Boolean(entry.hosting),
                countryCode: entry.countryCode?.toUpperCase() ?? null,
                ...(entry.status === "success" ? {} : { error: entry.message ?? "ip-api lookup failed" }),
            })).filter(entry => entry.ip);
        }

        const url = `https://proxycheck.io/v2/${uniqueIps.map(encodeURIComponent).join(",")}?vpn=1`;
        const data = await fetchJsonDirect<Record<string, unknown>>(url);

        return uniqueIps.map(ip => {
            const entry = data[ip];
            if (!entry || typeof entry !== "object") {
                return { ip, proxy: false, hosting: false, countryCode: null, error: "proxycheck.io returned no IP result" };
            }

            const result = entry as { proxy?: string; vpn?: string; type?: string; isocode?: string; countryCode?: string; };
            return {
                ip,
                proxy: result.proxy === "yes" || result.vpn === "yes" || Boolean(result.type),
                hosting: result.vpn === "yes" || result.type === "VPN",
                countryCode: (result.isocode ?? result.countryCode)?.toUpperCase() ?? null,
            };
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return uniqueIps.map(ip => ({ ip, proxy: false, hosting: false, countryCode: null, error: message }));
    }
}

/**
 * Enrolls (starts) a quest through a proxy.
 * proxy format: "host:port"
 */
export async function enrollQuestViaProxy(
    _: IpcMainInvokeEvent,
    questId: string,
    proxy: string,
    token: string,
    payload: string,
): Promise<NativeProxyResponse> {
    console.debug(`[QuestRegions/Native] enrollQuestViaProxy called — questId=${questId} proxy=${proxy} tokenLen=${token.length}`);
    try {
        const [host, portStr] = proxy.split(":");
        const port = parseInt(portStr, 10);
        if (!host || isNaN(port)) {
            console.debug(`[QuestRegions/Native] enrollQuestViaProxy: invalid proxy format "${proxy}"`);
            return { status: -1, body: "", error: "Invalid proxy format (expected host:port)" };
        }

        console.debug(`[QuestRegions/Native] enrollQuestViaProxy: opening tunnel ${host}:${port} for quest ${questId}`);
        const socket = await openProxyTunnel(host, port);
        const result = await proxyRequest(socket, "POST", `/api/v9/quests/${questId}/enroll`, token, payload);
        socket.destroy();
        console.debug(`[QuestRegions/Native] enrollQuestViaProxy: done — status=${result.status} body=${result.body.slice(0, 200)}`);
        return { status: result.status, body: result.body };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.debug("[QuestRegions/Native] enrollQuestViaProxy error:", msg);
        return { status: -1, body: "", error: msg };
    }
}

/**
 * Checks the geo-location country of a proxy by routing through it to ip-api.com.
 * Returns ISO-3166-1 alpha-2 country code (e.g. "CH", "DE") or null on failure.
 * proxy format: "host:port"
 */
export async function geoCheckProxy(
    _: IpcMainInvokeEvent,
    proxy: string,
    timeoutMs = 8000,
): Promise<{ countryCode: string | null; error?: string; }> {
    const GEO_HOST = "ip-api.com";
    const GEO_PORT = 80;
    const GEO_PATH = "/json/?fields=countryCode";
    const geoTimeoutMs = Math.max(3000, Math.min(timeoutMs, 30_000));

    console.debug(`[QuestRegions/Native] geoCheckProxy called — proxy=${proxy}`);

    try {
        const [host, portStr] = proxy.split(":");
        const port = parseInt(portStr, 10);
        if (!host || isNaN(port)) {
            console.debug(`[QuestRegions/Native] geoCheckProxy: invalid proxy format "${proxy}"`);
            return { countryCode: null, error: "Invalid proxy format" };
        }

        const countryCode = await new Promise<string | null>((resolve, reject) => {
            const timer = setTimeout(() => { req.destroy(); reject(new Error("Geo check timed out")); }, geoTimeoutMs);

            const req = http.request({
                host,
                port,
                method: "CONNECT",
                path: `${GEO_HOST}:${GEO_PORT}`,
                timeout: geoTimeoutMs,
            });

            req.on("connect", (_res, socket) => {
                clearTimeout(timer);
                console.debug(`[QuestRegions/Native] geoCheckProxy: CONNECT ok via ${host}:${port}, sending HTTP GET`);
                const innerTimer = setTimeout(() => { socket.destroy(); reject(new Error("Geo request timed out")); }, geoTimeoutMs);
                let raw = "";
                socket.write(`GET ${GEO_PATH} HTTP/1.1\r\nHost: ${GEO_HOST}\r\nConnection: close\r\n\r\n`);
                socket.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
                socket.on("end", () => {
                    clearTimeout(innerTimer);
                    try {
                        const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
                        const parsed = JSON.parse(body) as { countryCode?: string; };
                        const code = parsed.countryCode?.toUpperCase() ?? null;
                        console.debug(`[QuestRegions/Native] geoCheckProxy: ${proxy} → countryCode=${code}`);
                        resolve(code);
                    } catch (e) {
                        console.debug(`[QuestRegions/Native] geoCheckProxy: failed to parse geo response for ${proxy}:`, raw.slice(0, 200));
                        resolve(null);
                    }
                });
                socket.on("error", e => { clearTimeout(innerTimer); reject(e); });
            });

            req.on("error", err => {
                clearTimeout(timer);
                console.debug(`[QuestRegions/Native] geoCheckProxy CONNECT error (${proxy}):`, err.message);
                reject(err);
            });
            req.end();
        });

        return { countryCode };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.debug(`[QuestRegions/Native] geoCheckProxy error (${proxy}):`, msg);
        return { countryCode: null, error: msg };
    }
}

/**
 * Claims a quest reward through the same proxy used to discover it.
 * proxy format: "host:port"
 */
export async function claimQuestViaProxy(
    _: IpcMainInvokeEvent,
    questId: string,
    proxy: string,
    token: string,
    payload: string,
): Promise<NativeProxyResponse> {
    console.debug(`[QuestRegions/Native] claimQuestViaProxy called — questId=${questId} proxy=${proxy} tokenLen=${token.length}`);
    try {
        const [host, portStr] = proxy.split(":");
        const port = parseInt(portStr, 10);
        if (!host || isNaN(port)) {
            console.debug(`[QuestRegions/Native] claimQuestViaProxy: invalid proxy format "${proxy}"`);
            return { status: -1, body: "", error: "Invalid proxy format (expected host:port)" };
        }

        console.debug(`[QuestRegions/Native] claimQuestViaProxy: opening tunnel ${host}:${port} for quest ${questId}`);
        const socket = await openProxyTunnel(host, port);
        const result = await proxyRequest(socket, "POST", `/api/v9/quests/${questId}/claim-reward`, token, payload);
        socket.destroy();
        console.debug(`[QuestRegions/Native] claimQuestViaProxy: done — status=${result.status} body=${result.body.slice(0, 200)}`);
        return { status: result.status, body: result.body };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.debug("[QuestRegions/Native] claimQuestViaProxy error:", msg);
        return { status: -1, body: "", error: msg };
    }
}
