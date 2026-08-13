/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";

import { CLIENT_NAME, CLIENT_VERSION } from "./constants";
import { errorMessage, log, state } from "./state";
import type { YnisonVersion } from "./ynisonTypes";

function deviceIdPath(): string {
    return join(app.getPath("userData"), "ymusicsync-device.json");
}

export function getDeviceId(): string {
    if (state.deviceId) return state.deviceId;

    const path = deviceIdPath();
    try {
        const stored = JSON.parse(readFileSync(path, "utf8"));
        if (typeof stored?.deviceId === "string" && stored.deviceId.length > 0) {
            state.deviceId = stored.deviceId;
            return state.deviceId;
        }
    } catch (error) {
        log(`No stored device id, generating a new one: ${errorMessage(error)}`);
    }

    state.deviceId = randomUUID();
    try {
        writeFileSync(path, JSON.stringify({ deviceId: state.deviceId }), "utf8");
    } catch (error) {
        log(`Could not persist device id: ${errorMessage(error)}`);
    }
    return state.deviceId;
}

export function isSelfDevice(deviceId: unknown): boolean {
    return typeof deviceId === "string" && deviceId.length > 0 && deviceId === getDeviceId();
}

export function deviceInfo() {
    return {
        app_name: CLIENT_NAME,
        app_version: CLIENT_VERSION,
        title: CLIENT_NAME,
        device_id: getDeviceId(),
        type: "WEB"
    };
}

export function newVersion(): YnisonVersion {
    return {
        device_id: getDeviceId(),
        version: Number.MAX_SAFE_INTEGER - Math.floor(Math.random() * 1000),
        timestamp_ms: Date.now()
    };
}
