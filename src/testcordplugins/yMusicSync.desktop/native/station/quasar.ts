/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { net } from "electron";

import { DEVICE_LIST_URL, GLAGOL_TOKEN_URL } from "./constants";

interface GlagolResponse {
    status?: string;
    message?: string;
    token?: string;
    devices?: { id?: unknown; name?: unknown; platform?: unknown; }[];
}

async function readJson(response: Response, what: string): Promise<GlagolResponse> {
    const text = await response.text();
    let payload: GlagolResponse = {};

    try {
        if (text) payload = JSON.parse(text) as GlagolResponse;
    } catch {
        throw new Error(`${what} returned invalid JSON (HTTP ${response.status})`);
    }

    if (!response.ok || payload.status === "error") {
        throw new Error(`${what} failed: ${payload.message ?? `HTTP ${response.status}`}`);
    }

    return payload;
}

export async function fetchStationNames(musicToken: string): Promise<Map<string, string>> {
    const response = await net.fetch(DEVICE_LIST_URL, {
        headers: { Authorization: `OAuth ${musicToken}` }
    });

    const payload = await readJson(response, "Station list");
    const names = new Map<string, string>();

    for (const device of payload.devices ?? []) {
        const id = String(device.id ?? "");
        const name = String(device.name ?? "");
        if (id && name) names.set(id, name);
    }

    return names;
}

export async function fetchConversationToken(musicToken: string, deviceId: string, platform: string): Promise<string> {
    const url = new URL(GLAGOL_TOKEN_URL);
    url.searchParams.set("device_id", deviceId);
    url.searchParams.set("platform", platform);

    const response = await net.fetch(url.toString(), {
        headers: { Authorization: `OAuth ${musicToken}` }
    });

    const payload = await readJson(response, "Station token");
    if (!payload.token) throw new Error("Station token response was empty");
    return payload.token;
}
