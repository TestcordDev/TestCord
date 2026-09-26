/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SYM_LAZY_CACHED } from "@utils/lazy";
import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";
import { proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher } from "@webpack/common";

import { settings } from "../settings";

export interface StrawberryTrack {
    id: string;
    name: string;
    artist: string;
    imageSrc?: string | null;
    songDuration: number;
    elapsedSeconds?: number;
    url?: string | null;
    album?: string | null;
    vibrantColor?: string | null;
}

export interface PlayerState {
    track: StrawberryTrack | null;
    isPlaying: boolean;
    position: number;
    repeat: Repeat;
    shuffle: boolean;
    volume: number;
}

export type Repeat = 0 | 1 | 2;

const logger = new Logger("StrawberryControls");

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60_000;

const Native = (VencordNative?.pluginHelpers?.PanelLayout || {}) as PluginNative<typeof import("../../../native")>;

type Message =
    | { type: "update"; all: boolean; fields?: any; field?: string; value?: any; }
    | { event: string; [key: string]: any; }
    | { action: string; [key: string]: any; }
    | { playing?: boolean; track?: any; currentTime?: number; volume?: number; };

class StrawberrySocket {
    public onChange: (e: Message) => void;
    public ready = false;
    public destroyed = false;
    public socket: WebSocket | undefined;
    private reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    private reconnectDelay = RECONNECT_BASE_MS;

    constructor(onChange: typeof this.onChange) {
        this.onChange = onChange;
        this.reconnect();
    }

    public reconnect() {
        if (this.ready || this.destroyed) return;
        try {
            this.initWs();
        } catch (e) {
            logger.error("Failed to connect to Strawberry WebSocket", e);
            this.scheduleReconnect();
        }
    }

    public close() {
        this.destroyed = true;
        this.clearReconnect();
        this.socket?.close();
        this.socket = undefined;
    }

    private clearReconnect() {
        if (this.reconnectTimeout === undefined) return;
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = undefined;
    }

    /**
     * A failed connect always ends in a `close` event, so that is the only place a
     * retry is scheduled from. Scheduling from `error` as well doubled the pending
     * timers on every attempt (the second assignment orphaned the first), which grew
     * without bound and eventually exhausted sockets.
     */
    private scheduleReconnect() {
        if (this.destroyed) return;
        this.clearReconnect();
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = undefined;
            this.reconnect();
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    }

    get routes() {
        return {
            play: () => this.sendAction("resume", { action: "play" }),
            pause: () => this.sendAction("pause"),
            toggle: () => this.sendAction("toggle"),
            previous: () => this.sendAction("previous"),
            next: () => this.sendAction("next"),
            seek: (seconds: number) => this.sendAction("seek", { action: "seek", time: seconds, position: seconds }),
            shuffle: (shuffle: boolean) => this.sendAction("setShuffleMode", { action: "shuffle", shuffle }),
            repeat: (mode: Repeat) => this.sendAction("setRepeatMode", { action: "repeat", mode }),
            volume: (volume: number) => this.sendAction("volume", { action: "volume", volume }),
        };
    }

    private sendAction(action: string, payload?: Record<string, any>) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        try {
            this.socket.send(JSON.stringify(payload || { action }));
        } catch (err) {
            logger.error("Failed to send action to Strawberry WebSocket:", err);
        }
    }

    private initWs() {
        const url = settings.store.strawberryWebsocketUrl || "ws://localhost:24124";
        if (!url) return;

        // Drop the previous socket before making a new one. The old handlers stay
        // attached, and its `close` fires later, so the identity check in the close
        // handler is what keeps a stale socket from scheduling further retries.
        const previous = this.socket;
        this.socket = undefined;
        previous?.close();

        let socket: WebSocket;
        try {
            socket = new WebSocket(url);
        } catch {
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;

        socket.addEventListener("open", () => {
            this.reconnectDelay = RECONNECT_BASE_MS;
            this.ready = true;
            this.sendAction("subscribe", { action: "subscribe", all: true });
        });

        socket.addEventListener("close", () => {
            if (this.socket !== socket) return;
            this.socket = undefined;
            this.ready = false;
            this.scheduleReconnect();
        });

        socket.addEventListener("message", e => {
            try {
                const message = JSON.parse(e.data) as Message;
                this.onChange(message);
            } catch (err) {
                logger.error("Invalid JSON from Strawberry WS:", err);
            }
        });
    }
}

