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
import { isPluginEnabled } from "@api/PluginManager";
import OpenInAppPlugin from "@plugins/openInApp";
import { findByProps, findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher } from "@webpack/common";
import { settings } from "../settings";
// Don't wanna run before Flux and Dispatcher are ready!
export const SpotifyStore = proxyLazyWebpack(() => {
    // For some reason ts hates extends Flux.Store
    const { Store } = Flux;
    const SpotifySocket = findByProps("getActiveSocketAndDevice");
    const SpotifyAPI = findByPropsLazy("vcSpotifyMarker");
    const API_BASE = "https://api.spotify.com/v1/me/player";
    class SpotifyStore extends Store {
        mPosition = 0;
        _start = 0;
        track = null;
        device = null;
        isPlaying = false;
        repeat = "off";
        shuffle = false;
        volume = 0;
        isSettingPosition = false;
        openExternal(path) {
            const url = settings.store.useSpotifyUris || isPluginEnabled(OpenInAppPlugin.name)
                ? "spotify:" + path.replaceAll("/", (_, idx) => idx === 0 ? "" : ":")
                : "https://open.spotify.com" + path;
            VencordNative.native.openExternal(url);
        }
        // Need to keep track of this manually
        get position() {
            let pos = this.mPosition;
            if (this.isPlaying) {
                pos += Date.now() - this._start;
            }
            return pos;
        }
        set position(p) {
            this.mPosition = p;
            this._start = Date.now();
        }
        prev() {
            this._req("post", "/previous");
        }
        next() {
            this._req("post", "/next");
        }
        setVolume(percent) {
            this._req("put", "/volume", {
                query: {
                    volume_percent: Math.round(percent)
                }
            }).then(() => {
                this.volume = percent;
                this.emitChange();
            });
        }
        setPlaying(playing) {
            this._req("put", playing ? "/play" : "/pause");
        }
        setRepeat(state) {
            this._req("put", "/repeat", {
                query: { state }
            });
        }
        setShuffle(state) {
            this._req("put", "/shuffle", {
                query: { state }
            }).then(() => {
                this.shuffle = state;
                this.emitChange();
            });
        }
        seek(ms) {
            if (this.isSettingPosition)
                return Promise.resolve();
            this.isSettingPosition = true;
            return this._req("put", "/seek", {
                query: {
                    position_ms: Math.round(ms)
                }
            }).catch((e) => {
                console.error("[VencordSpotifyControls] Failed to seek", e);
                this.isSettingPosition = false;
            });
        }
        _req(method, route, data = {}) {
            if (this.device?.is_active)
                (data.query ??= {}).device_id = this.device.id;
            const { socket } = SpotifySocket.getActiveSocketAndDevice();
            return SpotifyAPI[method](socket.accountId, socket.accessToken, {
                url: API_BASE + route,
                ...data
            });
        }
    }
    const store = new SpotifyStore(FluxDispatcher, {
        SPOTIFY_PLAYER_STATE(e) {
            store.track = e.track;
            store.device = e.device ?? null;
            store.isPlaying = e.isPlaying ?? false;
            store.volume = e.volumePercent ?? 0;
            store.repeat = e.actual_repeat || "off";
            store.shuffle = e.shuffle ?? false;
            store.position = e.position ?? 0;
            store.isSettingPosition = false;
            store.emitChange();
        },
        SPOTIFY_SET_DEVICES({ devices }) {
            store.device = devices.find(d => d.is_active) ?? devices[0] ?? null;
            store.emitChange();
        }
    });
    return store;
});
