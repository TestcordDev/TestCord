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
import type { CommandPayload, PlayerCommand, PlayerSnapshot, RepeatMode, YnisonEvent, YnisonStatus } from "./types";

const logger = new Logger("YMusicSync", "#ffcc00");

const LISTEN_TIMEOUT_MS = 30_000;
const LISTEN_RETRY_MS = 1_000;
const FALLBACK_TITLE = "Яндекс Музыка";
const SEEK_CONFIRM_TIMEOUT = 5_000;
const SEEK_CONFIRM_TOLERANCE = 2_000;

const MISSING_NATIVE =
    "Native helper YMusicSync not found. Run pnpm build, then pnpm inject and fully restart Discord";

const TOKEN_SETTING_PATH = "plugins.YMusicSync.oauthToken";

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export const YMusicSyncStore = proxyLazyWebpack(() => {
    const { Store } = Flux;

    class YnisonBridgeStore extends Store {
        public connected = false;
        public status: YnisonStatus | null = null;
        public lastError: string | null = null;
        public snapshot: PlayerSnapshot | null = null;
        public hiddenByPause = false;
        public hasPlayed = false;

        private serverSnapshot: PlayerSnapshot | null = null;
        private pauseTimer: number | null = null;
        private pausedSince: number | null = null;
        private active = false;
        private listenGeneration = 0;
        private appliedToken = "";
        private appliedStationToken: string | null = null;
        private positionAnchorMs = 0;
        private positionAnchorAt = Date.now();
        private pendingSeekMs: number | null = null;
        private pendingSeekAt = 0;

        public get hasToken(): boolean {
            return settings.store.oauthToken.trim().length > 0;
        }

        public get connectionState(): YnisonStatus["state"] {
            return this.status?.state ?? "idle";
        }

        public get positionMs(): number {
            if (!this.snapshot) return 0;

            let position = this.positionAnchorMs;
            if (this.snapshot.isPlaying) position += Date.now() - this.positionAnchorAt;
            if (this.snapshot.durationMs > 0) position = Math.min(position, this.snapshot.durationMs);
            return Math.max(0, position);
        }

        private readonly onTokenSettingChange = () => {
            void this.applyToken();
            void this.applyStationToken();
        };

        public async start(): Promise<void> {
            if (this.active) return;
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

        public async stop(): Promise<void> {
            this.active = false;
            this.listenGeneration++;
            SettingsStore.removeChangeListener(TOKEN_SETTING_PATH, this.onTokenSettingChange);
            if (this.pauseTimer !== null) window.clearTimeout(this.pauseTimer);
            this.pauseTimer = null;
            this.pausedSince = null;
            this.hiddenByPause = false;

            try {
                if (Native) this.status = await Native.disconnect();
            } catch (error) {
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

        public async restart(): Promise<void> {
            await this.stop();
            await this.start();
        }

        public async logDiagnostics(): Promise<YnisonStatus | null> {
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
            } catch (error) {
                logger.error("Diagnostics failed:", diagnostics, error);
                return null;
            }
        }

        public refreshPauseHide(): void {
            this.schedulePauseHide();
            this.emitChange();
        }

        public playPause(): void {
            if (this.snapshot) this.optimistic({ isPlaying: !this.snapshot.isPlaying });
            void this.command("playPause");
        }

        public previous(): void {
            void this.command("previous");
        }

        public next(): void {
            void this.command("next");
        }

        public toggleShuffle(): void {
            if (this.snapshot) this.optimistic({ shuffle: !this.snapshot.shuffle });
            void this.command("toggleShuffle");
        }

        public cycleRepeat(): void {
            if (this.snapshot) {
                const current = this.snapshot.repeat;
                const next: RepeatMode = current === "off" ? "context" : current === "context" ? "one" : "off";
                this.optimistic({ repeat: next });
            }
            void this.command("cycleRepeat");
        }

        public toggleMute(): void {
            void this.command("toggleMute");
        }

        public seek(positionMs: number): void {
            if (!this.snapshot) return;
            const { durationMs } = this.snapshot;
            const target = lodash.clamp(Math.round(positionMs), 0, durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER);
            this.pendingSeekMs = target;
            this.pendingSeekAt = Date.now();
            this.optimistic({ positionMs: target });
            void this.command("seek", { value: target });
        }

        public setVolume(volume: number): void {
            const target = lodash.clamp(Math.round(volume), 0, 100);
            if (this.snapshot) this.optimistic({ volume: target });
            void this.command("setVolume", { value: target / 100 });
        }

        public setActiveDevice(deviceId: string): void {
            if (!deviceId || !this.snapshot) return;
            const device = this.snapshot.devices.find(entry => entry.id === deviceId);
            this.optimistic({ activeDeviceId: deviceId, activeDeviceName: device?.title ?? "" });
            void this.command("setActiveDevice", { deviceId });
        }

        public async applyToken(): Promise<void> {
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

        public async applyStationToken(): Promise<void> {
            await this.syncToken("appliedStationToken", (native, token) => native.connectStations(token), error => {
                this.lastError = errorMessage(error);
                logger.error("Station lookup failed:", error);
            });
        }

        private async syncToken(
            appliedKey: "appliedToken" | "appliedStationToken",
            action: (native: NonNullable<typeof Native>, token: string) => Promise<void>,
            onError: (error: unknown) => void
        ): Promise<void> {
            if (!Native || !this.active) return;
            const native = Native;

            const token = settings.store.oauthToken.trim();
            if (token === this[appliedKey]) return;
            this[appliedKey] = token;

            try {
                await action(native, token);
            } catch (error) {
                onError(error);
            }
            this.emitChange();
        }

        public async rescanStations(): Promise<void> {
            if (!Native) return;

            try {
                await Native.rescanStations();
            } catch (error) {
                this.lastError = errorMessage(error);
                logger.error("Station rescan failed:", error);
                this.emitChange();
            }
        }

        private async listen(): Promise<void> {
            if (!Native) return;
            const generation = ++this.listenGeneration;

            while (this.active && generation === this.listenGeneration) {
                let events: YnisonEvent[];
                try {
                    events = await Native.waitForEvents(LISTEN_TIMEOUT_MS);
                } catch (error) {
                    this.lastError = errorMessage(error);
                    this.emitChange();
                    await sleep(LISTEN_RETRY_MS);
                    continue;
                }

                if (!this.active || generation !== this.listenGeneration) return;
                for (const event of events) this.handleEvent(event);
            }
        }

        private handleEvent(event: YnisonEvent): void {
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

        private applySnapshot(raw: PlayerSnapshot): void {
            this.serverSnapshot = raw;
            const snapshot = { ...raw, volume: lodash.clamp(Math.round(raw.volume * 100), 0, 100) };

            if (!snapshot.title) snapshot.title = this.snapshot?.title ?? FALLBACK_TITLE;

            const trackChanged = snapshot.trackId !== this.snapshot?.trackId;
            if (trackChanged) {
                this.pausedSince = null;
                this.pendingSeekMs = null;
            }
            if (snapshot.isPlaying) this.hasPlayed = true;

            if (this.pendingSeekMs !== null) {
                const elapsed = Date.now() - this.pendingSeekAt;
                if (elapsed > SEEK_CONFIRM_TIMEOUT || Math.abs(snapshot.positionMs - this.pendingSeekMs) <= SEEK_CONFIRM_TOLERANCE) {
                    this.pendingSeekMs = null;
                } else {
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

        private schedulePauseHide(): void {
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

            if (this.pausedSince === null) this.pausedSince = Date.now();
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

        private optimistic(partial: Partial<PlayerSnapshot>): void {
            if (!this.snapshot) return;
            const position = partial.positionMs ?? this.positionMs;
            this.snapshot = { ...this.snapshot, ...partial, positionMs: position };
            this.positionAnchorMs = position;
            this.positionAnchorAt = Date.now();
            this.schedulePauseHide();
            this.emitChange();
        }

        private async command(name: PlayerCommand, payload: CommandPayload = {}): Promise<boolean> {
            if (!Native) return false;

            let accepted = false;
            try {
                accepted = await Native.command(name, payload);
            } catch (error) {
                this.lastError = errorMessage(error);
                this.emitChange();
            }

            if (!accepted && this.serverSnapshot) this.applySnapshot(this.serverSnapshot);
            return accepted;
        }
    }

    return new YnisonBridgeStore(FluxDispatcher, {});
});
