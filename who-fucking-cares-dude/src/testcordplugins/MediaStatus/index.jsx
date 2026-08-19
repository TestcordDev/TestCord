/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { Link } from "@components/Link";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ApplicationAssetUtils, FluxDispatcher, Forms } from "@webpack/common";
const DISCORD_APP_ID = "1333493119525720082";
const logger = new Logger("MediaStatus");
const PresenceStore = findByPropsLazy("getLocalPresence");
var MediaType;
(function (MediaType) {
    MediaType["MOVIE"] = "Movie";
    MediaType["EPISODE"] = "Episode";
    MediaType["AUDIO"] = "Audio";
    MediaType["VIDEO"] = "Video";
    MediaType["PHOTO"] = "Photo";
    MediaType["UNKNOWN"] = "Unknown";
})(MediaType || (MediaType = {}));
var ServiceType;
(function (ServiceType) {
    ServiceType["JELLYFIN"] = "jellyfin";
    ServiceType["PLEX"] = "plex";
})(ServiceType || (ServiceType = {}));
var DisplayFormat;
(function (DisplayFormat) {
    DisplayFormat["NATURAL"] = "natural";
    DisplayFormat["SHORT"] = "short";
    DisplayFormat["MINIMAL"] = "minimal";
})(DisplayFormat || (DisplayFormat = {}));
const settings = definePluginSettings({
    serverType: {
        type: 4 /* OptionType.SELECT */,
        description: "What media server are you using?",
        options: [
            { label: "Jellyfin", value: ServiceType.JELLYFIN, default: true },
            { label: "Plex", value: ServiceType.PLEX }
        ]
    },
    serverUrl: {
        type: 0 /* OptionType.STRING */,
        description: "Your server's URL (include http:// or https://)",
        placeholder: "https://your-server.com"
    },
    apiKey: {
        type: 0 /* OptionType.STRING */,
        description: "Your server's API key (Jellyfin) or token (Plex)",
        placeholder: "Enter your API key or token"
    },
    episodeFormat: {
        type: 4 /* OptionType.SELECT */,
        description: "How should episodes be displayed?",
        options: [
            { label: "Season 1 Episode 2", value: DisplayFormat.NATURAL, default: true },
            { label: "S01E02", value: DisplayFormat.SHORT },
            { label: "1x02", value: DisplayFormat.MINIMAL }
        ]
    },
    preferSeriesName: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show series name instead of episode title in status title",
        default: false
    },
    showTimestamps: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show elapsed/remaining time",
        default: true
    },
    serverName: {
        type: 0 /* OptionType.STRING */,
        description: "Custom server name (leave empty to use default)",
        placeholder: "My Media Server"
    },
    updateInterval: {
        type: 5 /* OptionType.SLIDER */,
        description: "How often to update the presence (in seconds)",
        default: 10,
        markers: [5, 10, 15, 30, 60],
        stickToMarkers: true
    },
    hideWhenPaused: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Hide presence when media is paused",
        default: true
    },
    hideWhenOtherActivity: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Hide when you have another activity (like playing a game)",
        default: false
    }
});
async function fetchJellyfinData(signal) {
    if (!settings.store.serverUrl || !settings.store.apiKey)
        return null;
    try {
        const response = await fetch(`${settings.store.serverUrl}/Sessions`, {
            headers: { "X-Emby-Token": settings.store.apiKey },
            signal
        });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const sessions = await response.json();
        const playingSession = sessions.find(s => s.NowPlayingItem);
        if (!playingSession)
            return null;
        const item = playingSession.NowPlayingItem;
        const playState = playingSession.PlayState;
        const toMs = (ticks) => Math.floor(ticks / 10000);
        const getMediaType = (type) => {
            switch (type.toLowerCase()) {
                case "movie": return MediaType.MOVIE;
                case "episode": return MediaType.EPISODE;
                case "audio": return MediaType.AUDIO;
                case "video": return MediaType.VIDEO;
                case "photo": return MediaType.PHOTO;
                default: return MediaType.UNKNOWN;
            }
        };
        const baseData = {
            title: item.Name,
            type: getMediaType(item.Type),
            progress: item.RunTimeTicks ? Math.round((playState.PositionTicks / item.RunTimeTicks) * 100) : undefined,
            isPaused: playState.IsPaused,
            imageUrl: item.ImageTags?.Primary ?
                `${settings.store.serverUrl}/Items/${item.Id}/Images/Primary?api_key=${settings.store.apiKey}` :
                undefined,
            duration: item.RunTimeTicks ? toMs(item.RunTimeTicks) : undefined,
            position: playState.PositionTicks ? toMs(playState.PositionTicks) : undefined,
            year: item.ProductionYear
        };
        switch (baseData.type) {
            case MediaType.EPISODE:
                return {
                    ...baseData,
                    series: item.SeriesName,
                    season: item.ParentIndexNumber,
                    episode: item.IndexNumber
                };
            case MediaType.AUDIO:
                return {
                    ...baseData,
                    artist: item.Artists?.[0],
                    albumArtist: item.AlbumArtist,
                    albumTitle: item.Album
                };
            default:
                return baseData;
        }
    }
    catch (e) {
        if (signal?.aborted)
            return null;
        logger.error("Failed to fetch Jellyfin data:", e);
        return null;
    }
}
async function fetchPlexData(signal) {
    if (!settings.store.serverUrl || !settings.store.apiKey)
        return null;
    try {
        const response = await fetch(`${settings.store.serverUrl}/status/sessions`, {
            headers: {
                "X-Plex-Token": settings.store.apiKey,
                "Accept": "application/json"
            },
            signal
        });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const session = data.MediaContainer.Metadata?.[0];
        if (!session)
            return null;
        const getMediaType = (type) => {
            switch (type.toLowerCase()) {
                case "movie": return MediaType.MOVIE;
                case "episode": return MediaType.EPISODE;
                case "track": return MediaType.AUDIO;
                case "photo": return MediaType.PHOTO;
                case "clip": return MediaType.VIDEO;
                default: return MediaType.UNKNOWN;
            }
        };
        const baseData = {
            title: session.title,
            type: getMediaType(session.type),
            progress: session.duration ? Math.round((session.viewOffset / session.duration) * 100) : undefined,
            isPaused: session.Player.state !== "playing",
            imageUrl: session.thumb ?
                `${settings.store.serverUrl}${session.thumb}?X-Plex-Token=${settings.store.apiKey}` :
                undefined,
            duration: session.duration,
            position: session.viewOffset,
            year: session.year,
            studio: session.studio
        };
        switch (baseData.type) {
            case MediaType.EPISODE:
                return {
                    ...baseData,
                    series: session.grandparentTitle,
                    season: session.parentIndex,
                    episode: session.index
                };
            case MediaType.AUDIO:
                return {
                    ...baseData,
                    artist: session.originalTitle || session.grandparentTitle,
                    albumArtist: session.grandparentTitle,
                    albumTitle: session.parentTitle
                };
            case MediaType.PHOTO:
                return {
                    ...baseData,
                    photographer: session.originalTitle || undefined
                };
            default:
                return baseData;
        }
    }
    catch (e) {
        if (signal?.aborted)
            return null;
        logger.error("Failed to fetch Plex data:", e);
        return null;
    }
}
async function getApplicationAsset(key) {
    return (await ApplicationAssetUtils.fetchAssetIds(DISCORD_APP_ID, [key]))[0];
}
function formatEpisodeNumber(season, episode) {
    if (!season || !episode)
        return "";
    const pad = (n) => n.toString().padStart(2, "0");
    switch (settings.store.episodeFormat) {
        case DisplayFormat.SHORT:
            return `S${pad(season)}E${pad(episode)}`;
        case DisplayFormat.MINIMAL:
            return `${season}x${pad(episode)}`;
        default:
            return `Season ${season} Episode ${episode}`;
    }
}
function getServerName() {
    if (settings.store.serverName)
        return settings.store.serverName;
    return settings.store.serverType === ServiceType.JELLYFIN ? "Jellyfin" : "Plex";
}
export default definePlugin({
    name: "MediaStatus",
    description: "Show your Jellyfin/Plex media activity as Discord Rich Presence",
    tags: ["Activity", "Media"],
    authors: [TestcordDevs.x2b, TestcordDevs.nnenaza],
    dependencies: ["UserSettingsAPI"],
    settings,
    interval: undefined,
    abortController: undefined,
    running: false,
    generation: 0,
    updateInFlight: false,
    settingsAboutComponent: () => (<>
            <Forms.FormTitle tag="h3">Setup Instructions</Forms.FormTitle>
            <Forms.FormText>
                For detailed setup instructions including how to find your server URL and API keys/tokens, visit the <Link href="https://github.com/redbaron2k7/MediaStatus">Documentatiom</Link>
            </Forms.FormText>

            <hr className="margin-top-8"/>

            <Forms.FormText>
                Having issues? Check the common problems section in the documentation or open an issue on GitHub.
            </Forms.FormText>
        </>),
    async start() {
        this.running = true;
        this.generation++;
        this.updateInFlight = false;
        this.updatePresence();
        this.interval = setInterval(() => this.updatePresence(), settings.store.updateInterval * 1000);
    },
    stop() {
        this.running = false;
        this.generation++;
        this.abortController?.abort();
        this.abortController = undefined;
        clearInterval(this.interval);
        this.interval = undefined;
        this.clearPresence();
    },
    clearPresence() {
        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            activity: null,
            socketId: "MediaStatus"
        });
    },
    async updatePresence() {
        if (!this.running || this.updateInFlight)
            return;
        this.updateInFlight = true;
        const { generation } = this;
        const abortController = new AbortController();
        this.abortController = abortController;
        try {
            const mediaData = await (settings.store.serverType === ServiceType.JELLYFIN ?
                fetchJellyfinData(abortController.signal) :
                fetchPlexData(abortController.signal));
            if (!this.running || generation !== this.generation)
                return;
            if (!mediaData || (mediaData.isPaused && settings.store.hideWhenPaused)) {
                this.clearPresence();
                return;
            }
            if (settings.store.hideWhenOtherActivity) {
                const activities = PresenceStore.getActivities();
                if (activities.some(a => a.application_id !== DISCORD_APP_ID)) {
                    this.clearPresence();
                    return;
                }
            }
            const getDetails = () => {
                switch (mediaData.type) {
                    case MediaType.EPISODE:
                        return `${mediaData.series} - ${formatEpisodeNumber(mediaData.season, mediaData.episode)}`;
                    case MediaType.AUDIO:
                        return `${mediaData.artist}${mediaData.albumTitle ? ` - ${mediaData.albumTitle}` : ""}`;
                    case MediaType.MOVIE:
                        return mediaData.title + (mediaData.year ? ` (${mediaData.year})` : "");
                    case MediaType.PHOTO:
                        return `Viewing ${mediaData.photographer ? `${mediaData.photographer}'s ` : ""}photo`;
                    default:
                        return mediaData.title;
                }
            };
            const getState = () => {
                const parts = [];
                if (mediaData.type === MediaType.EPISODE) {
                    parts.unshift(mediaData.title);
                }
                if (mediaData.type === MediaType.AUDIO && mediaData.albumTitle) {
                    parts.unshift(`from ${mediaData.albumTitle}`);
                }
                return parts.join(" • ") || "Watching";
            };
            const timestamps = settings.store.showTimestamps && mediaData.duration ? {
                start: Date.now() - (mediaData.position || 0),
                end: Date.now() + (mediaData.duration - (mediaData.position || 0))
            } : undefined;
            const assets = mediaData.imageUrl ? {
                large_image: await getApplicationAsset(mediaData.imageUrl),
                large_text: mediaData.title,
                small_image: await getApplicationAsset(`${settings.store.serverUrl}/web/favicon.png`),
                small_text: getServerName()
            } : undefined;
            if (!this.running || generation !== this.generation)
                return;
            const activityType = mediaData.type === MediaType.AUDIO ? 2 : 3;
            const activity = {
                application_id: DISCORD_APP_ID,
                name: mediaData.type === MediaType.EPISODE && settings.store.preferSeriesName ?
                    (mediaData.series || mediaData.title) :
                    mediaData.title,
                details: getDetails(),
                state: getState(),
                assets,
                timestamps,
                type: activityType,
                flags: 1 << 0
            };
            FluxDispatcher.dispatch({
                type: "LOCAL_ACTIVITY_UPDATE",
                activity,
                socketId: "MediaStatus"
            });
        }
        catch (err) {
            if (abortController.signal.aborted)
                return;
            logger.error("Failed to update presence:", err);
            this.clearPresence();
        }
        finally {
            if (this.abortController === abortController)
                this.abortController = undefined;
            if (generation === this.generation)
                this.updateInFlight = false;
        }
    }
});
