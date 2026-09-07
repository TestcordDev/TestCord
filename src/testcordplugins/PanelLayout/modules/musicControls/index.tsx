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

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Devs, EquicordDevs } from "@utils/constants";
import { openModal, RenderModalProps } from "@utils/modal";
import { Modal, React, Select, showToast, Toasts, useState } from "@webpack/common";

import { isModuleEnabled } from "../state";
import type { UserAreaModule } from "../types";
import { settings, toggleBetterSpotifyControls, toggleHoverControls } from "./settings";
import { clearLyricsCache, migrateOldLyrics } from "./spotify/lyrics/api";
import { SpotifyLyrics } from "./spotify/lyrics/components/lyrics";
import { Provider } from "./spotify/lyrics/providers/types";
import { SpotifyPlayer } from "./spotify/PlayerComponent";
import { TidalLyrics } from "./tidal/lyrics/components/lyrics";
import { stopTidalLrcStore } from "./tidal/lyrics/providers/store";
import { TidalPlayer } from "./tidal/TidalPlayer";
import { stopTidalStore } from "./tidal/TidalStore";

let isToggled = false;
let isCtrlHeld = false;
let lastCtrlPressTime = 0;
let holdTimeout: ReturnType<typeof setTimeout> | null = null;
let isStarted = false;

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

export async function startMusicControls() {
    if (isStarted) return;
    isStarted = true;
    try {
        await migrateOldLyrics();
    } catch (e) {
        console.error("[MusicControls] Failed to migrate old lyrics:", e);
    }
    toggleHoverControls(settings.store.hoverControls);
    toggleBetterSpotifyControls(settings.store.betterSpotifyControls);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
}

export function stopMusicControls() {
    if (!isStarted) return;
    isStarted = false;
    toggleHoverControls(false);
    toggleBetterSpotifyControls(false);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleWindowBlur);
    resetCtrlState();
    stopTidalLrcStore();
    stopTidalStore();
}

