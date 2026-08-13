/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type RepeatMode = "off" | "context" | "one";

export type ConnectionState = "idle" | "connecting" | "connected" | "error";

export interface PlayerDevice {
    id: string;
    title: string;
    canBePlayer: boolean;
}

export interface PlayerSnapshot {
    trackId: string;
    title: string;
    artists: string;
    artistUrl: string;
    artistsResolved: boolean;
    album: string;
    coverUrl: string;
    positionMs: number;
    durationMs: number;
    isPlaying: boolean;
    shuffle: boolean;
    repeat: RepeatMode;
    volume: number;
    devices: PlayerDevice[];
    activeDeviceId: string;
    activeDeviceName: string;
}

export interface StationEntry {
    deviceId: string;
    name: string;
    platform: string;
    host: string;
    port: number;
    token: string;
}

export interface YnisonStatus {
    state: ConnectionState;
    lastError: string | null;
}

export type YnisonEvent =
    | { type: "status"; status: YnisonStatus; at: number; }
    | { type: "snapshot"; snapshot: PlayerSnapshot; at: number; }
    | { type: "error"; message: string; at: number; }
    | { type: "log"; message: string; at: number; };

export type PlayerCommand =
    | "playPause"
    | "previous"
    | "next"
    | "seek"
    | "setVolume"
    | "toggleMute"
    | "toggleShuffle"
    | "cycleRepeat"
    | "setActiveDevice";

export interface CommandPayload {
    value?: number;
    deviceId?: string;
}
