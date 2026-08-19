/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { isSelfDevice } from "./device";
import { state } from "./state";
import { stationDevices } from "./station/devices";
import { trackMeta } from "./tracks";
export function absoluteCoverUrl(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw)
        return "";
    if (raw.startsWith("//"))
        return `https:${raw}`;
    if (raw.startsWith("http://"))
        return `https://${raw.slice("http://".length)}`;
    if (raw.startsWith("https://"))
        return raw;
    return `https://${raw}`;
}
export function repeatFromYnison(value) {
    switch (String(value ?? "NONE").toUpperCase()) {
        case "ONE": return "one";
        case "CONTEXT":
        case "ALL": return "context";
        default: return "off";
    }
}
export function targetDevice(ynisonState) {
    const devices = ynisonState.devices ?? [];
    const byId = (id) => (id
        ? devices.find(device => device.info?.device_id === id) ?? null
        : null);
    return byId(state.selectedDeviceId)
        ?? byId(ynisonState.active_device_id_optional ?? "")
        ?? devices.find(device => !isSelfDevice(device.info?.device_id)
            && device.capabilities?.can_be_player !== false) ?? null;
}
export function deviceVolume(device) {
    const raw = device?.volume_info?.volume ?? device?.volume ?? 0;
    if (!Number.isFinite(raw))
        return 0;
    return Math.min(1, Math.max(0, raw > 1 ? raw / 100 : raw));
}
let lastYnisonSignature = "";
let lastYnisonDevices = [];
function ynisonDevices(activeId) {
    const byTitle = new Map();
    for (const device of state.lastState?.devices ?? []) {
        const id = String(device.info?.device_id ?? "");
        if (!id || isSelfDevice(id))
            continue;
        if (device.is_shadow && id !== activeId)
            continue;
        const entry = {
            id,
            title: String(device.info?.title ?? device.info?.app_name ?? id),
            canBePlayer: id === activeId || device.capabilities?.can_be_player !== false
        };
        const existing = byTitle.get(entry.title);
        if (!existing || (existing.id !== activeId && (entry.id === activeId || (!existing.canBePlayer && entry.canBePlayer)))) {
            byTitle.set(entry.title, entry);
        }
    }
    const signature = [...byTitle.values()].map(entry => `${entry.id}:${entry.title}:${entry.canBePlayer}`).join("|");
    if (signature === lastYnisonSignature)
        return lastYnisonDevices;
    lastYnisonSignature = signature;
    lastYnisonDevices = [...byTitle.values()];
    return lastYnisonDevices;
}
export function playerDevices(activeId) {
    return [...ynisonDevices(activeId), ...stationDevices()];
}
export function mapStateToSnapshot(ynisonState) {
    const queue = ynisonState.player_state?.player_queue;
    const status = ynisonState.player_state?.status;
    const list = Array.isArray(queue?.playable_list) ? queue.playable_list : [];
    const index = Number.isInteger(queue?.current_playable_index) ? queue.current_playable_index : -1;
    const current = index >= 0 ? list[index] : undefined;
    const trackId = String(current?.playable_id ?? "");
    const meta = trackMeta(trackId);
    const device = targetDevice(ynisonState);
    const activeDeviceId = String(device?.info?.device_id ?? "");
    return {
        trackId,
        title: String(current?.title ?? ""),
        artists: meta?.names ?? "",
        artistUrl: meta?.url ?? "",
        artistsResolved: !trackId || meta !== undefined,
        album: String(current?.album_title_optional ?? ""),
        coverUrl: absoluteCoverUrl(current?.cover_url_optional),
        positionMs: Number(status?.progress_ms ?? 0),
        durationMs: meta?.durationMs || Number(status?.duration_ms ?? 0),
        isPlaying: !(status?.paused ?? true),
        shuffle: Boolean(queue?.shuffle_optional),
        repeat: repeatFromYnison(queue?.options?.repeat_mode),
        volume: deviceVolume(device),
        devices: playerDevices(activeDeviceId),
        activeDeviceId,
        activeDeviceName: String(device?.info?.title ?? device?.info?.app_name ?? "")
    };
}
