/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher } from "@webpack/common";
import { settings } from "../settings";
const logger = new Logger("TidalControls");
function mapApiResponseToTrack(apiData) {
    if (!apiData?.track)
        return null;
    const { track } = apiData;
    const artist = track.artist?.name || (track.artists?.[0]?.name) || "Unknown Artist";
    return {
        name: track.title || "Unknown Title",
        artist,
        imageSrc: apiData.coverUrl || null,
        songDuration: apiData.duration || track.duration || 0,
        elapsedSeconds: apiData.currentTime || 0,
        url: track.url || null,
        album: track.album?.title || null,
        id: track.id?.toString() || "0",
        vibrantColor: track.album.vibrantColor || null,
    };
}
class TidalSocket {
    onChange;
    ready = false;
    socket;
    constructor(onChange) {
        this.reconnect();
        this.onChange = onChange;
    }
    reconnect() {
        if (this.ready)
            return;
        try {
            this.initWs();
        }
        catch (e) {
            logger.error("Failed to connect to Tidal WebSocket", e);
            return;
        }
        this.ready = true;
    }
    get routes() {
        return {
            "play": () => this.socket?.send(JSON.stringify({ action: "resume" })),
            "pause": () => this.socket?.send(JSON.stringify({ action: "pause" })),
            "toggle": () => this.socket?.send(JSON.stringify({ action: "toggle" })),
            "previous": () => this.socket?.send(JSON.stringify({ action: "previous" })),
            "next": () => this.socket?.send(JSON.stringify({ action: "next" })),
            "seek": (seconds) => this.socket?.send(JSON.stringify({ action: "seek", time: seconds })),
            "shuffle": (shuffle) => this.socket?.send(JSON.stringify({ action: "setShuffleMode", shuffle })),
            "repeat": (mode) => this.socket?.send(JSON.stringify({ action: "setRepeatMode", mode })),
            "volume": (volume) => this.socket?.send(JSON.stringify({ action: "volume", volume })),
        };
    }
    initWs() {
        const url = settings.store.websocketURL || "ws://localhost:24123";
        if (!url) {
            return;
        }
        this.socket = new WebSocket(url);
        this.socket.addEventListener("open", () => {
            this.ready = true;
            this.socket?.send(JSON.stringify({ action: "subscribe", all: true, fields: ["currentTime"] }));
        });
        this.socket.addEventListener("error", e => {
            if (!this.ready)
                setTimeout(() => this.reconnect(), 5_000);
            this.onChange({ type: "update", all: true, fields: { playing: false, track: null, currentTime: 0, repeatMode: 0, shuffle: false, volume: 100 } });
        });
        this.socket.addEventListener("close", e => {
            this.ready = false;
            if (!this.ready)
                setTimeout(() => this.reconnect(), 10_000);
            this.onChange({ type: "update", all: true, fields: { playing: false, track: null, currentTime: 0, repeatMode: 0, shuffle: false, volume: 100 } });
        });
        this.socket.addEventListener("message", e => {
            let message;
            try {
                message = JSON.parse(e.data);
                switch (message.type) {
                    case "update":
                        this.onChange(message);
                        break;
                    case "subscribed":
                        logger.info("Successfully subscribed to Tidal API updates");
                        break;
                    case "error":
                        logger.error("Tidal API error:", message);
                        break;
                }
            }
            catch (err) {
                logger.error("Invalid JSON:", err, `\n${e.data}`);
                return;
            }
        });
    }
}
export const TidalStore = proxyLazyWebpack(() => {
    const { Store } = Flux;
    class TidalStore extends Store {
        mPosition = 0;
        start = 0;
        track = null;
        isPlaying = false;
        repeat = 0;
        shuffle = false;
        volume = 100;
        playerElement = null;
        socket = new TidalSocket((message) => {
            if (message.type === "update" && message.all && message.fields) {
                const apiData = message.fields;
                const track = mapApiResponseToTrack(apiData);
                if (track) {
                    store.track = { ...track };
                    store.position = (apiData.currentTime || 0);
                    if (track.vibrantColor) {
                        if (this.playerElement) {
                            this.playerElement.style.setProperty("--eq-tdl-slider-gradient", `linear-gradient(to right, ${track.vibrantColor} 80%, #E5E5E5 100%)`);
                            this.playerElement.style.setProperty("--eq-tdl-slider-grabber", track.vibrantColor);
                        }
                        else {
                            this.playerElement = document.querySelector("#eq-tdl-player");
                            logger.info(this.playerElement ? "Player element found" : "Player element not found");
                        }
                    }
                }
                if (apiData.playing !== undefined)
                    store.isPlaying = apiData.playing;
                if (apiData.repeatMode !== undefined)
                    store.repeat = apiData.repeatMode;
                if (apiData.shuffle !== undefined)
                    store.shuffle = apiData.shuffle;
                if (apiData.volume !== undefined)
                    store.volume = apiData.volume;
                store.emitChange();
            }
        });
        openExternal(path) {
            VencordNative.native.openExternal(path.replace("http://www.tidal.com", "tidal://"));
        }
        set position(p) {
            this.mPosition = p * 1000;
            this.start = Date.now();
        }
        get position() {
            let pos = this.mPosition;
            if (this.isPlaying) {
                pos += Date.now() - this.start;
            }
            return pos;
        }
        previous() {
            if (!this.ensureSocketReady())
                return;
            this.socket.routes.previous();
        }
        next() {
            if (!this.ensureSocketReady())
                return;
            this.socket.routes.next();
        }
        setVolume(percent) {
            if (!this.ensureSocketReady())
                return;
            const volume = Math.max(1, Math.min(100, Math.round(percent)));
            this.socket.routes.volume(volume);
            this.volume = volume;
            this.emitChange();
        }
        setPlaying(playing) {
            if (!this.ensureSocketReady())
                return;
            this.socket.routes[playing ? "play" : "pause"]();
            this.isPlaying = playing;
        }
        setRepeat(state) {
            if (!this.ensureSocketReady())
                return;
            this.socket.routes.repeat(state);
            this.repeat = state;
            this.emitChange();
        }
        setShuffle(state) {
            if (!this.ensureSocketReady())
                return;
            this.socket.routes.shuffle(state);
            this.shuffle = state;
            this.emitChange();
        }
        seek(ms) {
            if (!this.ensureSocketReady())
                return;
            this.socket.routes.seek(Math.round(ms / 1000));
        }
        ensureSocketReady() {
            if (!this.socket || !this.socket.ready) {
                return false;
            }
            return true;
        }
    }
    const store = new TidalStore(FluxDispatcher);
    return store;
});
