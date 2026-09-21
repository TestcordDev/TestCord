/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

interface MirrorEntry {
    activity: unknown;
    updatedAt: number;
    owner: string;
}

type MirrorState = Record<string, MirrorEntry>;

const MIRROR_FILE = join(tmpdir(), "testcord-rpc-mirror.json");
const KEY_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const OWNER_RE = /^[A-Za-z0-9]{1,16}$/;
const MAX_ACTIVITY_BYTES = 16 * 1024;
const MAX_ENTRIES = 32;

let memoryCache: MirrorState = {};

function isEntry(value: unknown): value is MirrorEntry {
    return typeof value === "object" &&
        value !== null &&
        "activity" in value &&
        "updatedAt" in value &&
        typeof (value as MirrorEntry).updatedAt === "number" &&
        (!("owner" in value) || typeof (value as MirrorEntry).owner === "string");
}

function isKey(value: unknown): value is string {
    return typeof value === "string" && KEY_RE.test(value);
}

function isOwner(value: unknown): value is string {
    return typeof value === "string" && OWNER_RE.test(value);
}

function readState(): MirrorState {
    try {
        if (!existsSync(MIRROR_FILE)) return { ...memoryCache };
        const raw = readFileSync(MIRROR_FILE, "utf-8");
        if (!raw) return { ...memoryCache };
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return { ...memoryCache };

        const clean: MirrorState = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (!isKey(key) || !isEntry(value)) continue;
            clean[key] = { activity: value.activity ?? null, updatedAt: value.updatedAt, owner: isOwner(value.owner) ? value.owner : "unknown" };
            if (Object.keys(clean).length >= MAX_ENTRIES) break;
        }
        memoryCache = clean;
        return { ...clean };
    } catch {
        return { ...memoryCache };
    }
}

function writeState(state: MirrorState) {
    memoryCache = { ...state };
    try {
        writeFileSync(MIRROR_FILE, JSON.stringify(state), "utf-8");
    } catch {
        // Tmp file may be unavailable. Memory cache still shares across MultiInstance windows.
    }
}

export function pushMirrorActivity(_event: IpcMainInvokeEvent, rawKey: unknown, rawActivityJson: unknown, rawOwner: unknown): { ok: boolean; } {
    if (!isKey(rawKey)) return { ok: false };
    if (rawActivityJson !== null && !(typeof rawActivityJson === "string" && rawActivityJson.length <= MAX_ACTIVITY_BYTES)) {
        return { ok: false };
    }
    const owner = isOwner(rawOwner) ? rawOwner : "unknown";

    let activity: unknown = null;
    if (typeof rawActivityJson === "string" && rawActivityJson.length > 0) {
        try {
            activity = JSON.parse(rawActivityJson);
        } catch {
            return { ok: false };
        }
        if (typeof activity !== "object" || activity === null || Array.isArray(activity)) return { ok: false };
    }

    const state = readState();
    if (activity === null) {
        delete state[rawKey];
    } else {
        if (!(rawKey in state) && Object.keys(state).length >= MAX_ENTRIES) return { ok: false };
        state[rawKey] = { activity, updatedAt: Date.now(), owner };
    }
    writeState(state);
    return { ok: true };
}

export function pullMirrorActivities(_event: IpcMainInvokeEvent): { entries: MirrorState; } {
    return { entries: readState() };
}
