/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { createServer } from "http";
import { join } from "path";

const QUEUE_DIR = "/tmp/opencode/livefix";
const CMD_FILE = join(QUEUE_DIR, "command.json");
const RESP_FILE = join(QUEUE_DIR, "response.json");
const TOKEN_FILE = join(QUEUE_DIR, "token");
const PORT = 18963;

let server: ReturnType<typeof createServer> | null = null;
let authToken: string | null = null;

function isAuthorized(req: import("http").IncomingMessage, body: string): boolean {
    if (authToken === null) return false;

    if (req.headers.authorization === `Bearer ${authToken}`) return true;

    try {
        return JSON.parse(body)?.token === authToken;
    } catch {
        return false;
    }
}

function ensureDir() {
    if (!existsSync(QUEUE_DIR)) mkdirSync(QUEUE_DIR, { recursive: true });
}

const queue: Array<{ body: string; res: import("http").ServerResponse; }> = [];
let inFlight = false;

function processQueue() {
    if (inFlight || queue.length === 0) return;
    inFlight = true;
    const { body, res } = queue.shift()!;

    try {
        writeFileSync(CMD_FILE, body);
        const startTime = Date.now();
        const checkResponse = () => {
            if (existsSync(RESP_FILE)) {
                const resp = readFileSync(RESP_FILE, "utf-8");
                try { unlinkSync(RESP_FILE); } catch { /* */ }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(resp);
                inFlight = false;
                processQueue();
            } else if (Date.now() - startTime > 10000) {
                res.writeHead(504, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Timeout waiting for renderer response" }));
                inFlight = false;
                processQueue();
            } else {
                setTimeout(checkResponse, 50);
            }
        };
        setTimeout(checkResponse, 50);
    } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
        inFlight = false;
        processQueue();
    }
}

export function startLiveFixServer(_: unknown): Promise<string> {
    if (server) return Promise.resolve(authToken!);

    ensureDir();

    return new Promise((resolve, reject) => {
        server = createServer((req, res) => {
            // Browsers attach Origin/Referer to every cross-origin POST; curl does not.
            // Rejecting them keeps websites from driving this endpoint. The exact Host
            // match blocks DNS rebinding, where attacker domains resolve to 127.0.0.1.
            if (req.headers.origin !== undefined || req.headers.referer !== undefined || req.headers.host !== `127.0.0.1:${PORT}`) {
                req.resume();
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Forbidden" }));
                return;
            }

            if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    if (!isAuthorized(req, body)) {
                        res.writeHead(401, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "Unauthorized. Pass the token shown at startup via Authorization: Bearer header or a \"token\" field in the body." }));
                        return;
                    }
                    queue.push({ body, res });
                    processQueue();
                });
            } else {
                res.writeHead(405);
                res.end();
            }
        });

        server.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE") {
                // Port in use means server from a prior renderer is alive — reuse it and its token
                server = null;
                try {
                    authToken = readFileSync(TOKEN_FILE, "utf-8").trim() || null;
                } catch {
                    authToken = null;
                }
                resolve(authToken ?? "");
            } else {
                server = null;
                reject(err);
            }
        });

        server.listen(PORT, "127.0.0.1", () => {
            authToken = randomBytes(32).toString("hex");
            try {
                writeFileSync(TOKEN_FILE, authToken);
                chmodSync(TOKEN_FILE, 0o600);
            } catch { /* Windows or missing perms — token still works via the toast/console */ }
            resolve(authToken);
        });
    });
}

export function stopLiveFixServerCleanup(_: unknown) {
    queue.length = 0;
    inFlight = false;
}

export function stopLiveFixServer(_: unknown) {
    if (server) { server.close(); server = null; }
    authToken = null;
    try { unlinkSync(TOKEN_FILE); } catch { /* already gone */ }
}

export function getCommand(_: unknown): string | null {
    if (!existsSync(CMD_FILE)) return null;
    try {
        const cmd = readFileSync(CMD_FILE, "utf-8");
        unlinkSync(CMD_FILE);
        return cmd;
    } catch {
        return null;
    }
}

export function writeResponse(_: unknown, data: string) {
    writeFileSync(RESP_FILE, data);
}
