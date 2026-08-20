/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { findStoreLazy } from "@webpack";
import { AuthenticationStore, RestAPI, UserStore } from "@webpack/common";

import type { Game, SessionInfo, SpooferStats, SpoofOptions } from "./types";

const logger = new Logger("BadgeSpooferEngine", "#ff73fa");

const GAMES_CDN_URL = "https://cdn.discordapp.com/detectables/games.json";
const SCIENCE_URL = "/science?source=badge_spoofer";
const ME_URL = "/users/@me?with_analytics_token=true";

const CLIENT_VERSION = "1.0.9253";
const CLIENT_BUILD_NUMBER = 594031;
const NATIVE_BUILD_NUMBER = 88414;
const OS_VERSION = "10.0.26200";
const USER_AGENT = typeof navigator !== "undefined" ? navigator.userAgent : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9253 Chrome/148.0.7778.280 Electron/42.7.1 Safari/537.36";

export class BadgeSpooferEngine {
    private static instance: BadgeSpooferEngine;

    private cachedGames: Game[] = [];
    private analyticsToken = "";
    private analyticsTokenFetchedAt = 0;
    private abortController: AbortController | null = null;
    private isRunning = false;

    private stats: SpooferStats = {
        totalGamesClaimed: 0,
        totalHoursClaimed: 0,
        totalStreamHoursClaimed: 0,
        usedGames: [],
        fingerprint: ""
    };

    public static getInstance(): BadgeSpooferEngine {
        if (!BadgeSpooferEngine.instance) {
            BadgeSpooferEngine.instance = new BadgeSpooferEngine();
        }
        return BadgeSpooferEngine.instance;
    }

    public async init() {
        await this.loadStats();
    }

    public async loadStats(): Promise<SpooferStats> {
        try {
            const saved = await DataStore.get("badge_spoofer_stats");
            if (saved && typeof saved === "object") {
                this.stats = {
                    totalGamesClaimed: Number(saved.totalGamesClaimed) || 0,
                    totalHoursClaimed: Number(saved.totalHoursClaimed) || 0,
                    totalStreamHoursClaimed: Number(saved.totalStreamHoursClaimed) || 0,
                    usedGames: Array.isArray(saved.usedGames) ? saved.usedGames : [],
                    fingerprint: typeof saved.fingerprint === "string" ? saved.fingerprint : ""
                };
            }
        } catch (e) {
            logger.error("Failed to load spoofer stats:", e);
        }
        return { ...this.stats };
    }

    public async saveStats(): Promise<void> {
        try {
            await DataStore.set("badge_spoofer_stats", this.stats);
        } catch (e) {
            logger.error("Failed to save spoofer stats:", e);
        }
    }

    public getStats(): SpooferStats {
        return { ...this.stats };
    }

    public setFingerprint(fp: string) {
        this.stats.fingerprint = fp.trim();
        this.saveStats();
    }

    public clearHistory() {
        this.stats.totalGamesClaimed = 0;
        this.stats.totalHoursClaimed = 0;
        this.stats.totalStreamHoursClaimed = 0;
        this.stats.usedGames = [];
        this.saveStats();
    }

    public getIsRunning(): boolean {
        return this.isRunning;
    }

