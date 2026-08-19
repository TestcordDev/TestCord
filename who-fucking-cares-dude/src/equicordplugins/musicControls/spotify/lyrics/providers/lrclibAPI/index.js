/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Provider } from "@equicordplugins/musicControls/spotify/lyrics/providers/types";
const baseUrlLrclib = "https://lrclib.net/api/get";
function lyricTimeToSeconds(time) {
    const [minutes, seconds] = time.slice(1, -1).split(":").map(Number);
    return minutes * 60 + seconds;
}
export async function getLyricsLrclib(track) {
    const info = {
        track_name: track.name,
        artist_name: track.artists[0].name,
        album_name: track.album.name,
        duration: String(track.duration / 1000)
    };
    const params = new URLSearchParams(info);
    const url = `${baseUrlLrclib}?${params.toString()}`;
    const response = await fetch(url, {
        headers: {
            "User-Agent": "SpotifyLyrics for Equicord (https://github.com/Masterjoona/vc-spotifylyrics)"
        }
    });
    if (!response.ok)
        return null;
    const data = await response.json();
    if (!data.syncedLyrics)
        return null;
    const lyrics = data.syncedLyrics;
    const lines = lyrics.split("\n").filter(line => line.trim() !== "");
    return {
        useLyric: Provider.Lrclib,
        lyricsVersions: {
            LRCLIB: lines.map(line => {
                const [lrcTime, text] = line.split("]");
                const trimmedText = text.trim();
                return {
                    time: lyricTimeToSeconds(lrcTime),
                    text: (trimmedText === "" || trimmedText === "♪") ? null : trimmedText
                };
            })
        }
    };
}
