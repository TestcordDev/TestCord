/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { getUserSettingLazy } from "@api/UserSettings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const logger = new Logger("LyricsStatus");

const settings = definePluginSettings({
    active: {
        type: OptionType.BOOLEAN,
        description: "Persisted active state for Lyrics Status",
        default: true,
        hidden: true,
    },
    format: {
        type: OptionType.STRING,
        description: "Status template. {lyrics} = current lyric, {song} = track name, {artist} = artist name.",
        default: "🎵 {lyrics}",
    },
    customMessageOnStop: {
        type: OptionType.BOOLEAN,
        description: "Set a custom message as your status when music stops or you disable the plugin",
        default: true,
        disabled() {
            return settings.store.lastStatusOnStop;
        }
    },
    customMessage: {
        type: OptionType.STRING,
        description: "The custom message (leave blank to clear).",
        default: "",
        hidden() {
            return !settings.store.customMessageOnStop;
        },
    },
    lastStatusOnStop: {
        type: OptionType.BOOLEAN,
        description: "Restore status from before music started when music stops or you disable the plugin",
        default: false,
        disabled() {
            return settings.store.customMessageOnStop;
        }
    },
    showPanelButton: {
        type: OptionType.BOOLEAN,
        description: "Add a button in the user area panel",
        default: true,
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
let savedOriginalStatus: any = null;

function saveOriginalStatus() {
    if (savedOriginalStatus === null && CustomStatusSetting) {
        const current = CustomStatusSetting.getSetting();
        savedOriginalStatus = current ? { ...current } : null;
    }
}

function restoreOriginalStatus() {
    if (savedOriginalStatus !== null && CustomStatusSetting) {
        lastSentLine = null;
        CustomStatusSetting.updateSetting(savedOriginalStatus);
        savedOriginalStatus = null;
    }
}

function setStatus(text: string) {
    if (text === lastSentLine) return;
    saveOriginalStatus();
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
    savedOriginalStatus = null;
}

function handleStopStatus() {
    if (settings.store.lastStatusOnStop) {
        restoreOriginalStatus();
    } else if (settings.store.customMessageOnStop) {
        customStatus();
    }
}

// ── Tick loop ─────────────────────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;
let currentLines: SyncedLine[] | null = null;
let lyricGeneration = 0;
let lyricsAbortController: AbortController | null = null;

function tick() {
    if (!settings.store.active || !isPlaying || !currentLines) return;
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
                    if (settings.store.active && generation === lyricGeneration && currentTrackId === newId) currentLines = lines;
                })
                .finally(() => {
                    if (lyricsAbortController === abortController) lyricsAbortController = null;
                });
        }
    }

    if (!isPlaying) handleStopStatus();
}

function Icon({ className, active }: { className?: string; active: boolean; }) {
    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: active ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <mask id="lyricsStatusLine">
                <rect width="100%" height="100%" fill="#ffffff" />
                <line
                    className="blackLine"
                    x1="22"
                    y1="2"
                    x2="2"
                    y2="22"
                    stroke="#000000"
                    strokeWidth="6"
                    strokeLinecap="round"
                    style={lineStyle}
                />
            </mask>

            <path
                fill={!active ? "var(--status-danger)" : "currentColor"}
                mask="url(#lyricsStatusLine)"
                d="M8.65 1.51A2 2 0 0 0 6 3.41v9.88A3.98 3.98 0 0 0 4.5 13C2.57 13 1 14.34 1 16s1.57 3 3.5 3S8 17.66 8 16V5.4l11 3.81v7.08a3.98 3.98 0 0 0-1.5-.29c-1.93 0-3.5 1.34-3.5 3s1.57 3 3.5 3 3.5-1.34 3.5-3V7.03c0-.74-.47-1.4-1.18-1.65L8.65 1.51Z"
            />

            <line
                x1="22"
                y1="2"
                x2="2"
                y2="22"
                stroke="var(--status-danger, currentColor)"
                strokeWidth="2"
                strokeLinecap="round"
                style={lineStyle}
            />
        </svg>
    );
}

function LyricsStatusToggleButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { active, showPanelButton } = settings.use(["active", "showPanelButton"]);
    if (!showPanelButton) return null;

    return (
        <UserAreaButton
            className="button__201d5 wrapper__201d5"
            tooltipText={hideTooltips ? void 0 : active ? "Disable Lyrics Status" : "Enable Lyrics Status"}
            aria-label="Lyrics Status"
            icon={<Icon className={iconForeground} active={active} />}
            role="switch"
            aria-checked={active}
            redGlow={!active}
            plated={nameplate != null}
            onClick={() => {
                const nextState = !settings.store.active;
                settings.store.active = nextState;

                if (!nextState) {
                    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
                    handleStopStatus();
                } else {
                    tick();
                    if (intervalId === null) intervalId = setInterval(tick, 2000);
                }
            }}
        />
    );
}

export default definePlugin({
    name: "LyricsStatus",
    description: "Shows the current Spotify lyric line in your Discord custom status in real time. Lyrics fetched from LrcLib.",
    tags: ["Activity", "Utility"],
    authors: [{ name: "Sharp", id: 0n }],
    settings,

    userAreaButton: {
        icon: (props: { className?: string; }) => <Icon {...props} active={settings.store.active} />,
        render: LyricsStatusToggleButton
    },

    start() {
        FluxDispatcher.subscribe("SPOTIFY_PLAYER_STATE", onSpotifyPlayerState as any);
        if (settings.store.active) {
            intervalId = setInterval(tick, 2000);
        }
    },

    stop() {
        lyricGeneration++;
        lyricsAbortController?.abort();
        lyricsAbortController = null;
        FluxDispatcher.unsubscribe("SPOTIFY_PLAYER_STATE", onSpotifyPlayerState as any);
        if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
        if (!isPlaying) handleStopStatus();
        currentLines = null;
        lyricsCache.clear();
        lastSentLine = null;
        isPlaying = false;
        currentTrackId = "";
        savedOriginalStatus = null;
    },
});