export const StrawberryStore = proxyLazyWebpack(() => {
    const { Store } = Flux;

    class StrawberryStoreClass extends Store {
        public mPosition = 0;
        public start = 0;
        public track: StrawberryTrack | null = null;
        public isPlaying = false;
        public repeat: Repeat = 0;
        public shuffle = false;
        public volume = 100;
        public playerElement: HTMLElement | null = null;

        private pollInterval: ReturnType<typeof setInterval> | null = null;
        public socket: StrawberrySocket | null = null;
        private connectStarted = false;

        constructor(dispatcher: any) {
            super(dispatcher);
            this.connect();
        }

        /**
         * Nothing here should reach for the network unless Strawberry is actually on
         * screen. Both surface settings default to false, but the connection mode defaults
         * to "auto", so this used to open a socket and start a 1.5s poller for a player
         * that was never going to render, against a server that is usually not running.
         *
         * Idempotent, and callable after construction, because this store is a lazy
         * singleton: turning the surface on after something already read it still has to
         * bring the connection up.
         */
        public connect() {
            if (this.connectStarted) return;
            const wanted = settings.store.showStrawberryControls || settings.store.showStrawberryLyrics;
            if (!wanted) return;
            this.connectStarted = true;

            // Initialize WebSocket bridge if enabled or in auto mode
            const mode = settings.store.strawberryConnectionMode || "auto";
            if (mode === "websocket" || mode === "auto") {
                this.socket = new StrawberrySocket((message: any) => {
                    this.handleSocketMessage(message);
                });
            }

            // Start native poller if on Desktop and mode supports it
            if (mode === "native" || mode === "auto" || mode === "http") {
                this.startPoller();
            }
        }

        private handleSocketMessage(message: any) {
            if (message.type === "update" && message.fields) {
                const data = message.fields;
                if (data.track) {
                    this.track = {
                        id: String(data.track.id || `${data.track.title}-${data.track.artist}`),
                        name: data.track.title || data.track.name || "Unknown Title",
                        artist: data.track.artist?.name || data.track.artist || "Unknown Artist",
                        album: data.track.album?.title || data.track.album || null,
                        imageSrc: data.coverUrl || data.track.imageSrc || null,
                        songDuration: data.duration || data.track.duration || 0,
                        elapsedSeconds: data.currentTime || 0,
                    };
                    this.position = data.currentTime || 0;
                }
                if (data.playing !== undefined) this.isPlaying = Boolean(data.playing);
                if (data.repeatMode !== undefined) this.repeat = data.repeatMode;
                if (data.shuffle !== undefined) this.shuffle = Boolean(data.shuffle);
                if (data.volume !== undefined) this.volume = data.volume;
                this.emitChange();
            } else if (message.playing !== undefined || message.title || message.track) {
                const trackData = message.track || message;
                this.track = {
                    id: String(trackData.id || `${trackData.title}-${trackData.artist}`),
                    name: trackData.title || trackData.name || "Unknown Title",
                    artist: trackData.artist || "Unknown Artist",
                    album: trackData.album || null,
                    imageSrc: trackData.coverUrl || trackData.imageSrc || null,
                    songDuration: trackData.duration || trackData.length || 0,
                    elapsedSeconds: trackData.currentTime || trackData.position || 0,
                };
                if (message.playing !== undefined) this.isPlaying = Boolean(message.playing);
                this.emitChange();
            }
        }

        private startPoller() {
            if (this.pollInterval) return;

            const poll = async () => {
                const mode = settings.store.strawberryConnectionMode || "auto";

                // If WebSocket is active and receiving events, we don't need heavy native polling
                if (this.socket?.ready && mode === "auto") {
                    return;
                }

                // If HTTP mode is selected, try HTTP polling
                if (mode === "http") {
                    try {
                        const httpUrl = settings.store.strawberryHttpUrl || "http://localhost:6800";
                        const res = await fetch(`${httpUrl}/status`, { signal: AbortSignal.timeout(1500) });
                        if (res.ok) {
                            const data = await res.json();
                            this.handleSocketMessage(data);
                            return;
                        }
                    } catch { }
                }

                // Native IPC polling via PanelLayout native helper
                if (typeof (Native as any)?.getStrawberryState === "function") {
                    try {
                        const customPath = settings.store.strawberryBinaryPath;
                        const state = await (Native as any).getStrawberryState(customPath);
                        if (state && state.running) {
                            if (state.track) {
                                this.track = {
                                    id: state.track.id,
                                    name: state.track.name,
                                    artist: state.track.artist,
                                    album: state.track.album || null,
                                    imageSrc: state.track.imageSrc || null,
                                    songDuration: state.track.songDuration || 0,
                                    elapsedSeconds: state.track.elapsedSeconds || 0,
                                    url: null,
                                };
                                this.mPosition = state.position || 0;
                                this.start = Date.now();
                            }
                            this.isPlaying = Boolean(state.isPlaying);
                            if (typeof state.volume === "number") this.volume = state.volume;
                            this.emitChange();
                        }
                    } catch (err) {
                        logger.error("Failed to query native Strawberry state:", err);
                    }
                }
            };

            void poll();
            this.pollInterval = setInterval(poll, 1500);
        }

        set position(p: number) {
            this.mPosition = p * 1000;
            this.start = Date.now();
        }

        get position(): number {
            let pos = this.mPosition;
            if (this.isPlaying) {
                pos += Date.now() - this.start;
            }
            return pos;
        }

        public openExternal(path?: string) {
            if (path) {
                VencordNative.native.openExternal(path);
            }
        }

        public previous() {
            if (this.socket?.ready) {
                this.socket.routes.previous();
            } else if (typeof (Native as any)?.sendStrawberryCommand === "function") {
                (Native as any).sendStrawberryCommand("previous", undefined, settings.store.strawberryBinaryPath);
            }
        }

        public next() {
            if (this.socket?.ready) {
                this.socket.routes.next();
            } else if (typeof (Native as any)?.sendStrawberryCommand === "function") {
                (Native as any).sendStrawberryCommand("next", undefined, settings.store.strawberryBinaryPath);
            }
        }

        public setPlaying(playing: boolean) {
            if (this.socket?.ready) {
                this.socket.routes[playing ? "play" : "pause"]();
            } else if (typeof (Native as any)?.sendStrawberryCommand === "function") {
                (Native as any).sendStrawberryCommand(playing ? "play" : "pause", undefined, settings.store.strawberryBinaryPath);
            }
            this.isPlaying = playing;
            this.start = Date.now();
            this.emitChange();
        }

        public toggle() {
            if (this.socket?.ready) {
                this.socket.routes.toggle();
            } else if (typeof (Native as any)?.sendStrawberryCommand === "function") {
                (Native as any).sendStrawberryCommand("toggle", undefined, settings.store.strawberryBinaryPath);
            }
            this.isPlaying = !this.isPlaying;
            this.start = Date.now();
            this.emitChange();
        }

        public seek(ms: number) {
            const seconds = Math.round(ms / 1000);
            if (this.socket?.ready) {
                this.socket.routes.seek(seconds);
            } else if (typeof (Native as any)?.sendStrawberryCommand === "function") {
                (Native as any).sendStrawberryCommand("seek", seconds, settings.store.strawberryBinaryPath);
            }
            this.mPosition = ms;
            this.start = Date.now();
            this.emitChange();
        }

        public setVolume(percent: number) {
            const volume = Math.max(0, Math.min(100, Math.round(percent)));
            if (this.socket?.ready) {
                this.socket.routes.volume(volume);
            } else if (typeof (Native as any)?.sendStrawberryCommand === "function") {
                (Native as any).sendStrawberryCommand("volume", volume, settings.store.strawberryBinaryPath);
            }
            this.volume = volume;
            this.emitChange();
        }

        public setRepeat(state: Repeat) {
            if (this.socket?.ready) {
                this.socket.routes.repeat(state);
            }
            this.repeat = state;
            this.emitChange();
        }

        public setShuffle(state: boolean) {
            if (this.socket?.ready) {
                this.socket.routes.shuffle(state);
            }
            this.shuffle = state;
            this.emitChange();
        }

        public destroy() {
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
            }
            this.socket?.close();
            this.socket = null;
        }
    }

    const store = new StrawberryStoreClass(FluxDispatcher);
    return store;
});

export function stopStrawberryStore() {
    StrawberryStore[SYM_LAZY_CACHED]?.destroy();
}
