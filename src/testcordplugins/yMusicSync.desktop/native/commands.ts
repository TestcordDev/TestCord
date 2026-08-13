/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CommandPayload, PlayerCommand } from "../types";
import { wrapRequest } from "./connection";
import { REPEAT_CYCLE, REPEAT_TO_YNISON } from "./constants";
import { isSelfDevice, newVersion } from "./device";
import { emitSnapshot } from "./events";
import { deviceVolume, mapStateToSnapshot, repeatFromYnison, targetDevice } from "./mapping";
import { log, state } from "./state";
import { isStationSelected, releaseStation, runStationCommand, selectStation } from "./station";
import { STATION_PREFIX } from "./station/constants";
import { trackMeta } from "./tracks";

function pushPlayingStatus(): boolean {
    if (!state.socket?.isOpen || !state.lastState) {
        log("Playing status not sent: no open Ynison connection");
        return false;
    }
    state.lastState.player_state.status.version = newVersion();
    return state.socket.send(wrapRequest({
        update_playing_status: { playing_status: state.lastState.player_state.status }
    }));
}

function pushPlayerState(): boolean {
    if (!state.socket?.isOpen || !state.lastState) {
        log("Player state not sent: no open Ynison connection");
        return false;
    }
    state.lastState.player_state.player_queue.version = newVersion();
    state.lastState.player_state.status.version = newVersion();
    return state.socket.send(wrapRequest({
        update_player_state: { player_state: state.lastState.player_state }
    }, "INTERCEPT_IF_NO_ONE_ACTIVE"));
}

function pushVolume(volume: number): boolean {
    if (!state.socket?.isOpen || !state.lastState) {
        log("Volume not sent: no open Ynison connection");
        return false;
    }

    const device = targetDevice(state.lastState);
    const deviceId = device?.info?.device_id ?? state.lastState.active_device_id_optional;
    if (!deviceId) {
        log("Volume not sent: no active device");
        return false;
    }

    const volumeInfo = { volume: Math.min(1, Math.max(0, volume)), version: newVersion() };
    if (device) device.volume_info = volumeInfo;

    return state.socket.send(wrapRequest({
        update_volume_info: { device_id: deviceId, volume_info: volumeInfo }
    }));
}

function moveQueue(delta: number): boolean {
    if (!state.lastState) return false;

    const queue = state.lastState.player_state.player_queue;
    const size = queue.playable_list?.length ?? 0;
    if (size === 0) return false;

    const next = queue.current_playable_index + delta;
    queue.current_playable_index = ((next % size) + size) % size;

    const { status } = state.lastState.player_state;
    const landed = String(queue.playable_list[queue.current_playable_index]?.playable_id ?? "");
    status.duration_ms = trackMeta(landed)?.durationMs ?? 0;
    status.progress_ms = 0;
    status.paused = false;
    return pushPlayerState();
}

export function runCommand(name: PlayerCommand, payload: CommandPayload): boolean {
    const targetDeviceId = name === "setActiveDevice" ? String(payload.deviceId ?? "") : "";

    if (name === "setActiveDevice") {
        if (!targetDeviceId || isSelfDevice(targetDeviceId)) return false;

        if (targetDeviceId.startsWith(STATION_PREFIX)) {
            return selectStation(targetDeviceId.slice(STATION_PREFIX.length));
        }
        releaseStation();
    } else if (isStationSelected()) {
        return runStationCommand(name, payload);
    }

    if (!state.socket?.isOpen || !state.lastState) return false;

    const { status, player_queue: queue } = state.lastState.player_state;
    let sent: boolean;

    switch (name) {
        case "playPause":
            status.paused = !status.paused;
            sent = pushPlayingStatus();
            break;
        case "next":
            sent = moveQueue(1);
            break;
        case "previous":
            sent = moveQueue(-1);
            break;
        case "seek":
            status.progress_ms = Math.max(0, Math.round(payload.value ?? 0));
            sent = pushPlayingStatus();
            break;
        case "setVolume":
            state.mutedVolume = 0;
            sent = pushVolume(payload.value ?? 0);
            break;
        case "toggleMute": {
            const current = deviceVolume(targetDevice(state.lastState));
            if (current > 0) {
                state.mutedVolume = current;
                sent = pushVolume(0);
            } else {
                sent = pushVolume(state.mutedVolume > 0 ? state.mutedVolume : 0.5);
                state.mutedVolume = 0;
            }
            break;
        }
        case "toggleShuffle":
            queue.shuffle_optional = queue.shuffle_optional ? null : { playable_index: queue.current_playable_index };
            sent = pushPlayerState();
            break;
        case "cycleRepeat": {
            const current = repeatFromYnison(queue.options?.repeat_mode);
            const next = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(current) + 1) % REPEAT_CYCLE.length];
            queue.options = { ...queue.options, repeat_mode: REPEAT_TO_YNISON[next] };
            sent = pushPlayerState();
            break;
        }
        case "setActiveDevice":
            state.selectedDeviceId = targetDeviceId;
            state.selectedDeviceAt = Date.now();
            sent = state.socket.send(wrapRequest({ update_active_device: { device_id_optional: targetDeviceId } }));
            break;
        default:
            return false;
    }

    emitSnapshot(mapStateToSnapshot(state.lastState));
    return sent;
}
