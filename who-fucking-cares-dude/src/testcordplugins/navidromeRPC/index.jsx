/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";
import smd5 from "file://spark-md5.js?minify";
import { ServerConfig } from "./components/ServerConfig";
import { getApplicationAsset } from "./utils/constants";
import { getNowPlayingTrack, req } from "./utils/navidrome";
const shp = {
    hidden: true,
    description: ""
};
export const settings = definePluginSettings({
    serverURL: {
        ...shp,
        type: 0 /* OptionType.STRING */
    },
    username: {
        ...shp,
        type: 0 /* OptionType.STRING */
    },
    isLoggedIn: {
        ...shp,
        type: 3 /* OptionType.BOOLEAN */,
        default: false
    },
    serverConfigComponent: {
        type: 6 /* OptionType.COMPONENT */,
        component: () => <ServerConfig />
    },
    delay: {
        type: 1 /* OptionType.NUMBER */,
        description: "Delay between the requests to Navidrome in milliseconds. 1000 = 1 second",
        default: 1000,
        restartNeeded: true
    },
    name: {
        type: 0 /* OptionType.STRING */,
        description: "The application name that'll show (Listening to _____). Use %ARTIST% to get the main artist, %ARTISTS% to get all artists, %ALBUM% to get the album and %TRACK% to get the track",
        default: "Navidrome"
    },
    shouldCalculateTimestamps: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show the song progress with start and finish times, if disabled will only show start time (how many mins ago). Insanely buggy",
        default: false
    }
});
export default definePlugin({
    name: "NavidromeRPC",
    description: "Show the currently playing song on your Navidrome server in your Rich Presence",
    tags: ["Activity", "Media"],
    authors: [Devs.nin0dev],
    settings,
    interval: -1,
    restartTimeout: -1,
    running: false,
    generation: 0,
    updateInFlight: false,
    start() {
        this.running = true;
        this.generation++;
        this.updateInFlight = false;
        (0, eval)(smd5);
        settings.store.isLoggedIn && this.initRPC();
    },
    stop() {
        this.running = false;
        this.generation++;
        delete window.SparkMD5;
        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            activity: null,
            socket: "NavidromeRPC"
        });
        clearInterval(this.interval);
        clearTimeout(this.restartTimeout);
    },
    req,
    getNowPlayingTrack,
    initRPC() {
        if (!this.running)
            return;
        const { generation } = this;
        const fn = async () => {
            if (!this.running || generation !== this.generation || this.updateInFlight)
                return;
            this.updateInFlight = true;
            try {
                const track = await getNowPlayingTrack();
                if (!this.running || generation !== this.generation)
                    return;
                await this.setRichPresence(track, generation);
            }
            catch (e) {
                console.error(e);
                if (!this.running || generation !== this.generation)
                    return;
                FluxDispatcher.dispatch({
                    type: "LOCAL_ACTIVITY_UPDATE",
                    activity: null,
                    socket: "NavidromeRPC"
                });
                clearInterval(this.interval);
                this.restartTimeout = window.setTimeout(() => {
                    if (!this.running || generation !== this.generation)
                        return;
                    // @ts-expect-error
                    this.interval = setInterval(fn, settings.store.delay);
                }, 5000);
            }
            finally {
                if (generation === this.generation)
                    this.updateInFlight = false;
            }
        };
        fn();
        // @ts-expect-error
        this.interval = setInterval(fn, settings.store.delay);
    },
    async setRichPresence(track, generation) {
        if (!this.running || generation !== this.generation)
            return;
        if (!track.isPlaying) {
            return void FluxDispatcher.dispatch({
                type: "LOCAL_ACTIVITY_UPDATE",
                activity: null,
                socket: "NavidromeRPC"
            });
        }
        let times = {};
        if (settings.store.shouldCalculateTimestamps)
            times = {
                timestamps: track.timestamps
            };
        const largeImage = await getApplicationAsset(track.album.art);
        if (!this.running || generation !== this.generation)
            return;
        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            activity: {
                application_id: "1396969056136986775",
                name: settings.store.name
                    .replaceAll("%ARTIST%", track.artists[0])
                    .replaceAll("%ARTISTS%", track.artists.join(", "))
                    .replaceAll("%ALBUM%", track.album.name)
                    .replaceAll("%TRACK%", track.title),
                type: 2,
                status_display_type: 1,
                details: track.title,
                state: track.artists.join(", "),
                assets: {
                    large_image: largeImage,
                    large_text: track.album.name
                },
                ...times
            },
            socketId: "NavidromeRPC",
        });
    }
});
