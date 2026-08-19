/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { settings } from "..";
import { navidromePassword } from "./constants";
const salt = "nvdrpc";
const currentlyActiveStartTime = {};
const ALBUM_ART_CACHE_MAX = 200;
const ALBUM_ART_CACHE_BYTES = 256_000;
const albumArtCache = new Map();
function setAlbumArtCache(id, art) {
    albumArtCache.delete(id);
    albumArtCache.set(id, art);
    let bytes = 0;
    for (const value of albumArtCache.values())
        bytes += value.length;
    while (albumArtCache.size > ALBUM_ART_CACHE_MAX || bytes > ALBUM_ART_CACHE_BYTES) {
        const oldest = albumArtCache.keys().next().value;
        if (!oldest)
            break;
        bytes -= albumArtCache.get(oldest)?.length ?? 0;
        albumArtCache.delete(oldest);
    }
}
export async function req(endpoint) {
    if (!settings.store.isLoggedIn)
        throw new Error("NavidromeRPC: Not logged in");
    const url = new URL(`/rest${endpoint}`, settings.store.serverURL);
    const params = new URLSearchParams({
        "u": settings.store.username || "",
        "t": window.SparkMD5.hash(navidromePassword.get() + salt),
        "s": salt,
        "v": "1.16.1",
        "c": "NavidromeRPC",
        "f": "json"
    });
    url.search = params.toString();
    const request = await fetch(url.href);
    const rtv = await request.json();
    if (rtv["subsonic-response"].status === "failed")
        throw new Error(`NavidromeRPC: ${rtv["subsonic-response"].error.message}`);
    return rtv["subsonic-response"];
}
export async function getNowPlayingTrack() {
    const nowPlayingReq = await req("/getNowPlaying");
    let entriesBelongingToSelf = [];
    try {
        entriesBelongingToSelf = nowPlayingReq.nowPlaying.entry.filter(entry => entry.username === settings.store.username);
        if (entriesBelongingToSelf.length === 0)
            return {
                isPlaying: false
            };
    }
    catch {
        return {
            isPlaying: false
        };
    }
    const entry = entriesBelongingToSelf[0];
    let art = albumArtCache.get(entry.id) || "";
    try {
        if (!art) {
            const lastFMRequest = await (await fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=feff915bf5987580c9dc354d523dc6b9&artist=${encodeURIComponent(entry.albumArtists[0].name)}&album=${encodeURIComponent(entry.album)}&format=json`)).json();
            art = lastFMRequest.album.image.at(-1)?.["#text"] || "";
            setAlbumArtCache(entry.id, art);
        }
    }
    catch { }
    if (settings.store.shouldCalculateTimestamps) {
        const now = Date.now();
        const isThereNoStartTime = !currentlyActiveStartTime.id;
        const repeat = (currentlyActiveStartTime.timestamp + (entry.duration * 1000)) < now;
        const isStartTimeForSameID = entry.id === currentlyActiveStartTime.id;
        const isStartTimeForSameMinsAgo = entry.minutesAgo === currentlyActiveStartTime.minutes;
        if (isThereNoStartTime || repeat || isStartTimeForSameID || isStartTimeForSameMinsAgo) {
            currentlyActiveStartTime.timestamp = now - (entry.minutesAgo * 60 * 1000);
            currentlyActiveStartTime.id = entry.id;
            currentlyActiveStartTime.minutes = entry.minutesAgo;
        }
        return {
            isPlaying: true,
            title: entry.title,
            artists: entry.artists.map(a => a.name),
            album: {
                artist: entry.albumArtists[0].name,
                name: entry.album,
                art
            },
            timestamps: {
                start: String(currentlyActiveStartTime.timestamp),
                end: String(currentlyActiveStartTime.timestamp + (entry.duration * 1000))
            }
        };
    }
    else
        return {
            isPlaying: true,
            title: entry.title,
            artists: entry.artists.map(a => a.name),
            album: {
                artist: entry.albumArtists[0].name,
                name: entry.album,
                art
            }
        };
}
