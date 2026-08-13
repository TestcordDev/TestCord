/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

import type { CommandPayload, PlayerCommand, YnisonEvent, YnisonStatus } from "../types";
import { runCommand } from "./commands";
import { closeConnection, openConnection } from "./connection";
import { TOKEN_PATTERN } from "./constants";
import { clearCoverCache, resolveCoverDataUrl } from "./covers";
import { awaitEvents, emitStatus, statusSnapshot } from "./events";
import { queueConnectionOperation, state } from "./state";
import { refreshStations, startStations, stopStations } from "./station";

const PLAYER_COMMANDS = new Set<PlayerCommand>([
    "playPause", "previous", "next", "seek", "setVolume",
    "toggleMute", "toggleShuffle", "cycleRepeat", "setActiveDevice"
]);

function clampInt(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(min, Math.trunc(value)), max);
}

// The token goes straight into HTTP and websocket headers, so anything that is
// not a plain token character is dropped rather than passed on.
function sanitizeToken(rawToken: unknown): string {
    const token = String(rawToken ?? "").trim();
    return TOKEN_PATTERN.test(token) ? token : "";
}

export function connect(_: IpcMainInvokeEvent, rawToken: string): Promise<YnisonStatus> {
    const nextToken = sanitizeToken(rawToken);

    return queueConnectionOperation(async () => {
        if (nextToken === state.token && state.socket?.isOpen) return statusSnapshot();

        closeConnection("Reconnecting");
        state.token = nextToken;
        state.reconnectAttempts = 0;

        if (!state.token) {
            emitStatus("idle", null);
            return statusSnapshot();
        }

        await openConnection();
        return statusSnapshot();
    });
}

export function disconnect(_: IpcMainInvokeEvent): YnisonStatus {
    closeConnection("Disconnected by user");
    stopStations();
    clearCoverCache();
    state.token = "";
    emitStatus("idle", null);
    return statusSnapshot();
}

export function getStatus(_: IpcMainInvokeEvent): YnisonStatus {
    return statusSnapshot();
}

export function command(_: IpcMainInvokeEvent, name: PlayerCommand, payload: CommandPayload = {}): boolean {
    if (!PLAYER_COMMANDS.has(name)) return false;

    const value = Number(payload.value);
    return runCommand(name, {
        value: Number.isFinite(value) ? value : undefined,
        deviceId: typeof payload.deviceId === "string" ? payload.deviceId.slice(0, 256) : undefined
    });
}

export function connectStations(_: IpcMainInvokeEvent, rawToken: string): Promise<void> {
    return startStations(sanitizeToken(rawToken));
}

export function rescanStations(_: IpcMainInvokeEvent): Promise<void> {
    return refreshStations();
}

export function getCoverDataUrl(_: IpcMainInvokeEvent, rawUrl: string): Promise<string> {
    return resolveCoverDataUrl(rawUrl);
}

export function waitForEvents(_: IpcMainInvokeEvent, timeout = 30_000): Promise<YnisonEvent[]> {
    return awaitEvents(clampInt(timeout, 1_000, 120_000, 30_000));
}
