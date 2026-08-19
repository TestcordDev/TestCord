/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher, lodash } from "@webpack/common";
import { Native } from "./nativeBridge";
import { settings } from "./settings";
const logger = new Logger("YMusicSync", "#ffcc00");
const LISTEN_TIMEOUT_MS = 30_000;
const LISTEN_RETRY_MS = 1_000;
const FALLBACK_TITLE = "Яндекс Музыка";
const SEEK_CONFIRM_TIMEOUT = 5_000;
const SEEK_CONFIRM_TOLERANCE = 2_000;
const MISSING_NATIVE = "Native helper YMusicSync not found. Run pnpm build, then pnpm inject and fully restart Discord";
const TOKEN_SETTING_PATH = "plugins.YMusicSync.oauthToken";
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export const YMusicSyncStore = proxyLazyWebpack(() => {
    const { Store } = Flux;
    class YnisonBridgeStore extends Store {
        connected = false;
        status = null;
        lastError = null;
        snapshot = null;
        hiddenByPause = false;
        hasPlayed = false;
        serverSnapshot = null;
        pauseTimer = null;
        pausedSince = null;
        active = false;
        listenGeneration = 0;
        appliedToken = "";
        appliedStationToken = null;
        positionAnchorMs = 0;
        positionAnchorAt = Date.now();
        pendingSeekMs = null;
        pendingSeekAt = 0;
        get hasToken() {
            return settings.store.oauthToken.trim().length > 0;
        }
        get connectionState() {
            return this.status?.state ?? "idle";
        }
        get positionMs() {
            if (!this.snapshot)
                return 0;
            let position = this.positionAnchorMs;
            if (this.snapshot.isPlaying)
                position += Date.now() - this.positionAnchorAt;
            if (this.snapshot.durationMs > 0)
                position = Math.min(position, this.snapshot.durationMs);
            return Math.max(0, position);
        }
        onTokenSettingChange = () => {
            void this.applyToken();
            void this.applyStationToken();
        };
        async start() {
            if (this.active)
                return;
            this.active = true;
            this.lastError = null;
            SettingsStore.addChangeListener(TOKEN_SETTING_PATH, this.onTokenSettingChange);
            this.emitChange();
            if (!Native) {
                this.lastError = MISSING_NATIVE;
                logger.error(MISSING_NATIVE);
                this.emitChange();
                return;
            }
            await this.applyToken();
            void this.applyStationToken();
            void this.listen();
        }
        async stop() {
            this.active = false;
            this.listenGeneration++;
            SettingsStore.removeChangeListener(TOKEN_SETTING_PATH, this.onTokenSettingChange);
            if (this.pauseTimer !== null)
                window.clearTimeout(this.pauseTimer);
            this.pauseTimer = null;
            this.pausedSince = null;
            this.hiddenByPause = false;
            try {
                if (Native)
                    this.status = await Native.disconnect();
            }
            catch (error) {
                this.lastError = errorMessage(error);
                logger.error("Ynison disconnect failed:", error);
            }
            this.appliedToken = "";
            this.appliedStationToken = null;
            this.connected = false;
            this.hasPlayed = false;
            this.snapshot = null;
            this.serverSnapshot = null;
            this.emitChange();
        }
        async restart() {
            await this.stop();
            await this.start();
        }
        async logDiagnostics() {
            const diagnostics = {
                nativeHelperAvailable: Boolean(Native),
                hasToken: this.hasToken,
                active: this.active,
                connected: this.connected,
                connectionState: this.connectionState,
                activeDevice: this.snapshot?.activeDeviceName ?? "",
                rendererStatus: this.status,
                rendererError: this.lastError
            };
            if (!Native) {
                logger.error("Diagnostics:", diagnostics);
                return null;
            }
            try {
                const status = await Native.getStatus();
                logger.info("Diagnostics:", { ...diagnostics, nativeStatus: status });
                return status;
            }
            catch (error) {
                logger.error("Diagnostics failed:", diagnostics, error);
                return null;
            }
        }
        refreshPauseHide() {
            this.schedulePauseHide();
            this.emitChange();
        }
        playPause() {
            if (this.snapshot)
                this.optimistic({ isPlaying: !this.snapshot.isPlaying });
            void this.command("playPause");
        }
        previous() {
            void this.command("previous");
        }
        next() {
            void this.command("next");
        }
        toggleShuffle() {
            if (this.snapshot)
                this.optimistic({ shuffle: !this.snapshot.shuffle });
            void this.command("toggleShuffle");
        }
        cycleRepeat() {
            if (this.snapshot) {
                const current = this.snapshot.repeat;
                const next = current === "off" ? "context" : current === "context" ? "one" : "off";
                this.optimistic({ repeat: next });
            }
            void this.command("cycleRepeat");
        }
        toggleMute() {
            void this.command("toggleMute");
        }
        seek(positionMs) {
            if (!this.snapshot)
                return;
            const { durationMs } = this.snapshot;
            const target = lodash.clamp(Math.round(positionMs), 0, durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER);
            this.pendingSeekMs = target;
            this.pendingSeekAt = Date.now();
            this.optimistic({ positionMs: target });
            void this.command("seek", { value: target });
        }
        setVolume(volume) {
            const target = lodash.clamp(Math.round(volume), 0, 100);
            if (this.snapshot)
                this.optimistic({ volume: target });
            void this.command("setVolume", { value: target / 100 });
        }
        setActiveDevice(deviceId) {
            if (!deviceId || !this.snapshot)
                return;
            const device = this.snapshot.devices.find(entry => entry.id === deviceId);
            this.optimistic({ activeDeviceId: deviceId, activeDeviceName: device?.title ?? "" });
            void this.command("setActiveDevice", { deviceId });
        }
        async applyToken() {
            await this.syncToken("appliedToken", async (native, token) => {
                this.status = await native.connect(token);
                this.connected = this.status.state === "connected";
                this.lastError = this.status.lastError;
                logger.info("Ynison status:", this.status);
            }, error => {
                this.connected = false;
                this.lastError = errorMessage(error);
                logger.error("Ynison connect failed:", error);
            });
        }
        async applyStationToken() {
            await this.syncToken("appliedStationToken", (native, token) => native.connectStations(token), error => {
                this.lastError = errorMessage(error);
                logger.error("Station lookup failed:", error);
            });
        }
        async syncToken(appliedKey, action, onError) {
            if (!Native || !this.active)
                return;
            const native = Native;
            const token = settings.store.oauthToken.trim();
            if (token === this[appliedKey])
                return;
            this[appliedKey] = token;
            try {
                await action(native, token);
            }
            catch (error) {
                onError(error);
            }
            this.emitChange();
        }
        async rescanStations() {
            if (!Native)
                return;
            try {
                await Native.rescanStations();
            }
            catch (error) {
                this.lastError = errorMessage(error);
                logger.error("Station rescan failed:", error);
                this.emitChange();
            }
        }
        async listen() {
            if (!Native)
                return;
            const generation = ++this.listenGeneration;
            while (this.active && generation === this.listenGeneration) {
                let events;
                try {
                    events = await Native.waitForEvents(LISTEN_TIMEOUT_MS);
                }
                catch (error) {
                    this.lastError = errorMessage(error);
                    this.emitChange();
                    await sleep(LISTEN_RETRY_MS);
                    continue;
                }
                if (!this.active || generation !== this.listenGeneration)
                    return;
                for (const event of events)
                    this.handleEvent(event);
            }
        }
        handleEvent(event) {
            switch (event.type) {
                case "status":
                    this.status = event.status;
                    this.connected = event.status.state === "connected";
                    this.lastError = event.status.lastError;
                    this.emitChange();
                    break;
                case "snapshot":
                    this.applySnapshot(event.snapshot);
                    break;
                case "error":
                    this.lastError = event.message;
                    logger.warn(event.message);
                    this.emitChange();
                    break;
                case "log":
                    logger.info(event.message);
                    break;
            }
        }
        applySnapshot(raw) {
            this.serverSnapshot = raw;
            const snapshot = { ...raw, volume: lodash.clamp(Math.round(raw.volume * 100), 0, 100) };
            if (!snapshot.title)
                snapshot.title = this.snapshot?.title ?? FALLBACK_TITLE;
            const trackChanged = snapshot.trackId !== this.snapshot?.trackId;
            if (trackChanged) {
                this.pausedSince = null;
                this.pendingSeekMs = null;
            }
            if (snapshot.isPlaying)
                this.hasPlayed = true;
            if (this.pendingSeekMs !== null) {
                const elapsed = Date.now() - this.pendingSeekAt;
                if (elapsed > SEEK_CONFIRM_TIMEOUT || Math.abs(snapshot.positionMs - this.pendingSeekMs) <= SEEK_CONFIRM_TOLERANCE) {
                    this.pendingSeekMs = null;
                }
                else {
                    snapshot.positionMs = this.pendingSeekMs + (snapshot.isPlaying ? elapsed : 0);
                }
            }
            this.snapshot = snapshot;
            this.positionAnchorMs = snapshot.positionMs;
            this.positionAnchorAt = Date.now();
            this.lastError = null;
            this.schedulePauseHide();
            this.emitChange();
        }
        schedulePauseHide() {
            if (this.pauseTimer !== null) {
                window.clearTimeout(this.pauseTimer);
                this.pauseTimer = null;
            }
            const delay = settings.store.hideAfterPauseSeconds * 1000;
            if (this.snapshot?.isPlaying || delay <= 0) {
                this.pausedSince = null;
                this.hiddenByPause = false;
                return;
            }
            if (this.pausedSince === null)
                this.pausedSince = Date.now();
            const remaining = delay - (Date.now() - this.pausedSince);
            if (remaining <= 0) {
                this.hiddenByPause = true;
                return;
            }
            this.pauseTimer = window.setTimeout(() => {
                this.pauseTimer = null;
                this.hiddenByPause = true;
                this.emitChange();
            }, remaining);
        }
        optimistic(partial) {
            if (!this.snapshot)
                return;
            const position = partial.positionMs ?? this.positionMs;
            this.snapshot = { ...this.snapshot, ...partial, positionMs: position };
            this.positionAnchorMs = position;
            this.positionAnchorAt = Date.now();
            this.schedulePauseHide();
            this.emitChange();
        }
        async command(name, payload = {}) {
            if (!Native)
                return false;
            let accepted = false;
            try {
                accepted = await Native.command(name, payload);
            }
            catch (error) {
                this.lastError = errorMessage(error);
                this.emitChange();
            }
            if (!accepted && this.serverSnapshot)
                this.applySnapshot(this.serverSnapshot);
            return accepted;
        }
    }
    return new YnisonBridgeStore(FluxDispatcher, {});
});
