/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { settings } from "@equicordplugins/musicControls/settings";
import { getLyricsLrclib } from "./providers/lrclibAPI";
import { getLyricsSpotify } from "./providers/SpotifyAPI";
import { Provider } from "./providers/types";
const LyricsCacheKey = "SpotifyLyricsCacheNew";
const nullLyricCache = new Map();
export const lyricFetchers = {
    [Provider.Spotify]: async (track) => await getLyricsSpotify(track.id, settings.store.spotifyLyricsApiUrl),
    [Provider.Lrclib]: getLyricsLrclib,
};
export const providers = Object.keys(lyricFetchers);
export async function getLyrics(track) {
    if (!track || !track.id)
        return null;
    const cacheKey = track.id;
    const cached = await DataStore.get(LyricsCacheKey);
    if (cached?.[cacheKey]) {
        return cached[cacheKey];
    }
    const nullCacheEntry = nullLyricCache.get(cacheKey);
    if (nullCacheEntry) {
        const provider = settings.store.lyricsProvider;
        if (!settings.store.fallbackProvider && nullCacheEntry[provider]) {
            return null;
        }
        if (providers.every(p => nullCacheEntry[p])) {
            return null;
        }
    }
    const providersToTry = [settings.store.lyricsProvider, ...providers.filter(p => p !== settings.store.lyricsProvider)];
    for (const provider of providersToTry) {
        const lyricsInfo = await lyricFetchers[provider](track);
        if (lyricsInfo) {
            await DataStore.set(LyricsCacheKey, { ...cached, [cacheKey]: lyricsInfo });
            return lyricsInfo;
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
export async function getLyricsCount() {
    const cache = await DataStore.get(LyricsCacheKey);
    return Object.keys(cache ?? {}).length;
}
export async function updateLyrics(trackId, newLyrics, provider) {
    const cache = await DataStore.get(LyricsCacheKey);
    const current = cache[trackId];
    await DataStore.set(LyricsCacheKey, {
        ...cache, [trackId]: {
            ...current,
            useLyric: provider,
            lyricsVersions: {
                ...current?.lyricsVersions,
                [provider]: newLyrics
            }
        }
    });
}
export async function removeTranslations() {
    const cache = await DataStore.get(LyricsCacheKey);
    const newCache = {};
    for (const [trackId, trackData] of Object.entries(cache)) {
        const { Translated, ...lyricsVersions } = trackData?.lyricsVersions || {};
        const newUseLyric = !!lyricsVersions[Provider.Spotify] ? Provider.Spotify : Provider.Lrclib;
        newCache[trackId] = { lyricsVersions, useLyric: newUseLyric };
    }
    await DataStore.set(LyricsCacheKey, newCache);
}
export async function migrateOldLyrics() {
    const oldCache = await DataStore.get("SpotifyLyricsCache");
    if (!oldCache || !Object.entries(oldCache).length)
        return;
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
