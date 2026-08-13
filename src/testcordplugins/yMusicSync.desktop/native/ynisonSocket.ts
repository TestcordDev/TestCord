/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash, randomBytes } from "node:crypto";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const KEEPALIVE_DELAY_MS = 30_000;
const EMPTY = Buffer.alloc(0);

export interface SocketHandlers {
    onMessage(data: string): void;
    onClose(reason: string): void;
}

export interface SocketOptions {
    rejectUnauthorized?: boolean;
}

export class YnisonSocket {
    private socket: TLSSocket | null = null;
    private buffer: Buffer<ArrayBufferLike> = EMPTY;
    private fragmentOpcode: number | null = null;
    private fragments: Buffer[] = [];
    private fragmentBytes = 0;
    private closed = false;

    private constructor(socket: TLSSocket, private readonly handlers: SocketHandlers) {
        this.socket = socket;
        socket.on("data", (chunk: Buffer) => this.parseFrames(chunk));
        socket.on("error", error => this.destroy(error instanceof Error ? error.message : String(error)));
        socket.on("close", () => this.destroy("Socket closed"));
    }

    static connect(url: URL, protocols: string[], handlers: SocketHandlers, options: SocketOptions = {}): Promise<YnisonSocket> {
        return new Promise((resolve, reject) => {
            const key = randomBytes(16).toString("base64");
            const expectedAccept = createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");

            const socket = tlsConnect({
                host: url.hostname,
                port: url.port ? Number(url.port) : 443,
                servername: /^[\d.]+$/.test(url.hostname) ? undefined : url.hostname,
                ALPNProtocols: ["http/1.1"],
                rejectUnauthorized: options.rejectUnauthorized !== false
            });

            socket.setKeepAlive(true, KEEPALIVE_DELAY_MS);

            let settled = false;
            let head = Buffer.alloc(0);

            const timeout = setTimeout(() => fail(new Error("Handshake timed out")), HANDSHAKE_TIMEOUT_MS);
            timeout.unref();

            const cleanup = () => {
                clearTimeout(timeout);
                socket.removeListener("data", onData);
                socket.removeListener("error", onError);
                socket.removeListener("close", onClose);
            };

            function fail(error: Error) {
                if (settled) return;
                settled = true;
                cleanup();
                socket.destroy();
                reject(error);
            }

            const onError = (error: Error) => fail(error);
            const onClose = () => fail(new Error("Connection closed during handshake"));

            const onData = (chunk: Buffer) => {
                head = Buffer.concat([head, chunk]);
                const separator = head.indexOf("\r\n\r\n");
                if (separator === -1) {
                    if (head.length > 64 * 1024) fail(new Error("Handshake response is too large"));
                    return;
                }

                const rawHeaders = head.subarray(0, separator).toString("latin1");
                const rest = head.subarray(separator + 4);
                const [statusLine, ...headerLines] = rawHeaders.split("\r\n");

                if (!/^HTTP\/1\.1 101/i.test(statusLine)) {
                    const details = headerLines
                        .filter(line => /^(ynison-|x-ynison|grpc-message)/i.test(line))
                        .join("; ");
                    fail(new Error(`Unexpected handshake response: ${statusLine}${details ? ` (${details})` : ""}`));
                    return;
                }

                const accept = headerLines
                    .find(line => line.toLowerCase().startsWith("sec-websocket-accept:"))
                    ?.slice("sec-websocket-accept:".length)
                    .trim();

                if (accept !== expectedAccept) {
                    fail(new Error("Invalid Sec-WebSocket-Accept"));
                    return;
                }

                settled = true;
                cleanup();

                const client = new YnisonSocket(socket, handlers);
                if (rest.length > 0) client.parseFrames(rest);
                resolve(client);
            };

            socket.on("error", onError);
            socket.on("close", onClose);
            socket.on("data", onData);

            socket.on("secureConnect", () => {
                const request = [
                    `GET ${url.pathname}${url.search} HTTP/1.1`,
                    `Host: ${url.host}`,
                    "Upgrade: websocket",
                    "Connection: Upgrade",
                    `Sec-WebSocket-Key: ${key}`,
                    "Sec-WebSocket-Version: 13",
                    ...(protocols.length > 0 ? [`Sec-WebSocket-Protocol: ${protocols.join(", ")}`] : []),
                    "Origin: https://music.yandex.ru",
                    "",
                    ""
                ].join("\r\n");
                socket.write(request);
            });
        });
    }

    get isOpen(): boolean {
        return !this.closed && this.socket !== null && !this.socket.destroyed;
    }

