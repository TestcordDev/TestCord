/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "node:crypto";

import {
    DEVICE_SELECT_RETRY_MS,
    DEVICE_TYPE_CODE,
    HUB_PATH,
    RECONNECT_BASE_MS,
    RECONNECT_MAX_MS,
    REDIRECTOR_TIMEOUT_MS,
    REDIRECTOR_URL
} from "./constants";
import { deviceInfo, isSelfDevice, newVersion } from "./device";
import { emitSnapshot, emitStatus, enqueue } from "./events";
import { mapStateToSnapshot } from "./mapping";
import { errorMessage, log, queueConnectionOperation, state } from "./state";
import { isStationSelected } from "./station";
import { clearTrackCache, resolveTracks } from "./tracks";
import { YnisonSocket } from "./ynisonSocket";
import type { YnisonDevice, YnisonState } from "./ynisonTypes";

interface RedirectorResponse {
    host: string;
    sessionId: string;
    ticket: string;
}

export function wrapRequest(payload: Record<string, unknown>, interception = "DO_NOT_INTERCEPT_BY_DEFAULT"): string {
    return JSON.stringify({
        ...payload,
        rid: randomUUID(),
        player_action_timestamp_ms: Date.now(),
        activity_interception_type: interception
    });
}

function subprotocols(headers: Record<string, string>): string[] {
    return ["Bearer", "v2", encodeURIComponent(JSON.stringify(headers))];
}

function baseHeaders(): Record<string, string> {
    const info = deviceInfo();
    return {
        "Ynison-Device-Id": info.device_id,
        "Ynison-Device-Info": JSON.stringify({
            app_name: info.app_name,
            app_version: info.app_version,
            type: DEVICE_TYPE_CODE
        }),
        authorization: `OAuth ${state.token}`
    };
}

function resolveHub(): Promise<RedirectorResponse> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let client: YnisonSocket | null = null;

        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            client?.close("Redirector timed out");
            reject(new Error("Redirector timed out"));
        }, REDIRECTOR_TIMEOUT_MS);
        timeout.unref();

        YnisonSocket.connect(new URL(REDIRECTOR_URL), subprotocols(baseHeaders()), {
            onMessage(data) {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);

                try {
                    const parsed = JSON.parse(data);
                    const host = String(parsed?.host ?? "");
                    if (!host) throw new Error("Redirector returned no host");
                    resolve({
                        host,
                        sessionId: String(parsed?.session_id ?? ""),
                        ticket: String(parsed?.redirect_ticket ?? "")
                    });
                } catch (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                } finally {
                    client?.close("Redirect resolved");
                }
            },
            onClose(reason) {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                reject(new Error(`Redirector closed: ${reason}`));
            }
        }).then(
            created => {
                client = created;
                if (settled) created.close("Redirect resolved");
            },
            error => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                reject(error);
            }
        );
    });
}

function emptyPlayerState(): YnisonState["player_state"] {
    return {
        player_queue: {
            current_playable_index: -1,
            entity_id: "",
            entity_type: "VARIOUS",
            playable_list: [],
            options: { repeat_mode: "NONE" },
            shuffle_optional: null,
            entity_context: "BASED_ON_ENTITY_BY_DEFAULT",
            version: newVersion(),
            from_optional: "",
            initial_entity_optional: null,
            adding_options_optional: null,
            queue: null
        },
        status: {
            duration_ms: 0,
            paused: true,
            playback_speed: 1,
            progress_ms: 0,
            version: newVersion()
        },
        player_queue_inject_optional: null
    };
}

function sendFullState(client: YnisonSocket): void {
    client.send(wrapRequest({
        update_full_state: {
            player_state: state.lastState?.player_state ?? emptyPlayerState(),
            device: {
                volume: 0,
                capabilities: {
                    can_be_player: false,
                    can_be_remote_controller: true,
                    volume_granularity: 16
                },
                info: deviceInfo(),
                volume_info: { volume: 0, version: null },
                is_shadow: false
            },
            is_currently_active: false,
            sync_state_from_eov_optional: null
        }
    }));
}

