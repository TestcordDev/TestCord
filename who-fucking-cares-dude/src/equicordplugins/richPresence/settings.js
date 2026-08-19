/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { SettingsPanel } from "./SettingsPanel";
export let onServiceChange = null;
export function setOnServiceChange(fn) { onServiceChange = fn; }
export const settings = definePluginSettings({
    enabled: {
        description: "Enable rich presence services.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        restartNeeded: false,
        onChange: () => onServiceChange?.(),
    },
    serviceSettings: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Service configuration.",
        component: SettingsPanel,
    },
    // Per-service enable toggles
    abs_enabled: {
        description: "Enable AudioBookShelf presence.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    tosu_enabled: {
        description: "Enable osu! (tosu) presence.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    sfm_enabled: {
        description: "Enable stats.fm presence.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    jf_enabled: {
        description: "Enable Jellyfin presence.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    gr_enabled: {
        description: "Enable Gensokyo Radio presence.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    nd_enabled: {
        description: "Enable Navidrome presence.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
        onChange: () => onServiceChange?.(),
    },
    // AudioBookShelf
    abs_serverUrl: {
        description: "AudioBookShelf server URL.",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    abs_username: {
        description: "AudioBookShelf username.",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    abs_password: {
        description: "AudioBookShelf password.",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    // stats.fm
    sfm_username: {
        description: "Stats.fm username.",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    sfm_shareUsername: {
        description: "Show link to stats.fm profile.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
    },
    sfm_shareSong: {
        description: "Show link to song on stats.fm.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        hidden: true,
    },
    sfm_hideWithSpotify: {
        description: "Hide stats.fm presence if Spotify is running.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
    },
    sfm_hideWithExternalRPC: {
        description: "Hide stats.fm presence if an external RPC is running.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
    },
    sfm_statusName: {
        description: "Custom status text.",
        type: 0 /* OptionType.STRING */,
        default: "Stats.fm",
        hidden: true,
    },
    sfm_nameFormat: {
        description: "Name format.",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "Use custom status name", value: "status-name" /* NameFormat.StatusName */, default: true },
            { label: "Use format 'artist - song'", value: "artist-first" /* NameFormat.ArtistFirst */ },
            { label: "Use format 'song - artist'", value: "song-first" /* NameFormat.SongFirst */ },
            { label: "Use artist name only", value: "artist" /* NameFormat.ArtistOnly */ },
            { label: "Use song name only", value: "song" /* NameFormat.SongOnly */ },
            { label: "Use album name", value: "album" /* NameFormat.AlbumName */ },
        ],
        hidden: true,
    },
    sfm_useListeningStatus: {
        description: "Show listening status.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        hidden: true,
    },
    sfm_missingArt: {
        description: "Fallback when art is missing.",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "Use large Stats.fm logo", value: "StatsFmLogo", default: true },
            { label: "Use generic placeholder", value: "placeholder" },
        ],
        hidden: true,
    },
    sfm_showLogo: {
        description: "Show Stats.fm logo next to album art.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        hidden: true,
    },
    sfm_alwaysHideArt: {
        description: "Disable downloading album art.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
    },
    // Jellyfin
    jf_serverUrl: {
        description: "Jellyfin server URL.",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    jf_apiKey: {
        description: "Jellyfin API key.",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    jf_userId: {
        description: "Jellyfin user ID.",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    jf_nameDisplay: {
        description: "Name display format.",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "Series/Movie Name", value: "default", default: true },
            { label: "Series - Episode/Track/Movie Name", value: "full" },
            { label: "Custom", value: "custom" },
        ],
        hidden: true,
    },
    jf_customName: {
        description: "Custom name template.",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    jf_coverType: {
        description: "Cover type for TV shows.",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "Series Cover", value: "series", default: true },
            { label: "Episode Cover", value: "episode" },
        ],
        hidden: true,
    },
    jf_episodeFormat: {
        description: "Episode number format.",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "S01E01", value: "long", default: true },
            { label: "1x01", value: "short" },
            { label: "Season 1 Episode 1", value: "fulltext" },
        ],
        hidden: true,
    },
    jf_showEpisodeName: {
        description: "Show episode name after season/episode info.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
    },
    jf_overrideType: {
        description: "Override rich presence type.",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "Off", value: "off", default: true },
            { label: "Listening", value: "2" },
            { label: "Playing", value: "0" },
            { label: "Streaming", value: "1" },
            { label: "Watching", value: "3" },
        ],
        hidden: true,
    },
    jf_showPausedState: {
        description: "Show presence when media is paused.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        hidden: true,
    },
    jf_privacyMode: {
        description: "Hide media details.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
    },
    // Gensokyo Radio
    gr_refreshInterval: {
        description: "Refresh interval in seconds.",
        type: 5 /* OptionType.SLIDER */,
        markers: [1, 2, 2.5, 3, 5, 10, 15],
        default: 15,
        hidden: true,
    },
    // Navidrome
    nd_serverUrl: {
        description: "Navidrome Server URL (e.g. https://navidrome.example.com)",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    nd_username: {
        description: "Navidrome Username",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    nd_password: {
        description: "Navidrome Password",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    nd_clientId: {
        description: "Optional Discord Application Client ID",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    nd_showSmallImage: {
        description: "Show Navidrome logo in bottom right of album art.",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
        hidden: true,
    },
    nd_showAlbum: {
        description: "Show album name in presence.",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        hidden: true,
    },
    nd_albumArtMode: {
        description: "How to fetch album art.",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "None", value: "none", default: true },
            { label: "Navidrome Instance (Exposes Server URL to Discord, no auth sent)", value: "instance" },
            { label: "Last.fm API (Sends track metadata to Last.fm)", value: "lastfm" },
        ],
        hidden: true,
    },
    nd_lastfmApiKey: {
        description: "Optional Last.fm API Key",
        type: 0 /* OptionType.STRING */,
        default: "",
        hidden: true,
    },
    nd_refreshInterval: {
        description: "Refresh interval in seconds.",
        type: 5 /* OptionType.SLIDER */,
        markers: [1, 2, 5, 10, 15],
        default: 10,
        hidden: true,
    },
    nd_activityType: {
        type: 4 /* OptionType.SELECT */,
        description: "Which type of activity",
        options: [
            { label: "Listening", value: 2, default: true },
            { label: "Playing (Fixes hidden lines)", value: 0 },
            { label: "Watching", value: 3 }
        ],
        hidden: true,
    },
    nd_nameString: {
        type: 0 /* OptionType.STRING */,
        description: "Activity name format string",
        default: "Navidrome",
        hidden: true,
    },
    nd_detailsString: {
        type: 0 /* OptionType.STRING */,
        description: "Activity details format string",
        default: "{song}",
        hidden: true,
    },
    nd_stateString: {
        type: 0 /* OptionType.STRING */,
        description: "Activity state format string",
        default: "{artist}",
        hidden: true,
    },
    nd_largeTextString: {
        type: 0 /* OptionType.STRING */,
        description: "Activity large text format string",
        default: "{album}",
        hidden: true,
    },
    nd_statusDisplayType: {
        description: "Show the track / artist name in the member list",
        type: 4 /* OptionType.SELECT */,
        options: [
            {
                label: "Don't show (shows generic listening message)",
                value: "off"
            },
            {
                label: "Show artist name",
                value: "artist",
                default: true
            },
            {
                label: "Show track name",
                value: "track"
            }
        ],
        hidden: true,
    },
    nd_hideOnPause: {
        description: "Hide Rich Presence when music is paused",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
        hidden: true,
    }
});
