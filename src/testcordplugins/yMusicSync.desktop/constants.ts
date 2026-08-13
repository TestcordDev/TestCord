/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const COVER_SIZE = "400x400";
export const COVER_SIZE_PLACEHOLDER = /(?:%25%25|%%|%257Bsize%257D|%7Bsize%7D|\{size\}|%25s|%s)/gi;

export function lruSet<T>(map: Map<string, T>, key: string, value: T, max: number): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > max) {
        map.delete(map.keys().next().value as string);
    }
}

export const ICONS = {
    play: "M8 5.82v12.36c0 .79.87 1.27 1.54.84l9.14-6.18a1 1 0 0 0 0-1.68L9.54 4.98C8.87 4.55 8 5.03 8 5.82z",
    pause: "M7 5h3v14H7V5zm7 0h3v14h-3V5z",
    previous: "M6 5h2v14H6V5zm3.5 7 8.5 6V6l-8.5 6z",
    next: "M16 5h2v14h-2V5zM6 6v12l8.5-6L6 6z",
    shuffle: "M17 3l4 4-4 4V8h-2.2l-2.3 3.2 2.3 3.2H17v-3l4 4-4 4v-3h-3.2l-2.6-3.6L8.6 16H3v-2h4.6l2.4-3.4L7.6 8H3V6h5.6l2.6 3.6L13.8 6H17V3z",
    repeat: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z",
    repeatOne: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4.6-2.6h1.4V9.6h-1.2l-1.7 1.2v1.4l1.5-1v3.2z",
    volumeMuted: "M4 9v6h4l5 4V5L8 9H4zm12.05 1.64-1.41 1.41 2.12 2.12-2.12 2.12 1.41 1.41 2.12-2.12 2.12 2.12 1.41-1.41-2.12-2.12 2.12-2.12-1.41-1.41-2.12 2.12-2.12-2.12z",
    volumeLow: "M4 9v6h4l5 4V5L8 9H4zm11.5.5a4 4 0 0 1 0 5l1.42 1.42a6 6 0 0 0 0-7.84L15.5 9.5z",
    volumeHigh: "M3 9v6h4l5 4V5L7 9H3zm11.5.5a4 4 0 0 1 0 5l1.42 1.42a6 6 0 0 0 0-7.84L14.5 9.5zm2.83-2.83a8 8 0 0 1 0 10.66l1.42 1.42a10 10 0 0 0 0-13.5l-1.42 1.42z"
} as const;

export const TEXT = {
    cover: "Cover",
    playerLabel: "YMusicSync",
    trackPosition: "Track position",
    volume: "Volume",
    mute: "Mute",
    unmute: "Unmute",
    shuffle: "Shuffle",
    previousTrack: "Previous track",
    nextTrack: "Next track",
    play: "Play",
    pause: "Pause",
    repeat: "Repeat",
    repeatModes: { off: "off", context: "all", one: "one" },
    settings: "Settings",
    devices: "Devices",
    noDevices: "No other Yandex Music devices are online",
    unknownDevice: "Unknown device",
    noActiveDevice: "No player selected"
} as const;
