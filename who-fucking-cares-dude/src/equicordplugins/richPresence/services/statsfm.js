/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";
import { settings } from "../settings";
const APPLICATION_ID = "1325126169179197500";
const PLACEHOLDER_ID = "2a96cbd8b46e442fc41c2b86b821562f";
const SOCKET_ID = "RichPresence_SFM";
const logger = new Logger("RichPresence:StatsFm");
const PresenceStore = findByPropsLazy("getLocalPresence");
let updateInterval;
async function getAsset(key) {
    return (await ApplicationAssetUtils.fetchAssetIds(APPLICATION_ID, [key]))[0];
}
function setActivity(activity) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: SOCKET_ID });
}
async function fetchTrackData() {
    if (!settings.store.sfm_username)
        return null;
    try {
        const res = await fetch(`https://api.stats.fm/api/v1/users/${settings.store.sfm_username}/streams/current`);
        if (!res.ok)
            throw `${res.status} ${res.statusText}`;
        const json = await res.json();
        if (!json.item) {
            logger.error("Error from Stats.fm API", json);
            return null;
        }
        const trackData = json.item.track;
        if (!trackData)
            return null;
        return {
            name: trackData.name || "Unknown",
            albums: trackData.albums.map(a => a.name).join(", ") || "Unknown",
            artists: trackData.artists[0]?.name ?? "Unknown",
            url: `https://stats.fm/track/${trackData.id}`,
            imageUrl: trackData.albums[0]?.image,
        };
    }
    catch (e) {
        logger.error("Failed to query Stats.fm API", e);
        return null;
    }
}
function getLargeImage(track) {
    if (!settings.store.sfm_alwaysHideArt && track.imageUrl && !track.imageUrl.includes(PLACEHOLDER_ID))
        return track.imageUrl;
    if (settings.store.sfm_missingArt === "placeholder")
        return "placeholder";
}
async function getActivity() {
    if (settings.store.sfm_hideWithExternalRPC) {
        if (PresenceStore.getActivities().some(a => a.application_id !== APPLICATION_ID))
            return null;
    }
    if (settings.store.sfm_hideWithSpotify) {
        if (PresenceStore.getActivities().some(a => a.type === 2 /* ActivityType.LISTENING */ && a.application_id !== APPLICATION_ID))
            return null;
    }
    const trackData = await fetchTrackData();
    if (!trackData)
        return null;
    const largeImage = getLargeImage(trackData);
    const assets = largeImage
        ? {
            large_image: await getAsset(largeImage),
            large_text: trackData.albums || undefined,
            ...(settings.store.sfm_showLogo && {
                small_image: await getAsset("statsfm-large"),
                small_text: "Stats.fm",
            }),
        } : {
        large_image: await getAsset("statsfm-large"),
        large_text: trackData.albums || undefined,
    };
    const buttons = [];
    if (settings.store.sfm_shareUsername)
        buttons.push({ label: "Stats.fm Profile", url: `https://stats.fm/${settings.store.sfm_username}` });
    if (settings.store.sfm_shareSong)
        buttons.push({ label: "View Song", url: trackData.url });
    const statusName = (() => {
        switch (settings.store.sfm_nameFormat) {
            case "artist-first" /* NameFormat.ArtistFirst */: return trackData.artists + " - " + trackData.name;
            case "song-first" /* NameFormat.SongFirst */: return trackData.name + " - " + trackData.artists;
            case "artist" /* NameFormat.ArtistOnly */: return trackData.artists;
            case "song" /* NameFormat.SongOnly */: return trackData.name;
            case "album" /* NameFormat.AlbumName */: return trackData.albums || settings.store.sfm_statusName;
            default: return settings.store.sfm_statusName;
        }
    })();
    return {
        application_id: APPLICATION_ID,
        name: statusName,
        details: trackData.name,
        state: trackData.artists,
        assets,
        buttons: buttons.length ? buttons.map(v => v.label) : undefined,
        metadata: buttons.length ? { button_urls: buttons.map(v => v.url) } : undefined,
        type: settings.store.sfm_useListeningStatus ? 2 /* ActivityType.LISTENING */ : 0 /* ActivityType.PLAYING */,
        flags: 1 /* ActivityFlags.INSTANCE */,
    };
}
async function updatePresence() {
    try {
        setActivity(await getActivity());
    }
    catch (e) {
        logger.error("Failed to update presence", e);
        setActivity(null);
    }
}
export function start() {
    updatePresence();
    updateInterval = setInterval(updatePresence, 16000);
}
export function stop() {
    clearInterval(updateInterval);
    updateInterval = undefined;
    setActivity(null);
}
