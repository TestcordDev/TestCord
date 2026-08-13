/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";

import { log } from "../state";
import { isPrivateAddress } from "./address";
import { DISCOVERY_TIMEOUT_MS, MDNS_ADDRESS, MDNS_PORT, MDNS_QUERY_DELAYS, MDNS_SERVICE } from "./constants";

export interface DiscoveredStation {
    deviceId: string;
    platform: string;
    name: string;
    host: string;
    port: number;
}

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const QCLASS_IN = 1;
const QCLASS_UNICAST_IN = 0x8001;

function normalize(name: string): string {
    return name.replace(/\.$/, "").toLowerCase();
}

function encodeName(name: string): Buffer {
    const labels = name.split(".").filter(Boolean).map(label => {
        const bytes = Buffer.from(label, "utf8");
        return Buffer.concat([Buffer.from([bytes.length]), bytes]);
    });
    return Buffer.concat([...labels, Buffer.from([0])]);
}

function encodeQuery(questions: { name: string; type: number; }[], unicast: boolean): Buffer {
    const header = Buffer.alloc(12);
    header.writeUInt16BE(questions.length, 4);

    const parts = questions.map(question => {
        const tail = Buffer.alloc(4);
        tail.writeUInt16BE(question.type, 0);
        tail.writeUInt16BE(unicast ? QCLASS_UNICAST_IN : QCLASS_IN, 2);
        return Buffer.concat([encodeName(question.name), tail]);
    });

    return Buffer.concat([header, ...parts]);
}

function readName(buffer: Buffer, offset: number): [string, number] {
    const labels: string[] = [];
    let cursor = offset;
    let next = offset;
    let jumped = false;

    for (let guard = 0; guard < 128; guard++) {
        if (cursor >= buffer.length) break;
        const length = buffer[cursor];

        if (length === 0) {
            cursor++;
            if (!jumped) next = cursor;
            break;
        }

        if ((length & 0xc0) === 0xc0) {
            if (cursor + 1 >= buffer.length) break;
            const pointer = ((length & 0x3f) << 8) | buffer[cursor + 1];
            if (!jumped) next = cursor + 2;
            jumped = true;
            cursor = pointer;
            continue;
        }

        labels.push(buffer.subarray(cursor + 1, cursor + 1 + length).toString("utf8"));
        cursor += 1 + length;
        if (!jumped) next = cursor;
    }

    return [labels.join("."), next];
}

function readTxt(data: Buffer): Map<string, string> {
    const entries = new Map<string, string>();
    let cursor = 0;

    while (cursor < data.length) {
        const length = data[cursor];
        const text = data.subarray(cursor + 1, cursor + 1 + length).toString("utf8");
        const separator = text.indexOf("=");
        if (separator > 0) entries.set(text.slice(0, separator), text.slice(separator + 1));
        cursor += 1 + length;
    }

    return entries;
}

interface Records {
    instances: Set<string>;
    srv: Map<string, { target: string; port: number; }>;
    txt: Map<string, Map<string, string>>;
    addresses: Map<string, string>;
}

function parse(buffer: Buffer, records: Records, onInstance: (name: string) => void): void {
    if (buffer.length < 12) return;

    const questions = buffer.readUInt16BE(4);
    const answers = buffer.readUInt16BE(6) + buffer.readUInt16BE(8) + buffer.readUInt16BE(10);
    let cursor = 12;

    for (let index = 0; index < questions; index++) {
        [, cursor] = readName(buffer, cursor);
        cursor += 4;
    }

    for (let index = 0; index < answers; index++) {
        let name: string;
        [name, cursor] = readName(buffer, cursor);
        if (cursor + 10 > buffer.length) return;

        const type = buffer.readUInt16BE(cursor);
        const length = buffer.readUInt16BE(cursor + 8);
        const start = cursor + 10;
        const data = buffer.subarray(start, start + length);
        cursor = start + length;

        switch (type) {
            case TYPE_PTR: {
                if (normalize(name) !== normalize(MDNS_SERVICE)) break;
                const [instance] = readName(buffer, start);
                if (!records.instances.has(instance)) {
                    records.instances.add(instance);
                    onInstance(instance);
                }
                break;
            }
            case TYPE_SRV: {
                if (data.length < 6) break;
                const [target] = readName(buffer, start + 6);
                records.srv.set(normalize(name), { target: normalize(target), port: data.readUInt16BE(4) });
                break;
            }
            case TYPE_TXT:
                records.txt.set(normalize(name), readTxt(data));
                break;
            case TYPE_A:
                if (data.length === 4) records.addresses.set(normalize(name), Array.from(data).join("."));
                break;
        }
    }
}