    send(data: string): boolean {
        return this.sendFrame(0x1, Buffer.from(data, "utf8"));
    }

    close(reason = "Client closed"): void {
        if (this.isOpen) {
            const payload = Buffer.alloc(2);
            payload.writeUInt16BE(1000, 0);
            this.sendFrame(0x8, payload);
        }
        this.destroy(reason);
    }

    private destroy(reason: string): void {
        if (this.closed) return;
        this.closed = true;
        this.socket?.destroy();
        this.socket = null;
        this.buffer = EMPTY;
        this.fragments = [];
        this.handlers.onClose(reason);
    }

    private sendFrame(opcode: number, payload: Buffer): boolean {
        const { socket } = this;
        if (!this.isOpen || socket === null) return false;

        const mask = randomBytes(4);
        const { length } = payload;
        const headerBytes = length < 126 ? 2 : length < 65536 ? 4 : 10;

        const frame = Buffer.allocUnsafe(headerBytes + 4 + length);
        frame[0] = 0x80 | opcode;

        if (headerBytes === 2) {
            frame[1] = 0x80 | length;
        } else if (headerBytes === 4) {
            frame[1] = 0x80 | 126;
            frame.writeUInt16BE(length, 2);
        } else {
            frame[1] = 0x80 | 127;
            frame.writeBigUInt64BE(BigInt(length), 2);
        }

        mask.copy(frame, headerBytes);

        const body = headerBytes + 4;
        for (let index = 0; index < length; index++) {
            frame[body + index] = payload[index] ^ mask[index & 3];
        }

        socket.write(frame);
        return true;
    }

    private parseFrames(chunk: Buffer<ArrayBufferLike>): void {
        if (this.closed) return;

        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

        while (this.buffer.length >= 2) {
            const first = this.buffer[0];
            const second = this.buffer[1];
            const fin = (first & 0x80) !== 0;
            const opcode = first & 0x0f;
            const masked = (second & 0x80) !== 0;
            let length = second & 0x7f;
            let offset = 2;

            if (length === 126) {
                if (this.buffer.length < offset + 2) return;
                length = this.buffer.readUInt16BE(offset);
                offset += 2;
            } else if (length === 127) {
                if (this.buffer.length < offset + 8) return;
                const big = this.buffer.readBigUInt64BE(offset);
                if (big > BigInt(MAX_MESSAGE_BYTES)) {
                    this.destroy("Frame is too large");
                    return;
                }
                length = Number(big);
                offset += 8;
            }

            if (masked) {
                this.destroy("Server sent a masked frame");
                return;
            }

            if (this.buffer.length < offset + length) return;

            const payload = this.buffer.subarray(offset, offset + length);
            const rest = this.buffer.subarray(offset + length);
            this.buffer = rest.length === 0 ? EMPTY : Buffer.from(rest);

            if (!this.processFrame(fin, opcode, payload)) return;
        }
    }

    private processFrame(fin: boolean, opcode: number, payload: Buffer): boolean {
        switch (opcode) {
            case 0x8: {
                const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
                const detail = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
                this.close(`Server closed the connection (${code}${detail ? `: ${detail}` : ""})`);
                return false;
            }
            case 0x9:
                this.sendFrame(0xa, Buffer.from(payload));
                return true;
            case 0xa:
                return true;
            case 0x0:
                if (this.fragmentOpcode === null) {
                    this.destroy("Continuation frame without a start frame");
                    return false;
                }
                break;
            case 0x1:
                if (this.fragmentOpcode !== null) {
                    this.destroy("Nested fragmented message");
                    return false;
                }
                if (!fin) {
                    this.fragmentOpcode = opcode;
                    this.fragments = [Buffer.from(payload)];
                    this.fragmentBytes = payload.length;
                    return true;
                }
                this.emitText(payload);
                return true;
            default:
                this.destroy(`Unsupported opcode ${opcode}`);
                return false;
        }

        this.fragments.push(Buffer.from(payload));
        this.fragmentBytes += payload.length;

        if (this.fragmentBytes > MAX_MESSAGE_BYTES) {
            this.destroy("Message is too large");
            return false;
        }

        if (!fin) return true;

        const complete = Buffer.concat(this.fragments, this.fragmentBytes);
        this.fragmentOpcode = null;
        this.fragments = [];
        this.fragmentBytes = 0;
        this.emitText(complete);
        return true;
    }

    private emitText(payload: Buffer): void {
        if (payload.length > MAX_MESSAGE_BYTES) {
            this.destroy("Message is too large");
            return;
        }
        this.handlers.onMessage(payload.toString("utf8"));
    }
}
