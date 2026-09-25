/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { Track } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";

import { getLyricsLrclib } from "./providers/lrclibAPI";
import { getLyricsSpicyLyrics } from "./providers/SpicyLyricsAPI";
import { getLyricsSpotify } from "./providers/SpotifyAPI";
import { LyricsData, Provider, SyncedLyric } from "./providers/types";

const LyricsCacheKey = "SpotifyLyricsCacheNew";

interface NullLyricCacheEntry {
    [Provider.Lrclib]?: boolean;
    [Provider.Spotify]?: boolean;
    [Provider.SpicyLyrics]?: boolean;
}

const nullLyricCache = new Map<string, NullLyricCacheEntry>();

export const lyricFetchers = {
    [Provider.Spotify]: async (track: Track) => await getLyricsSpotify(track.id, settings.store.spotifyLyricsApiUrl),
    [Provider.Lrclib]: getLyricsLrclib,
    [Provider.SpicyLyrics]: async (track: Track) => await getLyricsSpicyLyrics(track.id, settings.store.spicyLyricsApiKey),
};

export const providers = Object.keys(lyricFetchers) as Provider[];

export async function getLyrics(track: Track | null): Promise<LyricsData | null> {
    if (!track || !track.id) return null;

    const cacheKey = track.id;
    const cached = await DataStore.get(LyricsCacheKey) as Record<string, LyricsData | null>;
    const requestedProvider = settings.store.lyricsProvider;
    const fallbackEnabled = settings.store.fallbackProvider;

    if (cached?.[cacheKey]) {
        const cachedData = cached[cacheKey]!;
        if (cachedData.lyricsVersions?.[requestedProvider]) {
            return {
                ...cachedData,
                useLyric: requestedProvider
            };
        }
        if (fallbackEnabled && cachedData.lyricsVersions?.[cachedData.useLyric]) {
            return cachedData;
        }
    }

    const nullCacheEntry = nullLyricCache.get(cacheKey);

    if (nullCacheEntry) {
        if (!fallbackEnabled && nullCacheEntry[requestedProvider]) {
            return null;
        }

        if (providers.every(p => nullCacheEntry[p])) {
            return null;
        }
    }

    const providersToTry = fallbackEnabled
        ? [requestedProvider, ...providers.filter(p => p !== requestedProvider)]
        : [requestedProvider];

    for (const provider of providersToTry) {
        const lyricsInfo = await lyricFetchers[provider](track);

        if (lyricsInfo) {
            const existingVersions = cached?.[cacheKey]?.lyricsVersions ?? {};
            const mergedInfo: LyricsData = {
                ...lyricsInfo,
                useLyric: requestedProvider in lyricsInfo.lyricsVersions ? requestedProvider : lyricsInfo.useLyric,
                lyricsVersions: {
                    ...existingVersions,
                    ...lyricsInfo.lyricsVersions
                }
            };
            await DataStore.set(LyricsCacheKey, { ...cached, [cacheKey]: mergedInfo });
            return mergedInfo;
        }

        const updatedNullCacheEntry = nullLyricCache.get(cacheKey) || {};
        nullLyricCache.set(cacheKey, { ...updatedNullCacheEntry, [provider]: true });
    }

    return null;
}

export async function clearLyricsCache() {
    nullLyricCache.clear();
    await DataStore.set(LyricsCacheKey, {});
}

export async function getLyricsCount(): Promise<number> {
    const cache = await DataStore.get(LyricsCacheKey) as Record<string, LyricsData | null>;
    return Object.keys(cache ?? {}).length;
}

export async function updateLyrics(trackId: string, newLyrics: SyncedLyric[], provider: Provider) {
    const cache = await DataStore.get(LyricsCacheKey) as Record<string, LyricsData | null>;
    const current = cache[trackId];

    await DataStore.set(LyricsCacheKey,
        {
            ...cache, [trackId]: {
                ...current,
                useLyric: provider,
                lyricsVersions: {
                    ...current?.lyricsVersions,
                    [provider]: newLyrics
                }
            }
        }
    );
}

export async function removeTranslations() {
    const cache = await DataStore.get(LyricsCacheKey) as Record<string, LyricsData | null>;
    const newCache = {} as Record<string, LyricsData | null>;

    for (const [trackId, trackData] of Object.entries(cache)) {
        const { Translated, ...lyricsVersions } = trackData?.lyricsVersions || {};
        const newUseLyric = lyricsVersions[Provider.Spotify]
            ? Provider.Spotify
            : lyricsVersions[Provider.SpicyLyrics]
                ? Provider.SpicyLyrics
                : Provider.Lrclib;

        newCache[trackId] = { lyricsVersions, useLyric: newUseLyric };
    }

    await DataStore.set(LyricsCacheKey, newCache);
}

export async function migrateOldLyrics() {
    const oldCache = await DataStore.get("SpotifyLyricsCache");
    if (!oldCache || !Object.entries(oldCache).length) return;

    const filteredCache = Object.entries(oldCache).filter(lrc => lrc[1]);
    const result = {};

    filteredCache.forEach(([trackId, lyrics]) => {
        result[trackId] = {
            lyricsVersions: {
                // @ts-ignore
                LRCLIB: lyrics.map(({ time, text }) => ({ time, text }))
            },
            useLyric: "LRCLIB"
        };
    });

    await DataStore.set(LyricsCacheKey, result);
    await DataStore.set("SpotifyLyricsCache", {});
}
