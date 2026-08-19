/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Card } from "@components/Card";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";
const SOCKET_ID = "LastFMRichPresence";
const LASTFM_API = "https://ws.audioscrobbler.com/2.0";
const logger = new Logger("LastFMRichPresence");
let updateInterval;
let abortController;
let active = false;
let generation = 0;
let updateInFlight = false;
let lastTrackKey = "";
let trackStart = 0;
const settings = definePluginSettings({
    apiKey: {
        description: "Your Last.fm API key. Get one free at last.fm/api/account/create.",
        type: 0 /* OptionType.STRING */,
        default: "",
    },
    username: {
        description: "Your Last.fm username.",
        type: 0 /* OptionType.STRING */,
        default: "",
    },
    discordAppId: {
        description: "Discord Application ID for rich presence. Create one at discord.com/developers.",
        type: 0 /* OptionType.STRING */,
        default: "",
    },
    showTrackLink: {
        description: "Show a button linking to the track on Last.fm.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    useListeningStatus: {
        description: 'Show activity as "Listening to Last.fm" instead of "Playing".',
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    refreshInterval: {
        description: "How often to refresh now-playing status (seconds).",
        type: 5 /* OptionType.SLIDER */,
        markers: [10, 15, 20, 30, 60],
        default: 15,
        stickToMarkers: true,
    },
});
function setActivity(activity) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: SOCKET_ID });
}
async function getAsset(appId, key) {
    return (await ApplicationAssetUtils.fetchAssetIds(appId, [key]))[0];
}
async function fetchNowPlaying(signal) {
    const { apiKey, username } = settings.store;
    if (!apiKey || !username)
        return null;
    try {
        const res = await fetch(`${LASTFM_API}/?method=user.getRecentTracks` +
            `&user=${encodeURIComponent(username)}` +
            `&api_key=${encodeURIComponent(apiKey)}` +
            "&format=json&limit=1", { signal });
        if (!res.ok)
            return null;
        const data = await res.json();
        if (data.error) {
            logger.warn("Last.fm API error:", data.message);
            return null;
        }
        const track = data?.recenttracks?.track?.[0];
        if (!track || track["@attr"]?.nowplaying !== "true")
            return null;
        return track;
    }
    catch (e) {
        if (signal?.aborted)
            return null;
        logger.error("Failed to fetch Last.fm now playing:", e);
        return null;
    }
}
async function updatePresence(updateGeneration = generation) {
    if (!active || updateGeneration !== generation || updateInFlight)
        return;
    updateInFlight = true;
    const controller = new AbortController();
    abortController = controller;
    try {
        const track = await fetchNowPlaying(controller.signal);
        if (!active || updateGeneration !== generation)
            return;
        if (!track) {
            if (lastTrackKey !== "") {
                lastTrackKey = "";
                trackStart = 0;
                setActivity(null);
            }
            return;
        }
        const appId = settings.store.discordAppId;
        if (!appId)
            return;
        const trackKey = `${track.artist["#text"]}::${track.name}`;
        if (trackKey !== lastTrackKey) {
            lastTrackKey = trackKey;
            trackStart = Math.floor(Date.now() / 1000);
        }
        const artworkUrl = track.image?.find(img => img.size === "large")?.["#text"] ?? "";
        const largeImage = artworkUrl
            ? await getAsset(appId, artworkUrl)
            : await getAsset(appId, "lastfm");
        const smallImage = await getAsset(appId, "lastfm");
        if (!active || updateGeneration !== generation)
            return;
        const buttons = [];
        if (settings.store.showTrackLink)
            buttons.push({ label: "Listen on Last.fm", url: track.url });
        const activity = {
            application_id: appId,
            name: "Last.fm",
            details: track.name,
            state: track.artist["#text"],
            timestamps: { start: trackStart },
            assets: {
                large_image: largeImage,
                large_text: track.album?.["#text"] || track.name,
                small_image: smallImage,
                small_text: "Last.fm",
            },
            buttons: buttons.length ? buttons.map(b => b.label) : undefined,
            metadata: buttons.length ? { button_urls: buttons.map(b => b.url) } : undefined,
            type: settings.store.useListeningStatus ? 2 /* ActivityType.LISTENING */ : 0 /* ActivityType.PLAYING */,
            flags: 1 /* ActivityFlags.INSTANCE */,
        };
        setActivity(activity);
    }
    finally {
        if (abortController === controller)
            abortController = undefined;
        if (updateGeneration === generation)
            updateInFlight = false;
    }
}
export default definePlugin({
    name: "LastFMRichPresence",
    description: "Show your currently scrobbling Last.fm track as Discord rich presence.",
    tags: ["Activity", "Media"],
    authors: [{ name: "Sharp", id: 0n }],
    settings,
    settingsAboutComponent() {
        return (<Card>
                <Paragraph>
                    <strong>1. API Key:</strong> Go to last.fm/api/account/create, fill in any app name,
                    and copy the API Key.
                </Paragraph>
                <Paragraph className={Margins.top8}>
                    <strong>2. Discord App ID:</strong> Create an app at discord.com/developers/applications.
                    Under Rich Presence → Art Assets, upload a Last.fm logo and name it <code>lastfm</code>.
                    Paste the Application ID above.
                </Paragraph>
            </Card>);
    },
    start() {
        active = true;
        generation++;
        updateInFlight = false;
        updatePresence(generation);
        updateInterval = setInterval(() => updatePresence(generation), (settings.store.refreshInterval ?? 15) * 1000);
    },
    stop() {
        active = false;
        generation++;
        abortController?.abort();
        abortController = undefined;
        clearInterval(updateInterval);
        updateInterval = undefined;
        lastTrackKey = "";
        trackStart = 0;
        setActivity(null);
    },
});
