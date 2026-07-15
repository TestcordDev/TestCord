import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { createServer } from "http";

const QUEUE_DIR = "/tmp/opencode/livefix";
const CMD_FILE = join(QUEUE_DIR, "command.json");
const RESP_FILE = join(QUEUE_DIR, "response.json");

let server: ReturnType<typeof createServer> | null = null;

function ensureDir() {
    if (!existsSync(QUEUE_DIR)) mkdirSync(QUEUE_DIR, { recursive: true });
}

export function startLiveFixServer(_: unknown) {
    ensureDir();

    server = createServer((req, res) => {
        if (req.method === "POST") {
            let body = "";
            req.on("data", chunk => body += chunk);
            req.on("end", () => {
                try {
                    writeFileSync(CMD_FILE, body);
                    const startTime = Date.now();
                    const checkResponse = () => {
                        if (existsSync(RESP_FILE)) {
                            const resp = readFileSync(RESP_FILE, "utf-8");
                            try { unlinkSync(RESP_FILE); } catch { /* */ }
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(resp);
                        } else if (Date.now() - startTime > 10000) {
                            res.writeHead(504, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ error: "Timeout waiting for renderer response" }));
                        } else {
                            setTimeout(checkResponse, 50);
                        }
                    };
                    setTimeout(checkResponse, 50);
                } catch (e) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: String(e) }));
                }
            });
        } else {
            res.writeHead(405);
            res.end();
        }
    });

    server.listen(18963, "127.0.0.1");
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
