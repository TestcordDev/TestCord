/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { RendererSettings } from "@main/settings";
export async function getTrackData(_, trackURL) {
    const url = new URL("https://api.song.link/v1-alpha.1/links");
    url.searchParams.set("url", trackURL);
    url.searchParams.set("userCountry", RendererSettings.store.plugins?.SongLink.userCountry || "US");
    const raw = await fetch(url.toString()).then(u => u.json());
    const [, entry] = Object.entries(raw.entitiesByUniqueId)
        .find(([key]) => !key.includes("YOUTUBE")) || [];
    const possibleTrackInfo = entry
        ? { title: entry.title, artist: entry.artistName }
        : null;
    return {
        // @ts-ignore
        info: possibleTrackInfo,
        links: Object.fromEntries(Object.entries(raw.linksByPlatform).map(([name, data]) => [name, {
                url: data.url,
                nativeUri: data.nativeAppUriDesktop
            }]))
    };
}
