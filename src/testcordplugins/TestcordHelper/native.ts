/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync,writeFileSync } from "fs";
import { createServer } from "http";
import { join } from "path";

const QUEUE_DIR = "/tmp/opencode/livefix";
const CMD_FILE = join(QUEUE_DIR, "command.json");
const RESP_FILE = join(QUEUE_DIR, "response.json");

let server: ReturnType<typeof createServer> | null = null;

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

export function startLiveFixServer(_: unknown): Promise<void> {
    if (server) return Promise.resolve();

    ensureDir();

    return new Promise((resolve, reject) => {
        server = createServer((req, res) => {
            if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
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
                // Port in use means server from a prior renderer is alive — reuse it
                server = null;
                resolve();
            } else {
                server = null;
                reject(err);
            }
        });

        server.listen(18963, "127.0.0.1", () => resolve());
    });
}

export function stopLiveFixServerCleanup(_: unknown) {
    queue.length = 0;
    inFlight = false;
}

export function stopLiveFixServer(_: unknown) {
    if (server) { server.close(); server = null; }
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
