/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
export const state = {
    socket: null,
    connectionState: "idle",
    lastError: null,
    token: "",
    lastState: null,
    lastSnapshot: null,
    mutedVolume: 0,
    selectedDeviceId: "",
    selectedDeviceAt: 0,
    deviceId: "",
    reconnectTimer: null,
    reconnectAttempts: 0,
    connectionGeneration: 0,
    stationToken: "",
    stations: [],
    activeStationId: ""
};
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
const logger = new Logger("YMusicSync/native");
export function log(message) {
    logger.info(message);
}
let connectionOperation = Promise.resolve();
export function queueConnectionOperation(operation) {
    const result = connectionOperation.then(operation);
    connectionOperation = result.then(() => undefined, () => undefined);
    return result;
}
