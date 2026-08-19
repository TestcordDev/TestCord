/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Sofia Lima
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { definePluginSettings, migratePluginSetting, migratePluginSettings } from "@api/Settings";
import { LinkButton } from "@components/Button";
import { Card } from "@components/Card";
import { Heading } from "@components/Heading";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ApplicationAssetUtils, AuthenticationStore, FluxDispatcher, PresenceStore } from "@webpack/common";
import { LastFMScrobbler } from "./lastfm";
import { invalidateListenBrainzCache, ListenBrainzScrobbler } from "./listenbrainz";
const DISCORD_APP_ID = "1108588077900898414";
const LASTFM_PLACEHOLDER_IMAGE_HASH = "2a96cbd8b46e442fc41c2b86b821562f";
async function getApplicationAsset(key) {
    return (await ApplicationAssetUtils.fetchAssetIds(DISCORD_APP_ID, [key]))[0];
}
function setActivity(activity) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity,
        socketId: "LastFM",
    });
}
export const settings = definePluginSettings({
    scrobblerBackend: {
        description: "The scrobbler backend to use.",
        type: 4 /* OptionType.SELECT */,
        options: [
            {
                "label": "Last.FM",
                "value": "lastfm",
                "default": true
            },
            {
                "label": "ListenBrainz",
                "value": "listenbrainz"
            },
            {
                "label": "ListenBrainz Compatible (self-hosted)",
                "value": "listenbrainz-compatible"
            }
        ]
    },
    instanceBaseURL: {
        description: "The base url of your ListenBrainz instance.",
        type: 0 /* OptionType.STRING */,
        placeholder: "https://example.org",
        onChange: invalidateListenBrainzCache
    },
    instanceAPIBaseUrl: {
        description: "The base url of your ListenBrainz API.",
        type: 0 /* OptionType.STRING */,
        placeholder: "https://api.example.org",
        onChange: invalidateListenBrainzCache
    },
    apiKey: {
        displayName: "API Key",
        description: "Last.fm API key. Not required but highly recommended to avoid rate limiting with our shared key",
        type: 0 /* OptionType.STRING */,
    },
    username: {
        description: "Username",
        type: 0 /* OptionType.STRING */,
    },
    shareUsername: {
        description: "Show link to scrobbler profile",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
    },
    clickableLinks: {
        description: "Make track, artist and album names clickable links",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    hideWithSpotify: {
        description: "Hide presence if Spotify is running",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    hideWithActivity: {
        description: "Hide presence if you have any other presence",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
    },
    statusName: {
        description: "Custom status text. You can use the following variables: {artist} | {album} | {title}",
        type: 0 /* OptionType.STRING */,
        default: "some music",
    },
    statusDisplayType: {
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
        ]
    },
    nameFormat: {
        description: "Show name of song and artist in status name",
        type: 4 /* OptionType.SELECT */,
        options: [
            {
                label: "Use custom status name",
                value: "status-name" /* NameFormat.StatusName */,
                default: true
            },
            {
                label: "Use music service name (falls back to custom status text)",
                value: "service-name" /* NameFormat.ServiceName */
            },
            {
                label: "Use format 'artist - song'",
                value: "artist-first" /* NameFormat.ArtistFirst */
            },
            {
                label: "Use format 'song - artist'",
                value: "song-first" /* NameFormat.SongFirst */
            },
            {
                label: "Use artist name only",
                value: "artist" /* NameFormat.ArtistOnly */
            },
            {
                label: "Use song name only",
                value: "song" /* NameFormat.SongOnly */
            },
            {
                label: "Use album name (falls back to custom status text if song has no album)",
                value: "album" /* NameFormat.AlbumName */
            }
        ],
    },
    useListeningStatus: {
        description: 'Show "Listening to" status instead of "Playing"',
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
    },
    missingArt: {
        description: "When album or album art is missing",
        type: 4 /* OptionType.SELECT */,
        options: [
            {
                label: "Use large scrobbler logo",
                value: "logo",
                default: true
            },
            {
                label: "Use generic placeholder",
                value: "placeholder"
            }
        ],
    },
    showLogo: {
        displayName: "Show Scrobbler Logo",
        description: "Show the scrobbler service logo by the album cover",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    },
    showAlbumCover: {
        description: "Show album cover. Disabling this will display a placeholder. Useful if your music has inappropriate art",
        type: 3 /* OptionType.BOOLEAN */,
        default: true,
    }
}, {
    apiKey: { hidden() { return this.store.scrobblerBackend !== "lastfm"; } },
    instanceBaseURL: { hidden() { return this.store.scrobblerBackend !== "listenbrainz-compatible"; } },
    instanceAPIBaseUrl: { hidden() { return this.store.scrobblerBackend !== "listenbrainz-compatible"; } },
});
migratePluginSettings("MusicRichPresence", "LastFMRichPresence");
migratePluginSetting("MusicRichPresence", "showLastFmLogo", "showLogo");
export default definePlugin({
    name: "MusicRichPresence",
    description: "Rich Presence for Last.FM/Listenbrainz",
    tags: ["Activity", "Media"],
    searchTerms: ["lastfm", "LastFMRichPresence"],
    authors: [Devs.Rini, Devs.Ven, Devs.angelcube, Devs.RuiNtD, Devs.blahajZip, Devs.archeruwu],
    settings,
    settingsAboutComponent() {
        if (settings.store.scrobblerBackend !== "lastfm")
            return null;
        return (<Card>
                <Heading tag="h2">Last.FM</Heading>
                <Heading tag="h5">How to create an API key</Heading>
                <Paragraph>Set <strong>Application name</strong> and <strong>Application description</strong> to anything and leave the rest blank.</Paragraph>
                <LinkButton size="small" href="https://www.last.fm/api/account/create" className={Margins.top8}>Create API Key</LinkButton>
            </Card>);
    },
    start() {
        this.updatePresence();
        this.updateInterval = setInterval(() => { this.updatePresence(); }, 16000);
    },
    stop() {
        clearInterval(this.updateInterval);
    },
    async updatePresence() {
        const { username, scrobblerBackend, instanceAPIBaseUrl, instanceBaseURL } = settings.store;
        if (!username)
            return;
        if (scrobblerBackend === "listenbrainz-compatible" && (!instanceAPIBaseUrl || !instanceBaseURL))
            return;
        setActivity(await this.getActivity());
    },
    getLargeImage(track) {
        if (settings.store.showAlbumCover && track.imageURL && !track.imageURL.includes(LASTFM_PLACEHOLDER_IMAGE_HASH))
            return track.imageURL;
        if (settings.store.missingArt === "placeholder")
            return "placeholder";
    },
    async getActivity() {
        if (settings.store.hideWithActivity) {
            if (PresenceStore.getActivities(AuthenticationStore.getId()).some(a => a.application_id !== DISCORD_APP_ID && a.type !== 4 /* ActivityType.CUSTOM_STATUS */)) {
                return null;
            }
        }
        if (settings.store.hideWithSpotify) {
            if (PresenceStore.getActivities(AuthenticationStore.getId()).some(a => a.type === 2 /* ActivityType.LISTENING */ && a.application_id !== DISCORD_APP_ID)) {
                // there is already music status because of Spotify or richerCider (probably more)
                return null;
            }
        }
        const scrobbler = settings.store.scrobblerBackend === "lastfm" ? LastFMScrobbler : ListenBrainzScrobbler;
        const trackData = await scrobbler.fetchTrackData();
        if (!trackData)
            return null;
        const largeImage = this.getLargeImage(trackData);
        const assets = largeImage ?
            {
                large_image: await getApplicationAsset(largeImage),
                large_text: trackData.album || undefined,
                ...(settings.store.showLogo && {
                    small_image: await getApplicationAsset(`${scrobbler.id}-small`),
                    small_text: scrobbler.id
                }),
            } : {
            large_image: await getApplicationAsset(`${scrobbler.id}-large`),
            large_text: trackData.album || undefined,
        };
        const buttons = [];
        if (settings.store.shareUsername) {
            buttons.push({
                label: `${scrobbler.name} Profile`,
                url: scrobbler.getUserURL(settings.store.username)
            });
        }
        const statusName = (() => {
            switch (settings.store.nameFormat) {
                case "artist-first" /* NameFormat.ArtistFirst */:
                    return trackData.artist + " - " + trackData.name;
                case "song-first" /* NameFormat.SongFirst */:
                    return trackData.name + " - " + trackData.artist;
                case "artist" /* NameFormat.ArtistOnly */:
                    return trackData.artist;
                case "song" /* NameFormat.SongOnly */:
                    return trackData.name;
                case "album" /* NameFormat.AlbumName */:
                    return trackData.album || settings.store.statusName
                        .replaceAll("{artist}", trackData.artist || "")
                        .replaceAll("{album}", trackData.album || "")
                        .replaceAll("{title}", trackData.name || "");
                case "service-name" /* NameFormat.ServiceName */:
                    return trackData.serviceName || settings.store.statusName
                        .replaceAll("{artist}", trackData.artist || "")
                        .replaceAll("{album}", trackData.album || "")
                        .replaceAll("{title}", trackData.name || "");
                default:
                    return settings.store.statusName
                        .replaceAll("{artist}", trackData.artist || "")
                        .replaceAll("{album}", trackData.album || "")
                        .replaceAll("{title}", trackData.name || "");
            }
        })();
        const activity = {
            application_id: DISCORD_APP_ID,
            name: statusName,
            details: trackData.name,
            state: trackData.artist,
            status_display_type: {
                "off": 0 /* ActivityStatusDisplayType.NAME */,
                "artist": 1 /* ActivityStatusDisplayType.STATE */,
                "track": 2 /* ActivityStatusDisplayType.DETAILS */
            }[settings.store.statusDisplayType],
            assets,
            buttons: buttons.length ? buttons.map(v => v.label) : undefined,
            metadata: {
                button_urls: buttons.map(v => v.url),
            },
            type: settings.store.useListeningStatus ? 2 /* ActivityType.LISTENING */ : 0 /* ActivityType.PLAYING */,
            flags: 1 /* ActivityFlags.INSTANCE */,
        };
        if (settings.store.clickableLinks) {
            activity.details_url = trackData.trackURL;
            activity.state_url = trackData.artistURL;
            if (trackData.album) {
                activity.assets.large_url = trackData.albumURL;
            }
        }
        return activity;
    }
});
