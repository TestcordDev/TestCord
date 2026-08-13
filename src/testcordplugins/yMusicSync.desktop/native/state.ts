/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import type { PlayerSnapshot, StationEntry, YnisonStatus } from "../types";
import type { YnisonSocket } from "./ynisonSocket";
import type { YnisonState } from "./ynisonTypes";

export const state = {
    socket: null as YnisonSocket | null,
    connectionState: "idle" as YnisonStatus["state"],
    lastError: null as string | null,
    token: "",
    lastState: null as YnisonState | null,
    lastSnapshot: null as PlayerSnapshot | null,
    mutedVolume: 0,
    selectedDeviceId: "",
    selectedDeviceAt: 0,
    deviceId: "",
    reconnectTimer: null as NodeJS.Timeout | null,
    reconnectAttempts: 0,
    connectionGeneration: 0,
    stationToken: "",
    stations: [] as StationEntry[],
    activeStationId: ""
};

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const logger = new Logger("YMusicSync/native");

export function log(message: string): void {
    logger.info(message);
}

let connectionOperation: Promise<void> = Promise.resolve();

export function queueConnectionOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = connectionOperation.then(operation);
    connectionOperation = result.then(() => undefined, () => undefined);
    return result;
}