    public async loadGames(forceReload = false): Promise<Game[]> {
        if (this.cachedGames.length > 0 && !forceReload) {
            return this.cachedGames;
        }

        try {
            if (!forceReload) {
                const storedGames = await DataStore.get("badge_spoofer_cached_games");
                if (Array.isArray(storedGames) && storedGames.length > 0) {
                    this.cachedGames = storedGames;
                    return this.cachedGames;
                }
            }

            const response = await fetch(GAMES_CDN_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status} loading games CDN`);

            const data = await response.json();
            const games: Game[] = [];
            const seen = new Set<string>();

            for (const entry of data) {
                const gid = String(entry.id || "");
                if (!/^\d+$/.test(gid) || seen.has(gid)) continue;

                const winExe = entry.executables?.find((e: any) => e.os === "win32" && e.name)?.name || "game.exe";
                seen.add(gid);
                games.push({
                    id: gid,
                    name: entry.name || `Game ${gid}`,
                    exe: winExe
                });
            }

            this.cachedGames = games;
            await DataStore.set("badge_spoofer_cached_games", games);
            return games;
        } catch (e) {
            logger.error("Failed to load games database:", e);
            return this.cachedGames;
        }
    }

    public async getAnalyticsToken(force = false): Promise<string> {
        const MAX_AGE = 12 * 3600 * 1000;
        if (!force && this.analyticsToken && (Date.now() - this.analyticsTokenFetchedAt < MAX_AGE)) {
            return this.analyticsToken;
        }

        try {
            const res = await RestAPI.get({ url: ME_URL });
            const token = res?.body?.analytics_token;
            if (token && typeof token === "string") {
                this.analyticsToken = token;
                this.analyticsTokenFetchedAt = Date.now();
                return token;
            }
        } catch (e) {
            logger.warn("RestAPI get analytics token failed, attempting fallback:", e);
        }

        try {
            const token = (AuthenticationStore as any)?.getToken?.() || (findStoreLazy("AuthenticationStore") as any)?.getToken?.();
            if (token) {
                const res = await fetch("https://discord.com/api/v9/users/@me?with_analytics_token=true", {
                    headers: {
                        authorization: token,
                        "user-agent": USER_AGENT
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.analytics_token) {
                        this.analyticsToken = data.analytics_token;
                        this.analyticsTokenFetchedAt = Date.now();
                        return this.analyticsToken;
                    }
                }
            }
        } catch (err) {
            logger.error("Failed to fetch analytics token:", err);
        }

        return this.analyticsToken;
    }

    private buildSuperProps(launchSig: string, heartbeatSession: string): string {
        const globalEnv = (typeof window !== "undefined" && (window as any).GLOBAL_ENV) || {};
        const releaseChannel = globalEnv.RELEASE_CHANNEL || "stable";
        const clientVersion = globalEnv.VERSION || CLIENT_VERSION;
        const clientBuildNumber = Number(globalEnv.BUILD_NUMBER) || CLIENT_BUILD_NUMBER;

        const props = {
            os: "Windows",
            browser: "Discord Client",
            release_channel: releaseChannel,
            client_version: clientVersion,
            os_version: OS_VERSION,
            os_arch: "x64",
            app_arch: "x64",
            system_locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
            has_client_mods: false,
            browser_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : USER_AGENT,
            browser_version: "42.7.1",
            os_sdk_version: "26200",
            client_build_number: clientBuildNumber,
            native_build_number: NATIVE_BUILD_NUMBER,
            client_event_source: null,
            client_app_state: "focused",
            client_launch_id: crypto.randomUUID(),
            launch_signature: launchSig,
            client_heartbeat_session_id: heartbeatSession,
        };

        const jsonStr = JSON.stringify(props);
        return typeof btoa !== "undefined" ? btoa(jsonStr) : Buffer.from(jsonStr).toString("base64");
    }

    private createSession(): SessionInfo {
        const heartbeatSession = crypto.randomUUID();
        const launchSignature = crypto.randomUUID();
        const superProps = this.buildSuperProps(launchSignature, heartbeatSession);
        return { heartbeatSession, launchSignature, superProps };
    }

    private buildLaunchEvent(game: Game, session: SessionInfo, seq: number, fingerprint?: string) {
        const now = Date.now();
        const props: Record<string, any> = {
            client_track_timestamp: now,
            client_heartbeat_session_id: session.heartbeatSession,
            event_sequence_number: seq,
            game: game.name,
            game_id: game.id,
            verified: true,
            elevated: false,
            is_launcher: false,
            game_platform: "desktop",
            detection_method: "verified_game",
            is_overlay_enabled: false,
            is_overlay_game_enabled: true,
            is_overlay_game_source: "OOP_DEFAULT_DATABASE",
            fullscreen_type: "UNKNOWN",
            hardware_display_count: 1,
            overlay_method: "Disabled",
            activity_status_enabled: true,
            activity_status_shared_guilds: [],
            current_user_status: "online",
            game_detection_enabled: true,
            executable_path: game.exe,
            voice_channel_id: null,
            voice_channel_type: null,
            voice_channel_bitrate: null,
            voice_channel_guild_id: null,
            hidden_by_distributor: false,
            game_metadata: null,
            client_performance_cpu: null,
            client_performance_memory: null,
            cpu_core_count: null,
            accessibility_features: 0,
            rendered_locale: "en-US",
            launch_signature: session.launchSignature,
            client_rtc_state: null,
            client_app_state: "focused",
            client_send_timestamp: now,
        };

        if (fingerprint) {
            props.executable_fingerprint = fingerprint;
        }

        return { type: "launch_game", properties: props };
    }

    private buildHeartbeatEvent(
        game: Game,
        durationMs: number,
        gameSessionId: string,
        initial: boolean,
        final: boolean,
        session: SessionInfo,
        seq: number,
        ts?: number,
        rtcId: string | null = null,
        mediaId: string | null = null
    ) {
        const timestamp = ts ?? Date.now();
        return {
            type: "running_game_heartbeat",
            properties: {
                client_track_timestamp: timestamp,
                client_heartbeat_session_id: session.heartbeatSession,
                event_sequence_number: seq,
                game_id: game.id,
                game_name: game.name,
                game_metadata: null,
                game_executable: game.exe,
                game_detection_enabled: true,
                initial_heartbeat: initial,
                final_heartbeat: final,
                game_session_id: gameSessionId,
                duration_tracked_ms: durationMs,
                rtc_connection_id: rtcId,
                media_session_id: mediaId,
                launch_signature: session.launchSignature,
                client_app_state: "focused",
                client_send_timestamp: timestamp,
            }
        };
    }

    private buildGameAndStreamSessionEvents(
        game: Game,
        playDurationMs: number,
        streamDurationMs: number,
        session: SessionInfo,
        getSeq: () => number,
        fingerprint?: string,
        userId?: string
    ) {
        const gameSessionId = crypto.randomUUID();
        const mediaSessionId = streamDurationMs > 0 ? crypto.randomUUID() : null;
        const rtcConnectionId = streamDurationMs > 0 ? crypto.randomUUID() : null;
        const now = Date.now();
        const maxDuration = Math.max(playDurationMs, streamDurationMs);
        const startTime = Math.max(0, now - maxDuration);
        const numFrames = streamDurationMs > 0 ? Math.max(100, Math.floor((streamDurationMs / 1000) * 60)) : 0;

        const events: any[] = [];

        // 1. Initial game heartbeat (0ms)
        events.push(
            this.buildHeartbeatEvent(game, 0, gameSessionId, true, false, session, getSeq(), startTime, rtcConnectionId, mediaSessionId)
        );

        // 2. Launch game event
        events.push(
            this.buildLaunchEvent(game, session, getSeq(), fingerprint)
        );

        // 3. If streaming hours are included, emit video_stream_started with broadcast properties
        if (streamDurationMs > 0 && mediaSessionId && rtcConnectionId) {
            events.push({
                type: "video_stream_started",
                properties: {
                    client_track_timestamp: startTime + 100,
                    client_heartbeat_session_id: session.heartbeatSession,
                    event_sequence_number: getSeq(),
                    media_session_id: mediaSessionId,
                    rtc_connection_id: rtcConnectionId,
                    channel_type: 2,
                    context: "stream",
                    activity: game.name,
                    application_id: game.id,
                    is_owner: true,
                    max_viewers: 3,
                    num_viewers: 2,
                    desktop_capturer_type: "screen",
                    app_hardware_acceleration_enabled: true,
                    hardware_enabled: true,
                    soundshare_session: crypto.randomUUID(),
                    sender_user_id: userId ?? null,
                    client_send_timestamp: startTime + 100
                }
            });
        }

        // 4. Final game heartbeat (full play duration)
        events.push(
            this.buildHeartbeatEvent(game, playDurationMs, gameSessionId, false, true, session, getSeq(), now, rtcConnectionId, mediaSessionId)
        );

        // 5. If streaming hours are included, emit video_stream_ended with complete realistic WebRTC stream metrics
        if (streamDurationMs > 0 && mediaSessionId && rtcConnectionId) {
            const bytesSent = Math.floor(streamDurationMs * 562.5); // ~4.5 Mbps stream
            const packetsSent = Math.floor((streamDurationMs / 1000) * 350);

            events.push({
                type: "video_stream_ended",
                properties: {
                    client_track_timestamp: now,
                    client_heartbeat_session_id: session.heartbeatSession,
                    event_sequence_number: getSeq(),
                    media_session_id: mediaSessionId,
                    rtc_connection_id: rtcConnectionId,
                    duration: streamDurationMs,
                    duration_streamed_ms: streamDurationMs,
                    num_frames: numFrames,
                    resolution_width: 1920,
                    resolution_height: 1080,
                    fps: 60,
                    target_fps: 60,
                    min_fps: 58,
                    max_fps: 60,
                    codec: "H264",
                    audio_codec: "opus",
                    audio_bitrate: 128000,
                    video_bitrate: 4500000,
                    bytes_sent: bytesSent,
                    packets_sent: packetsSent,
                    packets_lost: 0,
                    channel_type: 2,
                    context: "stream",
                    max_viewers: 3,
                    num_viewers: 2,
                    average_viewers: 2.2,
                    reason: "user_ended",
                    activity: game.name,
                    application_id: game.id,
                    desktop_capturer_type: "screen",
                    app_hardware_acceleration_enabled: true,
                    hardware_enabled: true,
                    sender_user_id: userId ?? null,
                    client_send_timestamp: now
                }
            });
        }

        return events;
    }

    private async postEvents(events: any[], analyticsToken: string, session: SessionInfo): Promise<number> {
        const payload = {
            token: analyticsToken,
            events
        };

        try {
            if (typeof VencordNative !== "undefined" && VencordNative.privacy?.postScienceEvents) {
                const res = await VencordNative.privacy.postScienceEvents(payload, undefined, undefined, session.superProps);
                if (res && typeof res.status === "number" && res.status > 0) {
                    return res.status;
                }
            }
        } catch { }

        try {
            const res = await RestAPI.post({
                url: SCIENCE_URL,
                body: payload
            });
            return res?.status || (res?.ok ? 204 : 0);
        } catch (err: any) {
            if (err?.status) return err.status;
        }

        try {
            const token = (AuthenticationStore as any)?.getToken?.() || (findStoreLazy("AuthenticationStore") as any)?.getToken?.();
            const res = await fetch("https://discord.com/api/v9/science?source=badge_spoofer", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: token || "",
                    "x-super-properties": session.superProps,
                    "x-badge-spoofer": "1"
                },
                body: JSON.stringify(payload)
            });
            return res.status;
        } catch (e: any) {
            logger.error("Error posting science batch:", e);
            return 0;
        }
    }

    private selectGames(allGames: Game[], count: number): Game[] {
        const availableIds = new Set(allGames.map(g => g.id));
        const unusedIds = allGames.map(g => g.id).filter(id => !this.stats.usedGames.includes(id));
        const usedIds = this.stats.usedGames.filter(id => availableIds.has(id));

        let selectedIds: string[] = [];
        if (unusedIds.length >= count) {
            selectedIds = unusedIds.slice(0, count);
        } else {
            selectedIds = [...unusedIds];
            const remaining = count - selectedIds.length;
            if (usedIds.length > 0) {
                const rotated = [...usedIds.slice(remaining), ...usedIds.slice(0, remaining)];
                selectedIds.push(...rotated.slice(0, remaining));
            }
        }

        this.stats.usedGames = [
            ...this.stats.usedGames.filter(id => !selectedIds.includes(id)),
            ...selectedIds
        ];

        const idMap = new Map(allGames.map(g => [g.id, g]));
        return selectedIds.map(id => idMap.get(id)!).filter(Boolean);
    }

    public async startSpoofing(options: SpoofOptions): Promise<void> {
        if (this.isRunning) {
            options.onLog?.({
                id: Math.random().toString(36).substring(2, 9),
                timestamp: Date.now(),
                type: "warn",
                message: "Spoofer is already running."
            });
            return;
        }

        this.isRunning = true;
        this.abortController = new AbortController();

        const log = (type: "info" | "success" | "warn" | "error", message: string) => {
            options.onLog?.({
                id: Math.random().toString(36).substring(2, 9),
                timestamp: Date.now(),
                type,
                message
            });
        };

        log("info", "Initializing Discord Badge Spoofer (Games, Playtime & Streaming)...");

        const allGames = await this.loadGames();
        if (allGames.length === 0) {
            log("error", "Could not load games database from Discord CDN. Check network connection.");
            this.isRunning = false;
            return;
        }

        log("info", `Loaded ${allGames.length} detectable games from Discord database.`);

        const analyticsToken = await this.getAnalyticsToken();
        if (!analyticsToken) {
            log("error", "Could not retrieve Discord analytics_token. Are you logged in?");
            this.isRunning = false;
            return;
        }

        log("success", "Analytics token ready.");

        const targetCount = Math.min(Math.max(1, options.count || allGames.length), allGames.length);
        const hours = Math.max(0, options.hours || 0);
        const streamHours = Math.max(0, options.streamHours || 0);
        const playDurationMs = Math.floor(hours * 3600 * 1000);
        const streamDurationMs = Math.floor(streamHours * 3600 * 1000);
        const batchSize = Math.max(1, options.batchSize || 50);
        const batchDelay = Math.max(100, options.batchDelay || 300);
        const fingerprint = options.fingerprint || this.stats.fingerprint || undefined;
        const currentUserId = UserStore?.getCurrentUser?.()?.id;

        const selectedGames = this.selectGames(allGames, targetCount);
        const session = this.createSession();
        let seq = 0;
        const getSeq = () => ++seq;

        const totalBatches = Math.ceil(selectedGames.length / batchSize);
        let sentGamesCount = 0;

        log("info", `Targeting ${selectedGames.length} games: ${hours}h play each (${(selectedGames.length * hours).toLocaleString()}h), ${streamHours}h stream each (${(selectedGames.length * streamHours).toLocaleString()}h) in ${totalBatches} batches.`);

        options.onProgress?.({
            total: selectedGames.length,
            sent: 0,
            hours,
            streamHours,
            currentBatch: 0,
            totalBatches,
            isRunning: true,
            status: `Starting 0/${selectedGames.length}...`
        });

        for (let i = 0; i < selectedGames.length; i += batchSize) {
            if (this.abortController.signal.aborted) {
                log("warn", "Spoofing cancelled by user.");
                break;
            }

            const batchIndex = Math.floor(i / batchSize) + 1;
            const chunk = selectedGames.slice(i, i + batchSize);
            const events: any[] = [];

            for (const game of chunk) {
                events.push(...this.buildGameAndStreamSessionEvents(
                    game,
                    playDurationMs,
                    streamDurationMs,
                    session,
                    getSeq,
                    fingerprint,
                    currentUserId
                ));
            }

            const status = await this.postEvents(events, analyticsToken, session);

            if (status === 204 || (status >= 200 && status < 300)) {
                sentGamesCount += chunk.length;
                this.stats.totalGamesClaimed += chunk.length;
                this.stats.totalHoursClaimed += chunk.length * hours;
                this.stats.totalStreamHoursClaimed += chunk.length * streamHours;
                await this.saveStats();

                log("success", `Batch ${batchIndex}/${totalBatches} accepted [204 OK] (${sentGamesCount}/${selectedGames.length} games, ${hours}h play, ${streamHours}h stream)`);
            } else if (status === 401 || status === 403) {
                log("error", `Batch ${batchIndex} auth rejected [${status}]. Refreshing analytics token...`);
                await this.getAnalyticsToken(true);
                break;
            } else if (status === 429) {
                log("warn", `Rate limited [429] on batch ${batchIndex}. Backing off 2.5s...`);
                await new Promise(r => setTimeout(r, 2500));
            } else {
                log("warn", `Batch ${batchIndex} returned status [${status}].`);
            }

            options.onProgress?.({
                total: selectedGames.length,
                sent: sentGamesCount,
                hours,
                streamHours,
                currentBatch: batchIndex,
                totalBatches,
                isRunning: true,
                status: `Sent ${sentGamesCount}/${selectedGames.length} games`
            });

            await new Promise(r => setTimeout(r, batchDelay));
        }

        this.isRunning = false;
        options.onProgress?.({
            total: selectedGames.length,
            sent: sentGamesCount,
            hours,
            streamHours,
            currentBatch: totalBatches,
            totalBatches,
            isRunning: false,
            status: `Completed: ${sentGamesCount} games claimed.`
        });

        log("success", `Done! Successfully spoofed ${sentGamesCount} games (${(sentGamesCount * hours).toLocaleString()}h play, ${(sentGamesCount * streamHours).toLocaleString()}h stream). Discord badges update in 1-2 days.`);
    }

    public stopSpoofing() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.isRunning = false;
    }
}

export const badgeSpooferEngine = BadgeSpooferEngine.getInstance();