function privateInterfaces(): string[] {
    const addresses: string[] = [];

    for (const items of Object.values(networkInterfaces())) {
        for (const item of items ?? []) {
            if (item.internal || (item.family !== "IPv4" && Number(item.family) !== 4)) continue;
            if (isPrivateAddress(item.address)) addresses.push(item.address);
        }
    }

    return addresses;
}

function collect(records: Records): DiscoveredStation[] {
    const stations: DiscoveredStation[] = [];

    for (const instance of records.instances) {
        const service = records.srv.get(normalize(instance));
        const entries = records.txt.get(normalize(instance));
        const deviceId = entries?.get("deviceId") ?? entries?.get("device_id");
        if (!service || !deviceId) continue;

        stations.push({
            deviceId,
            platform: entries?.get("platform") ?? "",
            name: entries?.get("name") ?? instance.split(".")[0],
            host: records.addresses.get(service.target) ?? service.target,
            port: service.port
        });
    }

    return stations;
}

export function discoverStations(): Promise<DiscoveredStation[]> {
    return new Promise(resolve => {
        const records: Records = { instances: new Set(), srv: new Map(), txt: new Map(), addresses: new Map() };
        const timers: NodeJS.Timeout[] = [];
        let socket: Socket | null = null;
        let settled = false;

        const finish = () => {
            if (settled) return;
            settled = true;
            for (const timer of timers) clearTimeout(timer);

            try {
                socket?.close();
            } catch (error) {
                log(`Could not close the mDNS socket: ${String(error)}`);
            }

            resolve(collect(records));
        };

        const send = (query: Buffer) => {
            socket?.send(query, MDNS_PORT, MDNS_ADDRESS, error => {
                if (error) log(`Station discovery query failed: ${error.message}`);
            });
        };

        const askInstance = (instance: string) => send(encodeQuery([
            { name: instance, type: TYPE_SRV },
            { name: instance, type: TYPE_TXT }
        ], false));

        const start = (joined: boolean) => {
            const service = encodeQuery([{ name: MDNS_SERVICE, type: TYPE_PTR }], !joined);

            for (const delay of MDNS_QUERY_DELAYS) {
                if (delay >= DISCOVERY_TIMEOUT_MS) continue;
                const timer = setTimeout(() => send(service), delay);
                timer.unref();
                timers.push(timer);
            }

            const deadline = setTimeout(finish, DISCOVERY_TIMEOUT_MS);
            deadline.unref();
            timers.push(deadline);
        };

        const bind = (port: number) => {
            const current = createSocket({ type: "udp4", reuseAddr: true });
            let bound = false;
            socket = current;

            current.on("message", message => parse(message, records, askInstance));
            current.on("error", error => {
                if (bound || port !== MDNS_PORT) {
                    finish();
                    return;
                }
                log(`Could not bind the mDNS port: ${error.message}`);
                current.close();
                bind(0);
            });

            current.bind(port, () => {
                bound = true;
                let joined = false;

                if (port === MDNS_PORT) {
                    for (const address of privateInterfaces()) {
                        try {
                            current.addMembership(MDNS_ADDRESS, address);
                            joined = true;
                        } catch (error) {
                            log(`Could not join the mDNS group on ${address}: ${String(error)}`);
                        }
                    }
                }

                start(joined);
            });
        };

        bind(MDNS_PORT);
    });
}
