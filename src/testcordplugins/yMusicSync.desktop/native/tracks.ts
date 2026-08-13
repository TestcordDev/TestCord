/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { net } from "electron";

import { lruSet } from "../constants";
import { MAX_ARTIST_CACHE_ENTRIES, TRACKS_FETCH_TIMEOUT_MS, TRACKS_URL } from "./constants";
import { errorMessage, log, state } from "./state";
import type { YnisonState } from "./ynisonTypes";

interface TracksResponse {
    result?: {
        id?: unknown;
        durationMs?: unknown;
        artists?: { id?: unknown; name?: unknown; }[];
    }[];
}

export interface TrackMeta {
    names: string;
    url: string;
    durationMs: number;
}

const EMPTY_META: TrackMeta = { names: "", url: "", durationMs: 0 };

const cache = new Map<string, TrackMeta>();
const lookups = new Set<string>();

export function trackMeta(trackId: string): TrackMeta | undefined {
    return cache.get(trackId);
}

export function isTrackResolved(trackId: string): boolean {
    return cache.has(trackId);
}

export function clearTrackCache(): void {
    cache.clear();
    lookups.clear();
}

async function fetchTracks(trackIds: string[]): Promise<Map<string, TrackMeta>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRACKS_FETCH_TIMEOUT_MS);
    timeout.unref();

    try {
        const query = trackIds.map(id => encodeURIComponent(id)).join(",");
        const response = await net.fetch(`${TRACKS_URL}?trackIds=${query}`, {
            signal: controller.signal,
            headers: {
                Authorization: `OAuth ${state.token}`,
                "Accept-Language": "ru"
            }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const body = await response.json() as TracksResponse;
        const resolved = new Map<string, TrackMeta>();

        for (const track of body.result ?? []) {
            const id = String(track.id ?? "");
            if (!id) continue;

            const artists = track.artists ?? [];
            const firstId = String(artists[0]?.id ?? "");
            const duration = Number(track.durationMs ?? 0);

            resolved.set(id, {
                names: artists.map(artist => String(artist.name ?? "")).filter(Boolean).join(", "),
                url: firstId ? `https://music.yandex.ru/artist/${firstId}` : "",
                durationMs: Number.isFinite(duration) ? Math.max(0, duration) : 0
            });
        }

        return resolved;
    } finally {
        clearTimeout(timeout);
    }
}

function wantedIds(ynisonState: YnisonState): string[] {
    const queue = ynisonState.player_state?.player_queue;
    const list = Array.isArray(queue?.playable_list) ? queue.playable_list : [];
    const index = Number.isInteger(queue?.current_playable_index) ? queue.current_playable_index : -1;
    if (list.length === 0 || index < 0) return [];

    const wanted: string[] = [];
    for (const offset of [0, 1, -1]) {
        const id = String(list[((index + offset) % list.length + list.length) % list.length]?.playable_id ?? "");
        if (!id || wanted.includes(id) || cache.has(id) || lookups.has(id)) continue;
        wanted.push(id);
    }
    return wanted;
}

export function resolveTracks(ynisonState: YnisonState, onResolved: () => void): void {
    if (!state.token) return;

    const wanted = wantedIds(ynisonState);
    if (wanted.length === 0) return;

    for (const id of wanted) lookups.add(id);

    void fetchTracks(wanted)
        .then(resolved => {
            for (const id of wanted) lruSet(cache, id, resolved.get(id) ?? EMPTY_META, MAX_ARTIST_CACHE_ENTRIES);
        })
        .catch(error => {
            for (const id of wanted) lruSet(cache, id, EMPTY_META, MAX_ARTIST_CACHE_ENTRIES);
            log(`Track lookup failed: ${errorMessage(error)}`);
        })
        .finally(() => {
            for (const id of wanted) lookups.delete(id);
            onResolved();
        });
}
