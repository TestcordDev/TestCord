/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import { settings, toggleBetterSpotifyControls, toggleHoverControls } from "./settings";
import { migrateOldLyrics } from "./spotify/lyrics/api";
import { SpotifyLyrics } from "./spotify/lyrics/components/lyrics";
import { SpotifyPlayer } from "./spotify/PlayerComponent";
import { TidalLyrics } from "./tidal/lyrics/components/lyrics";
import { stopTidalLrcStore } from "./tidal/lyrics/providers/store";
import { TidalPlayer } from "./tidal/TidalPlayer";
import { stopTidalStore } from "./tidal/TidalStore";

let isToggled = false;
let isCtrlHeld = false;
let lastCtrlPressTime = 0;
let holdTimeout: ReturnType<typeof setTimeout> | null = null;

export function resetCtrlState() {
    if (holdTimeout) {
        clearTimeout(holdTimeout);
        holdTimeout = null;
    }
    isToggled = false;
    isCtrlHeld = false;
    lastCtrlPressTime = 0;
    updatePlayerCtrlState();
}

function updatePlayerCtrlState() {
    const isCtrlActive = isToggled !== isCtrlHeld;
    const players = document.querySelectorAll("#vc-spotify-player, #eq-tdl-player");
    players.forEach(player => {
        if (isCtrlActive) {
            player.classList.add("vc-ctrl-active");
        } else {
            player.classList.remove("vc-ctrl-active");
        }
    });
}

function handleKeyDown(e: KeyboardEvent) {
    if (!settings.store.hoverControls) return;

    if (e.key === "Control") {
        if (e.repeat) return;
        const now = Date.now();

        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = null;
        }

        if (now - lastCtrlPressTime < 300) {
            isToggled = !isToggled;
            isCtrlHeld = false;
            lastCtrlPressTime = 0;
            updatePlayerCtrlState();
        } else {
            lastCtrlPressTime = now;
            holdTimeout = setTimeout(() => {
                isCtrlHeld = true;
                updatePlayerCtrlState();
                holdTimeout = null;
            }, 180);
        }
    } else {
        lastCtrlPressTime = 0;
        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = null;
        }
    }
}

function handleKeyUp(e: KeyboardEvent) {
    if (!settings.store.hoverControls) return;

    if (e.key === "Control") {
        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = null;
        }
        if (isCtrlHeld) {
            isCtrlHeld = false;
            updatePlayerCtrlState();
        }
    }
}

function handleWindowBlur() {
    if (holdTimeout) {
        clearTimeout(holdTimeout);
        holdTimeout = null;
    }
    if (isCtrlHeld) {
        isCtrlHeld = false;
        updatePlayerCtrlState();
    }
}

export default definePlugin({
    name: "MusicControls",
    description: "Music Controls and Lyrics for multiple services ",
    authors: [Devs.Ven, Devs.afn, Devs.KraXen72, Devs.Av32000, Devs.nin0dev, Devs.thororen, EquicordDevs.vmohammad, Devs.Joona],
    settings,
    tags: ["Media", "Activity"],
    searchTerms: [
        // Spotify
        "Spotify",
        "SpotifyControls",
        "SpotifyLyrics",
        // Tidal
        "Tidal",
        "TidalControls",
        "TidalLyrics",
    ],

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                // react.jsx)(AccountPanel, { ..., showTaglessAccountPanel: blah })
                match: /(?<=\i\.jsxs?\)\()(\i),{(?=[^}]*?userTag:\i,occluded:)/,
                // react.jsx(WrapperComponent, { VencordOriginal: AccountPanel, ...
                replace: "$self.PanelWrapper,{VencordOriginal:$1,"
            },
        },
        {
            find: ".PLAYER_DEVICES",
            replacement: [{
                // Adds POST and a Marker to the SpotifyAPI (so we can easily find it)
                match: /get:(\i)\.bind\(null,(\i\.\i)\.get\)/,
                replace: "post:$1.bind(null,$2.post),vcSpotifyMarker:1,$&"
            },
            {
                // Spotify Connect API returns status 202 instead of 204 when skipping tracks.
                // Discord rejects 202 which causes the request to send twice. This patch prevents this.
                match: /202===\i\.status/,
                replace: "false",
            }]
        },
        {
            find: 'repeat:"off"!==',
            replacement: [
                {
                    // Discord doesn't give you shuffle state and the repeat kind, only a boolean
                    match: /repeat:"off"!==(\i),/,
                    replace: "shuffle:arguments[2]?.shuffle_state??false,actual_repeat:$1,$&"
                },
                {
                    match: /(?<=artists.filter\(\i=>).{0,10}\i\.id\)&&/,
                    replace: ""
                }
            ]
        },
    ],

    PanelWrapper({ VencordOriginal, ...props }) {
        const { showTidalControls, showTidalLyrics, showSpotifyLyrics, showSpotifyControls, lyricsPosition } = settings.use([
            "showTidalControls",
            "showTidalLyrics",
            "showSpotifyLyrics",
            "showSpotifyControls",
            "lyricsPosition",
        ]);
        return (
            <>
                <ErrorBoundary
                    fallback={() => (
                        <div className="vc-tidal-fallback">
                            <p>Failed to render Modal :(</p>
                            <p>Check the console for errors</p>
                        </div>
                    )}
                >
                    {showTidalLyrics && lyricsPosition === "above" && <TidalLyrics />}
                    {showTidalControls && <TidalPlayer />}
                    {showTidalLyrics && lyricsPosition === "below" && <TidalLyrics />}
                    {showSpotifyLyrics && lyricsPosition === "above" && <SpotifyLyrics />}
                    {showSpotifyControls && <SpotifyPlayer />}
                    {showSpotifyLyrics && lyricsPosition === "below" && <SpotifyLyrics />}
                </ErrorBoundary>

                <VencordOriginal {...props} />
            </>
        );
    },

    async start() {
        await migrateOldLyrics();
        toggleHoverControls(settings.store.hoverControls);
        toggleBetterSpotifyControls(settings.store.betterSpotifyControls);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleWindowBlur);
    },

    stop() {
        toggleHoverControls(false);
        toggleBetterSpotifyControls(false);
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
        window.removeEventListener("blur", handleWindowBlur);
        resetCtrlState();
        stopTidalLrcStore();
        stopTidalStore();
    },
});