function autoSelectDevice(incoming: YnisonState): void {
    const devices = incoming.devices ?? [];
    const playable = (device: YnisonDevice) =>
        device.info?.device_id
        && !isSelfDevice(device.info.device_id)
        && device.capabilities?.can_be_player !== false;

    if (isSelfDevice(state.selectedDeviceId)) {
        state.selectedDeviceId = "";
        state.selectedDeviceAt = 0;
    }
    if (state.selectedDeviceId && !devices.some(device => device.info?.device_id === state.selectedDeviceId)) {
        state.selectedDeviceId = "";
        state.selectedDeviceAt = 0;
    }
    if (state.selectedDeviceId && incoming.active_device_id_optional === state.selectedDeviceId) {
        state.selectedDeviceAt = 0;
    }
    if (state.selectedDeviceId) {
        if (state.selectedDeviceAt && Date.now() - state.selectedDeviceAt < DEVICE_SELECT_RETRY_MS) {
            state.socket?.send(wrapRequest({ update_active_device: { device_id_optional: state.selectedDeviceId } }));
        }
        return;
    }
    if (incoming.active_device_id_optional && !isSelfDevice(incoming.active_device_id_optional)) return;

    const target = devices.find(playable);
    if (!target?.info?.device_id) return;

    state.selectedDeviceId = target.info.device_id;
    log(`Auto-selected Ynison device: ${target.info.title ?? target.info.app_name ?? state.selectedDeviceId}`);
    state.socket?.send(wrapRequest({ update_active_device: { device_id_optional: state.selectedDeviceId } }));
}

interface IncomingMessage {
    state?: unknown;
    error?: { message?: unknown; } | string;
}

function asYnisonState(value: unknown): YnisonState | null {
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<YnisonState>;
    return candidate.player_state ? candidate as YnisonState : null;
}

function pushSnapshot(): void {
    if (state.lastState && !isStationSelected()) emitSnapshot(mapStateToSnapshot(state.lastState));
}

function handleIncoming(data: string): void {
    let parsed: IncomingMessage;
    try {
        parsed = JSON.parse(data) as IncomingMessage;
    } catch (error) {
        log(`Malformed Ynison message: ${errorMessage(error)}`);
        return;
    }

    const incoming = asYnisonState(parsed) ?? asYnisonState(parsed.state);

    if (!incoming) {
        if (parsed.error) {
            const message = typeof parsed.error === "string" ? parsed.error : parsed.error.message;
            enqueue({ type: "error", message: String(message ?? parsed.error), at: Date.now() });
        } else {
            log(`Non-state message: ${data.slice(0, 200)}`);
        }
        return;
    }

    state.lastState = incoming;
    autoSelectDevice(incoming);

    resolveTracks(incoming, pushSnapshot);
    pushSnapshot();
}

function scheduleReconnect(): void {
    if (state.reconnectTimer || !state.token) return;

    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** state.reconnectAttempts);
    state.reconnectAttempts++;
    state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        void queueConnectionOperation(() => openConnection());
    }, delay);
    state.reconnectTimer.unref();
}

export async function openConnection(): Promise<void> {
    if (!state.token) {
        emitStatus("idle", null);
        return;
    }
    if (state.socket?.isOpen) return;

    const generation = ++state.connectionGeneration;
    emitStatus("connecting");

    try {
        const redirect = await resolveHub();
        if (generation !== state.connectionGeneration) return;

        const hubUrl = new URL(`wss://${redirect.host}${HUB_PATH}`);
        const headers = {
            ...baseHeaders(),
            "Ynison-Redirect-Ticket": redirect.ticket,
            "Ynison-Session-Id": redirect.sessionId
        };

        const client = await YnisonSocket.connect(hubUrl, subprotocols(headers), {
            onMessage: handleIncoming,
            onClose(reason) {
                if (generation !== state.connectionGeneration) return;
                state.socket = null;
                emitStatus("error", reason);
                scheduleReconnect();
            }
        });

        if (generation !== state.connectionGeneration) {
            client.close("Superseded");
            return;
        }

        state.socket = client;
        state.reconnectAttempts = 0;
        sendFullState(client);
        emitStatus("connected");
    } catch (error) {
        if (generation !== state.connectionGeneration) return;
        state.socket = null;
        emitStatus("error", errorMessage(error));
        scheduleReconnect();
    }
}

export function closeConnection(reason: string): void {
    state.connectionGeneration++;
    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
    state.socket?.close(reason);
    state.socket = null;
    state.lastState = null;
    state.lastSnapshot = null;
    state.selectedDeviceId = "";
    state.selectedDeviceAt = 0;
    state.reconnectAttempts = 0;
    clearTrackCache();
}
