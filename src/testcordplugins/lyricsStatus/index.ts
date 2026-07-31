/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const logger = new Logger("LyricsStatus");

const settings = definePluginSettings({
    format: {
        type: OptionType.STRING,
        description: "Status template. {lyrics} = current lyric, {song} = track name, {artist} = artist name.",
        default: "🎵 {lyrics}",
    },
    customMessageOnStop: {
        type: OptionType.BOOLEAN,
        description: "Set a custom message as your status when music stops or you disable the plugin",
        default: true,
    },
    customMessage: {
        type: OptionType.STRING,
        description: "The custom message (leave blank to clear).",
        default: "",
        hidden() {
            return !settings.store.customMessageOnStop;
        },
    },
});

// ── Playback tracking ─────────────────────────────────────────────────────────

let isPlaying = false;
let lastPosition = 0;
let lastPositionTs = 0;
let currentTrackId = "";
let currentTrackName = "";
let currentArtist = "";

function getPosition(): number {
    if (!isPlaying) return lastPosition;
    return lastPosition + (Date.now() - lastPositionTs);
}

// ── Lyrics ────────────────────────────────────────────────────────────────────

interface SyncedLine { time: number; text: string; }

const lyricsCache = new Map<string, SyncedLine[] | null>();

function parseLrc(lrc: string): SyncedLine[] {
    const lines: SyncedLine[] = [];
    for (const raw of lrc.split("\n")) {
        const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
        if (!m) continue;
        const time = (parseInt(m[1]) * 60 + parseFloat(m[2])) * 1000;
        const text = m[3].trim();
        if (text) lines.push({ time, text });
    }
    return lines.sort((a, b) => a.time - b.time);
}

// Strip suffixes like "- 2012 Remaster", "(Remastered)", "- Live", etc. that break LrcLib lookups
function cleanTrackName(name: string): string {
    return name
        .replace(/\s*[-–([\s]+(?:remaster(?:ed)?|remix|live|version|edit|radio edit|acoustic|demo|instrumental|extended|deluxe|anniversary|original mix)\b.*/i, "")
        .trim();
}

async function fetchLyrics(track: string, artist: string, id: string, signal?: AbortSignal): Promise<SyncedLine[] | null> {
    if (lyricsCache.has(id)) return lyricsCache.get(id) ?? null;
    const cleanedTrack = cleanTrackName(track);
    try {
        const res = await fetch(`https://lrclib.net/api/get?${new URLSearchParams({ track_name: cleanedTrack, artist_name: artist })}`, { signal });
        if (!res.ok) { lyricsCache.set(id, null); return null; }
        const data = await res.json() as { syncedLyrics?: string; };
        const lines = data.syncedLyrics ? parseLrc(data.syncedLyrics) : null;
        lyricsCache.set(id, lines);
        return lines;
    } catch (e) {
        if (signal?.aborted) return null;
        logger.warn("LrcLib fetch failed:", e);
        lyricsCache.set(id, null);
        return null;
    }
}

function getCurrentLine(lines: SyncedLine[], posMs: number): string | null {
    let current: string | null = null;
    for (const line of lines) {
        if (line.time <= posMs) current = line.text;
        else break;
    }
    return current;
}

// ── Status ────────────────────────────────────────────────────────────────────

const CustomStatusSetting = getUserSettingLazy("status", "customStatus")!;

let lastSentLine: string | null = null;

function setStatus(text: string) {
    if (text === lastSentLine) return;
    lastSentLine = text;
    CustomStatusSetting?.updateSetting({
        text: text.slice(0, 128),
        expiresAtMs: "0",
        emojiId: "0",
        emojiName: "",
        createdAtMs: String(Date.now()),
    });
}

function customStatus() {
    lastSentLine = null;
    CustomStatusSetting?.updateSetting({
        text: settings.store.customMessage,
        expiresAtMs: "0",
        emojiId: "0",
        emojiName: "",
        createdAtMs: "0",
    });
}

// ── Tick loop ─────────────────────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;
let currentLines: SyncedLine[] | null = null;
let active = false;
let lyricGeneration = 0;
let lyricsAbortController: AbortController | null = null;

function tick() {
    if (!active || !isPlaying || !currentLines) return;
    const line = getCurrentLine(currentLines, getPosition());
    if (!line) return;
    const text = settings.store.format
        .replace("{lyrics}", line)
        .replace("{song}", currentTrackName)
        .replace("{artist}", currentArtist);
    setStatus(text);
}

// ── Flux ──────────────────────────────────────────────────────────────────────

interface SpotifyPlayerState {
    track: { id: string; name: string; artists: { name: string; }[]; } | null;
    isPlaying: boolean;
    position: number;
}

function onSpotifyPlayerState(e: SpotifyPlayerState) {
    const newId = e.track?.id ?? "";
    const trackChanged = newId !== currentTrackId;

    isPlaying = e.isPlaying ?? false;
    lastPosition = e.position ?? 0;
    lastPositionTs = Date.now();
    currentTrackId = newId;
    currentTrackName = e.track?.name ?? "";
    currentArtist = e.track?.artists?.[0]?.name ?? "";

    if (trackChanged) {
        currentLines = null;
        lyricsAbortController?.abort();
        const generation = ++lyricGeneration;
        if (currentTrackId) {
            const abortController = new AbortController();
            lyricsAbortController = abortController;
            fetchLyrics(currentTrackName, currentArtist, currentTrackId, abortController.signal)
                .then(lines => {
                    if (active && generation === lyricGeneration && currentTrackId === newId) currentLines = lines;
                })
                .finally(() => {
                    if (lyricsAbortController === abortController) lyricsAbortController = null;
                });
        }
    }

    if (!isPlaying && (settings.store.customMessageOnStop)) customStatus();
}

export default definePlugin({
    name: "LyricsStatus",
    description: "Shows the current Spotify lyric line in your Discord custom status in real time. Lyrics fetched from LrcLib.",
    tags: ["Activity", "Utility"],
    authors: [{ name: "Sharp", id: 0n }],
    settings,

    start() {
        active = true;
        FluxDispatcher.subscribe("SPOTIFY_PLAYER_STATE", onSpotifyPlayerState as any);
        intervalId = setInterval(tick, 2000);
    },

    stop() {
        active = false;
        lyricGeneration++;
        lyricsAbortController?.abort();
        lyricsAbortController = null;
        FluxDispatcher.unsubscribe("SPOTIFY_PLAYER_STATE", onSpotifyPlayerState as any);
        if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
        if (!isPlaying && (settings.store.customMessageOnStop)) customStatus();
        currentLines = null;
        lyricsCache.clear();
        lastSentLine = null;
        isPlaying = false;
        currentTrackId = "";
    },
});