export const musicControlsPatches = [
    {
        find: ".PLAYER_DEVICES",
        predicate: () => isModuleEnabled("music-controls"),
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
        predicate: () => isModuleEnabled("music-controls"),
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
];

export function MusicControlsComponent() {
    const { showTidalControls, showTidalLyrics, showSpotifyLyrics, showSpotifyControls, lyricsPosition } = settings.use([
        "showTidalControls",
        "showTidalLyrics",
        "showSpotifyLyrics",
        "showSpotifyControls",
        "lyricsPosition",
    ]);

    return (
        <div className="vc-panel-layout-music-controls">
            <ErrorBoundary
                fallback={() => (
                    <div style={{ padding: "8px", fontSize: "12px", color: "var(--text-danger)" }}>
                        Failed to render music player
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
        </div>
    );
}

export function MusicControlsSettingsModal({ modalProps, onClose }: { modalProps?: RenderModalProps; onClose?: () => void }) {
    const s = settings.use([
        "showSpotifyControls",
        "betterSpotifyControls",
        "showSpotifyLyrics",
        "useSpotifyUris",
        "previousButtonRestartsTrack",
        "showTidalControls",
        "showTidalLyrics",
        "hoverControls",
        "lyricsPosition",
        "lyricsProvider",
        "fallbackProvider",
        "showFailedToasts",
    ]);

    const [tab, setTab] = useState<"spotify" | "tidal" | "lyrics">("spotify");
    const handleClose = () => (modalProps?.onClose ?? onClose)?.();

    return (
        <Modal title="Music Controls Settings" {...modalProps!}>
            <div style={{ padding: "16px" }}>
                <Paragraph style={{ marginBottom: "16px", color: "var(--text-muted)", fontSize: "13px" }}>
                    Configure Spotify and Tidal player display, hover behavior, and synced lyrics.
                </Paragraph>

                <Flex gap={8} style={{ marginBottom: "16px" }}>
                    <Button
                        variant={tab === "spotify" ? "primary" : "secondary"}
                        size="small"
                        onClick={() => setTab("spotify")}
                    >
                        Spotify
                    </Button>
                    <Button
                        variant={tab === "tidal" ? "primary" : "secondary"}
                        size="small"
                        onClick={() => setTab("tidal")}
                    >
                        Tidal
                    </Button>
                    <Button
                        variant={tab === "lyrics" ? "primary" : "secondary"}
                        size="small"
                        onClick={() => setTab("lyrics")}
                    >
                        Lyrics & Hover
                    </Button>
                </Flex>

                {tab === "spotify" && (
                    <div style={{ display: "grid", gap: "10px" }}>
                        <Card variant="primary">
                            <FormSwitch
                                title="Show Spotify Controls"
                                description="Display Spotify player controls (play/pause, skip, progress bar) in the user panel."
                                value={s.showSpotifyControls}
                                onChange={v => { settings.store.showSpotifyControls = v; }}
                            />
                            <FormSwitch
                                title="Album Art Background"
                                description="Use the currently playing track's album art as the Spotify controls background."
                                value={s.betterSpotifyControls}
                                onChange={v => {
                                    settings.store.betterSpotifyControls = v;
                                    toggleBetterSpotifyControls(v);
                                }}
                            />
                            <FormSwitch
                                title="Show Spotify Synced Lyrics"
                                description="Display synchronized karaoke lyrics above or below the player."
                                value={s.showSpotifyLyrics}
                                onChange={v => { settings.store.showSpotifyLyrics = v; }}
                            />
                            <FormSwitch
                                title="Open Spotify Desktop URIs"
                                description="Open Spotify URIs (spotify:track:...) instead of web links."
                                value={s.useSpotifyUris}
                                onChange={v => { settings.store.useSpotifyUris = v; }}
                            />
                            <FormSwitch
                                title="Previous Restarts Track"
                                description="Restart playing track when pressing previous if playtime is over 3s."
                                value={s.previousButtonRestartsTrack}
                                onChange={v => { settings.store.previousButtonRestartsTrack = v; }}
                                hideBorder
                            />
                        </Card>
                    </div>
                )}

                {tab === "tidal" && (
                    <div style={{ display: "grid", gap: "10px" }}>
                        <Card variant="primary">
                            <FormSwitch
                                title="Show Tidal Controls"
                                description="Display Tidal player controls when connected to TidaLuna."
                                value={s.showTidalControls}
                                onChange={v => { settings.store.showTidalControls = v; }}
                            />
                            <FormSwitch
                                title="Show Tidal Synced Lyrics"
                                description="Display synchronized lyrics for Tidal playback."
                                value={s.showTidalLyrics}
                                onChange={v => { settings.store.showTidalLyrics = v; }}
                                hideBorder
                            />
                        </Card>
                    </div>
                )}

                {tab === "lyrics" && (
                    <div style={{ display: "grid", gap: "10px" }}>
                        <Card variant="primary">
                            <FormSwitch
                                title="Hover Controls Only"
                                description="Only show player controls when hovering or holding/double-pressing Ctrl."
                                value={s.hoverControls}
                                onChange={v => {
                                    settings.store.hoverControls = v;
                                    toggleHoverControls(v);
                                }}
                            />
                            <FormSwitch
                                title="Fallback Lyrics Provider"
                                description="Try alternative providers when the primary provider has no lyrics."
                                value={s.fallbackProvider}
                                onChange={v => { settings.store.fallbackProvider = v; }}
                            />
                            <FormSwitch
                                title="Hide Toast on Missing Lyrics"
                                description="Do not show a toast notification when lyrics cannot be found."
                                value={s.showFailedToasts}
                                onChange={v => { settings.store.showFailedToasts = v; }}
                            />
                            <div style={{ padding: "10px 0" }}>
                                <Paragraph style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
                                    Lyrics Position Relative to Player:
                                 </Paragraph>
                                 <Select
                                     options={[
                                         { label: "Above player", value: "above" },
                                         { label: "Below player", value: "below" },
                                     ]}
                                     isSelected={v => v === s.lyricsPosition}
                                     select={v => { settings.store.lyricsPosition = v as "above" | "below"; }}
                                     serialize={v => String(v)}
                                 />
                            </div>
                            <div style={{ padding: "10px 0" }}>
                                <Paragraph style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
                                    Default Lyrics Provider:
                                </Paragraph>
                                <Select
                                    options={[
                                        { label: "LRCLIB (Default)", value: Provider.Lrclib },
                                        { label: "Spotify (Musixmatch)", value: Provider.Spotify },
                                    ]}
                                    isSelected={v => v === s.lyricsProvider}
                                    select={v => { settings.store.lyricsProvider = v as Provider; }}
                                    serialize={v => String(v)}
                                />
                            </div>
                            <div style={{ paddingTop: "8px" }}>
                                <Button
                                    variant="secondary"
                                    size="small"
                                    onClick={() => {
                                        clearLyricsCache();
                                        showToast("Lyrics cache purged", Toasts.Type.SUCCESS);
                                    }}
                                >
                                    Purge Lyrics Cache
                                </Button>
                            </div>
                        </Card>
                    </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                    <Button variant="primary" onClick={handleClose}>
                        Done
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

export function openMusicControlsSettings() {
    openModal(modalProps => <MusicControlsSettingsModal modalProps={modalProps} />);
}

export const musicControlsModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "music-controls",
    name: "Music Controls",
    description: "Spotify & Tidal playback controls, song progress, and synced lyrics right in your user panel.",
    authors: [Devs.Ven, Devs.afn, Devs.KraXen72, Devs.Av32000, Devs.nin0dev, Devs.thororen, EquicordDevs.vmohammad, Devs.Joona],
    version: "2.0.0",
    tags: ["Media", "Audio", "Spotify", "Tidal"],
    icon: "🎵",
    position: "above",
    render: MusicControlsComponent,
    onEnable: startMusicControls,
    onDisable: stopMusicControls,
    settingsComponent: MusicControlsSettingsModal,
};

export { settings };
export { SpotifyStore } from "./spotify/SpotifyStore";
export { TidalStore } from "./tidal/TidalStore";
export type { Track as SpotifyTrack } from "./spotify/SpotifyStore";
export type { Track as TidalTrack } from "./tidal/TidalStore";
