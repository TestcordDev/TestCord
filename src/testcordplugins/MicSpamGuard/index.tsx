/* eslint-disable simple-header/header -- This standalone user plugin is MIT licensed. */
/*
 * MicSpamGuard
 * Copyright (c) 2026 Kurtzon Audio
 * Copyright (c) 2026 DavidHiFi
 * SPDX-License-Identifier: MIT
 *
 * Rebuilt on the media engine stats the desktop client actually provides,
 * with snap settings, a user area button, a dynamic user volume mode and
 * a live panel that follows voice channel membership.
 */

import { DataStore } from "@api/index";
import NotificationComponent from "@api/Notifications/NotificationComponent";
import { persistNotification } from "@api/Notifications/notificationLog";
import { plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { openPluginModal } from "@components/settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { Button, lodash, MediaEngineStore, React, ReactDOM, RelationshipStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import { VolumeHold } from "./protection";

const logger = new Logger("MicSpamGuard");

const IGNORED_KEY = "MicSpamGuard_ignored";
const HELD_KEY = "MicSpamGuard_held_volumes";
const BALANCE_VERSION_KEY = "MicSpamGuard_balance_v2";
const POLL_MS = 100;
const STALE_MS = 3000;
const TRIGGER_COOLDOWN_MS = 3000;
const LEVEL_FLOOR_DB = -45;
const SPEECH_HOLD_MS = 1500;
const AUTO_RATIO = 2;
const AUTO_CEILING = 200;
const AUTO_GATE_DB = -48;
const VOLUME_DEADBAND = 0.05;
const PERSIST_DEBOUNCE_MS = 1000;
const NOTICE_LIFETIME_MS = 3000;

const MIC_GUARD_KEYS = ["enabled"] as const;

interface VoiceStats {
    rtp?: { inbound?: Record<string, unknown> | unknown[]; };
}

interface VoiceConnection {
    context: string;
    emitter?: {
        on?: (event: string, handler: (payload: VoiceStats) => void) => void;
        off?: (event: string, handler: (payload: VoiceStats) => void) => void;
    };
    localMutes?: Record<string, boolean>;
    getUserIdBySsrc?: (ssrc: number) => string | null;
}

interface InboundSample {
    userId: string;
    entry: Record<string, unknown>;
}

interface TurnedDown {
    base: number;
    volume: number;
    applied: number;
    at: number;
    gainDb: number;
    inputDb: number;
    sampleAt: number;
    speechAt: number;
    speechMs: number;
    noticeAt?: number;
    noticeDirection?: number;
    noticeVolume?: number;
}

const levels = new Map<string, number>();
const levelAt = new Map<string, number>();
const loudAt = new Map<string, number[]>();
const lastTriggerAt = new Map<string, number>();
const mutedByUs = new Map<string, number>();
const volumeHolds = new Map<string, VolumeHold>();
const turnedDown = new Map<string, TurnedDown>();
const ignored = new Set<string>();
const savedVolume = new Map<string, number>();
const pausedDynamics = new Set<string>();

const { setLocalVolume } = findByPropsLazy("setLocalVolume");
const volumeToAmplitude: (volume: number) => number = findByCodeLazy(/Math\.pow\([^,]+,\s*2\.8\)/);
const amplitudeToVolume: (volume: number) => number = findByCodeLazy("Math.log10", "35714285714285715");

let connection: VoiceConnection | null = null;
let boundConnection: VoiceConnection | null = null;
let intervalId: ReturnType<typeof setInterval> | undefined;
let persistQueue = Promise.resolve();
let heldWrite: { (): void; flush(): void; } | undefined;

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Protect the call from extreme loudness and balance voice volumes.",
        default: true,
        onChange() {
            if (!settings.store.enabled) {
                clearNotices();
                unmuteAll("silent");
                restoreAll("silent");
            }
        }
    },
    autoMute: {
        type: OptionType.BOOLEAN,
        displayName: "Extreme loudness protection",
        description: "Temporarily mute sustained extreme loudness. Works alongside dynamic volume.",
        default: true,
        onChange(on: boolean) {
            loudAt.clear();
            if (!on) unmuteAll("silent");
        }
    },
    threshold: {
        type: OptionType.SLIDER,
        displayName: "Extreme loudness threshold",
        description: "Only levels above this point can trigger a mute. Higher means more extreme. Everyday loud voices are handled by dynamic volume.",
        hidden: () => !settings.store.autoMute,
        markers: makeRange(90, 100, 1),
        default: 98,
        stickToMarkers: true,
        onChange() {
            loudAt.clear();
        }
    },
    sensitivity: {
        type: OptionType.SLIDER,
        displayName: "Mute sensitivity",
        description: "Higher reacts sooner. Lower requires more consecutive extreme samples. A normal or quiet sample resets the count.",
        hidden: () => !settings.store.autoMute,
        markers: makeRange(1, 10, 1),
        default: 5,
        stickToMarkers: true,
        onChange() {
            loudAt.clear();
        }
    },
    autoUnmute: {
        type: OptionType.SELECT,
        displayName: "Auto unmute",
        description: "How long quiet audio or inactivity must continue before volume returns smoothly to 100%. New loud audio cancels recovery. Off requires manual restore.",
        hidden: () => !settings.store.autoMute,
        options: [
            { label: "Off (stay muted)", value: 0 },
            { label: "3 seconds", value: 3 },
            { label: "5 seconds", value: 5 },
            { label: "10 seconds", value: 10, default: true },
            { label: "30 seconds", value: 30 },
            { label: "1 minute", value: 60 },
            { label: "2 minutes", value: 120 },
            { label: "5 minutes", value: 300 }
        ]
    },
    dynamicUserVolume: {
        type: OptionType.BOOLEAN,
        description: "Automatically turn loud people down and quiet people up. Volumes change smoothly and return to your manual settings during silence.",
        default: false,
        onChange(on: boolean) {
            pausedDynamics.clear();
            if (!on) restoreAll("silent");
        }
    },
    dynamicTarget: {
        type: OptionType.SLIDER,
        displayName: "Voice level",
        description: "Desired voice level on the meter. Higher keeps voices louder; lower reduces them more. Start at 65.",
        hidden: () => !settings.store.dynamicUserVolume,
        markers: makeRange(55, 75, 5),
        default: 65,
        stickToMarkers: true
    },
    dynamicMaxReduction: {
        type: OptionType.SLIDER,
        displayName: "Maximum volume reduction",
        description: "Limit how far loud voices can turn down from your manual volume. 6 is mild, 12 is moderate, 18 is strong.",
        hidden: () => !settings.store.dynamicUserVolume,
        markers: makeRange(3, 18, 3),
        default: 12,
        stickToMarkers: true
    },
    dynamicMaxBoost: {
        type: OptionType.SLIDER,
        displayName: "Maximum quiet voice boost",
        description: "Limit how much quiet voices turn up. 6 allows about twice the gain, with a 200% slider ceiling. 0 disables boosting.",
        hidden: () => !settings.store.dynamicUserVolume,
        markers: makeRange(0, 12, 3),
        default: 6,
        stickToMarkers: true
    },
    dynamicResponse: {
        type: OptionType.SELECT,
        displayName: "Response speed",
        description: "How smoothly volume changes after a voice sample arrives. Balanced is recommended. Discord's incoming samples still limit reaction time.",
        hidden: () => !settings.store.dynamicUserVolume,
        options: [
            { label: "Fast", value: 150 },
            { label: "Balanced", value: 250, default: true },
            { label: "Gentle", value: 400 }
        ]
    },
    ignoreFriends: {
        type: OptionType.BOOLEAN,
        description: "Exclude friends from muting and automatic volume changes.",
        default: true
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show one live activity card and keep actions in notification history.",
        default: true,
        onChange(on: boolean) { if (!on) clearNotices(); }
    },
    notificationMode: {
        type: OptionType.SELECT,
        displayName: "Notification detail",
        description: "Standard shows mutes and restores. Verbose adds balancing changes and explains each action.",
        hidden: () => !settings.store.notify,
        onChange() { clearNotices(); },
        options: [
            { label: "Standard", value: "standard", default: true },
            { label: "Verbose", value: "verbose" }
        ]
    }
});

function displayName(userId: string) {
    const user = UserStore.getUser(userId);
    return user?.globalName ?? user?.username ?? userId;
}

interface GuardNoticeItem { key: string; body: string; warning: boolean; at: number; }
let noticeItems: GuardNoticeItem[] = [];
let noticeChannelId: string | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const noticeSubscribers = new Set<() => void>();

function publishNotices() {
    for (const listener of noticeSubscribers) listener();
}

function clearNotices() {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    noticeTimer = undefined;
    noticeChannelId = null;
    noticeItems = [];
    publishNotices();
}

function expireNotices() {
    if (noticeChannelId !== SelectedChannelStore.getVoiceChannelId()) { clearNotices(); return; }
    const now = Date.now();
    noticeItems = noticeItems.filter(item => now - item.at < NOTICE_LIFETIME_MS);
    publishNotices();
    scheduleNoticeExpiry();
}

function scheduleNoticeExpiry() {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    noticeTimer = noticeItems.length
        ? setTimeout(expireNotices, Math.max(1, noticeItems[0].at + NOTICE_LIFETIME_MS - Date.now()))
        : undefined;
}

function subscribeNotices(listener: () => void) {
    noticeSubscribers.add(listener);
    return () => { noticeSubscribers.delete(listener); };
}

function noticeSnapshot() { return noticeItems; }

function GuardNotice() {
    const items = React.useSyncExternalStore(subscribeNotices, noticeSnapshot, noticeSnapshot);
    if (!items.length) return null;
    return ReactDOM.createPortal(
        <NotificationComponent title="MicSpamGuard" body={items.map(item => item.body).join("\n")}
            richBody={<div>{items.map(item => <p key={item.key} className="vc-notification-p">{item.body}</p>)}</div>}
            color={items.some(item => item.warning) ? "#f9e2af" : "#a6e3a1"}
            permanent onClose={clearNotices} />,
        document.body
    );
}

function notifyAction(message: string, options: { warning?: boolean; verboseOnly?: boolean; details?: string; userId?: string; } = {}) {
    if (!settings.store.notify) return;
    const verbose = settings.store.notificationMode === "verbose";
    if (options.verboseOnly && !verbose) return;
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId || (options.userId && !currentVoiceMembers().includes(options.userId))) return;
    if (noticeChannelId !== channelId) clearNotices();
    noticeChannelId = channelId;
    const body = verbose && options.details ? `${message} ${options.details}` : message;
    const now = Date.now();
    const key = options.userId ?? "guard";
    noticeItems = [...noticeItems.filter(item => item.key !== key && now - item.at < NOTICE_LIFETIME_MS),
        { key, body, warning: !!options.warning, at: now }].slice(-3);
    publishNotices();
    scheduleNoticeExpiry();
    void persistNotification({ title: "MicSpamGuard", body, color: options.warning ? "#f9e2af" : "#a6e3a1" });
}

function formatDuration(seconds: number) {
    if (seconds % 60 === 0) {
        const minutes = seconds / 60;
        return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }

    return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function isIgnored(userId: string) {
    if (ignored.has(userId)) return true;
    if (UserStore.getCurrentUser()?.id === userId) return true;

    const user = UserStore.getUser(userId);
    if (user?.bot) return true;

    return settings.store.ignoreFriends && RelationshipStore.isFriend(userId);
}

function isLocalMuted(userId: string) {
    return connection?.localMutes?.[userId] ?? MediaEngineStore.isLocalMute(userId);
}

function currentVoiceMembers(): string[] {
    try {
        const channelId = SelectedChannelStore.getVoiceChannelId();
        if (!channelId) return [];
        return Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {});
    } catch (e) {
        logger.error("failed to read voice channel members", e);
        return [];
    }
}

function dynamicGain(entry: TurnedDown, now: number) {
    if (now - entry.speechAt > SPEECH_HOLD_MS || now - entry.sampleAt >= STALE_MS) return 0;

    const targetDb = LEVEL_FLOOR_DB + settings.store.dynamicTarget * (-LEVEL_FLOOR_DB / 100);
    const outputDb = entry.inputDb + 20 * Math.log10(entry.base / 100);
    const errorDb = targetDb - outputDb;
    const ratio = AUTO_RATIO;
    const kneeDb = 6;
    let gainDb: number;
    if (errorDb < -kneeDb / 2) gainDb = errorDb * (1 - 1 / ratio);
    else if (errorDb < kneeDb / 2) gainDb = -(1 - 1 / ratio) * Math.pow(kneeDb / 2 - errorDb, 2) / (2 * kneeDb);
    else gainDb = entry.speechMs >= 750 ? (errorDb - kneeDb / 2) * 0.75 : 0;

    const floor = Math.min(entry.base, volumeToAmplitude(5));
    const minGain = Math.max(-settings.store.dynamicMaxReduction, floor > 0 ? 20 * Math.log10(floor / entry.base) : -Infinity);
    const ceiling = Math.max(entry.base, volumeToAmplitude(AUTO_CEILING));
    const maxGain = Math.min(settings.store.dynamicMaxBoost, 20 * Math.log10(ceiling / entry.base));
    return Math.max(minGain, Math.min(maxGain, gainDb));
}

function getConnection(): VoiceConnection | null {
    const engine = MediaEngineStore.getMediaEngine();
    if (!engine?.connections) return null;

    for (const conn of engine.connections as Iterable<VoiceConnection>) {
        if (conn?.context === "default") return conn;
    }

    return null;
}

function toPercent(level: number) {
    if (!Number.isFinite(level) || level <= 0) return 0;

    const db = 20 * Math.log10(Math.min(level, 1));
    return Math.max(0, Math.min(100, Math.round(((db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB) * 100)));
}

function readInbound(payload: VoiceStats): InboundSample[] {
    const inbound = payload?.rtp?.inbound;
    if (!inbound || typeof inbound !== "object") return [];

    const members = new Set(currentVoiceMembers());
    const samples: InboundSample[] = [];
    const add = (key: unknown, value: unknown) => {
        const entries = Array.isArray(value) ? value : [value];
        for (const value of entries) {
            if (!value || typeof value !== "object") continue;
            const entry = value as Record<string, unknown>;
            if (entry.type === "outbound-rtp" || entry.direction === "outbound") continue;
            if ([entry.userId, entry.user_id].some(id => id != null && (typeof id !== "string" || id.length === 0))) continue;
            const keyed = typeof key === "string" && members.has(key) ? key : null;
            const explicit = [entry.userId, entry.user_id].filter(id => typeof id === "string" && id.length > 0) as string[];
            const ssrc = entry.ssrc == null ? NaN : Number(entry.ssrc);
            let mapped: string | null = null;
            if (Number.isInteger(ssrc) && ssrc >= 0 && ssrc <= 0xFFFFFFFF) {
                try {
                    mapped = connection?.getUserIdBySsrc?.(ssrc) ?? null;
                } catch {
                    // A failed identity lookup must never become a guessed volume target.
                    continue;
                }
            }
            if (mapped != null && typeof mapped !== "string") continue;
            const identities = [keyed, mapped, ...explicit].filter((id): id is string => typeof id === "string" && id.length > 0);
            if (!identities.length || new Set(identities).size !== 1) continue;
            const userId = identities[0];
            if (!members.has(userId) || userId === UserStore.getCurrentUser()?.id) continue;
            samples.push({ userId, entry });
        }
    };

    if (Array.isArray(inbound)) {
        for (const entry of inbound) add(null, entry);
    } else {
        for (const [key, value] of Object.entries(inbound)) add(key, value);
    }

    return samples;
}

function updateProtection(now: number) {
    for (const [userId, hold] of [...volumeHolds]) {
        const current = MediaEngineStore.getLocalVolume(userId);
        if (Math.abs(current - hold.applied) >= 0.5) {
            volumeHolds.delete(userId);
            mutedByUs.delete(userId);
            savedVolume.delete(userId);
            persistHeld();
            continue;
        }
        const next = hold.tick(now, settings.store.autoUnmute * 1000);
        if (next.done) {
            unmute(userId, "auto");
        } else if (next.volume !== hold.applied) {
            hold.applied = next.volume;
            setLocalVolume(userId, next.volume);
        }
    }
}

function mute(userId: string, level: number) {
    if (!settings.store.autoMute) return;
    if (mutedByUs.has(userId) || isLocalMuted(userId)) return;

    restoreVolume(userId, "silent");
    const base = MediaEngineStore.getLocalVolume(userId);
    if (!Number.isFinite(base) || base <= 0) return;
    savedVolume.set(userId, base);
    volumeHolds.set(userId, new VolumeHold(100, Date.now(), 2000, true));
    setLocalVolume(userId, 0);
    mutedByUs.set(userId, Date.now());
    persistHeld();
    logger.debug(`muted ${userId} at ${level}%`);

    notifyAction(`Muted ${displayName(userId)} for extreme loudness.`, {
        warning: true,
        userId,
        details: `Level ${level}%. ${settings.store.autoUnmute > 0 ? "Volume will return to 100% after the quiet interval." : "Auto restore is off; restore manually."}`
    });
}

function unmute(userId: string, mode: "manual" | "auto" | "silent") {
    if (!mutedByUs.delete(userId)) return;

    const hold = volumeHolds.get(userId);
    volumeHolds.delete(userId);
    if (!hold || Math.abs(MediaEngineStore.getLocalVolume(userId) - hold.applied) < 0.5) {
        setLocalVolume(userId, mode === "auto" ? 100 : savedVolume.get(userId) ?? 100);
    }
    savedVolume.delete(userId);
    persistHeld();

    if (mode === "silent" || !settings.store.notify) return;

    notifyAction(mode === "auto"
        ? `Restored ${displayName(userId)} to 100%.`
        : `Unmuted ${displayName(userId)}.`, {
        userId,
        details: mode === "auto" ? `After ${formatDuration(settings.store.autoUnmute)} without loud audio.` : undefined
    });
}

function restoreVolume(userId: string, mode: "manual" | "auto" | "silent") {
    const entry = turnedDown.get(userId);
    if (!entry || !turnedDown.delete(userId)) return;

    const current = MediaEngineStore.getLocalVolume(userId);
    if (Math.abs(current - entry.applied) < 0.5) setLocalVolume(userId, entry.base);
    if (mode === "manual") pausedDynamics.add(userId);
    savedVolume.delete(userId);
    persistHeld();
    logger.debug(`restored ${userId} to ${Math.round(amplitudeToVolume(entry.base))}%`);

    if (mode === "silent" || !settings.store.notify) return;

    notifyAction(`Restored ${displayName(userId)} to ${Math.round(amplitudeToVolume(entry.base))}%.`, { userId, verboseOnly: mode === "auto", details: "Automatic balancing ended after quiet audio." });
}

function restoreAll(mode: "manual" | "silent") {
    for (const userId of [...turnedDown.keys()]) restoreVolume(userId, mode);
}

function updateDynamics(now: number) {
    if (!settings.store.enabled || !settings.store.dynamicUserVolume) return;

    for (const [userId, entry] of [...turnedDown]) {
        if (isIgnored(userId) || isLocalMuted(userId)) {
            restoreVolume(userId, "silent");
            continue;
        }

        const current = MediaEngineStore.getLocalVolume(userId);
        if (Math.abs(current - entry.applied) >= 0.5) {
            if (!Number.isFinite(current) || current <= 0) {
                restoreVolume(userId, "silent");
                continue;
            }
            entry.base = current;
            entry.volume = current;
            entry.applied = current;
            entry.gainDb = 0;
            entry.at = now;
            savedVolume.set(userId, current);
            persistHeld();
            continue;
        }

        const target = dynamicGain(entry, now);
        const dt = Math.min(1000, Math.max(0, now - entry.at));
        const response = settings.store.dynamicResponse;
        const tau = target < 0 && target < entry.gainDb ? response : target > entry.gainDb && target > 0 ? Math.max(1600, response * 6) : Math.max(600, response * 3);
        entry.gainDb += (target - entry.gainDb) * (1 - Math.exp(-dt / tau));
        const floor = Math.min(entry.base, volumeToAmplitude(5));
        const minGain = Math.max(-settings.store.dynamicMaxReduction, floor > 0 ? 20 * Math.log10(floor / entry.base) : -Infinity);
        const maxGain = Math.min(settings.store.dynamicMaxBoost, 20 * Math.log10(Math.max(entry.base, volumeToAmplitude(AUTO_CEILING)) / entry.base));
        entry.gainDb = Math.max(minGain, Math.min(maxGain, entry.gainDb));
        entry.volume = entry.base * Math.pow(10, entry.gainDb / 20);
        entry.at = now;

        const applied = Math.round(entry.volume * 10) / 10;
        const deadband = Math.max(0.5, Math.abs(entry.applied) * VOLUME_DEADBAND);
        if (Math.abs(applied - entry.applied) >= deadband) {
            entry.applied = applied;
            setLocalVolume(userId, applied);
            const slider = Math.round(amplitudeToVolume(applied));
            const baseline = amplitudeToVolume(entry.base);
            const direction = slider < baseline - 5 ? -1 : slider > baseline + 5 ? 1 : 0;
            if (direction && (entry.noticeAt === undefined || now - entry.noticeAt >= 10000)
                && (entry.noticeDirection !== direction || Math.abs(slider - (entry.noticeVolume ?? baseline)) >= 20)) {
                notifyAction(`${direction < 0 ? "Turned down" : "Raised"} ${displayName(userId)} to ${slider}%.`, { userId, warning: direction < 0, verboseOnly: true, details: "Balancing their incoming voice level." });
                entry.noticeAt = now;
                entry.noticeDirection = direction;
                entry.noticeVolume = slider;
            }
        }

        if (now - entry.speechAt > SPEECH_HOLD_MS && Math.abs(entry.gainDb) < 0.05) restoreVolume(userId, "auto");
    }
}

function onStats(payload: VoiceStats) {
    const now = Date.now();
    const { enabled, sensitivity, dynamicUserVolume, autoMute } = settings.store;
    const threshold = Math.max(90, settings.store.threshold);
    const needed = Math.max(1, Math.round((11 - sensitivity) * 0.4));

    const members = new Set(currentVoiceMembers());
    const samples = new Map<string, number>();
    for (const { userId, entry } of readInbound(payload)) {
        if (!members.has(userId) || entry.type === "video" || entry.mediaType === "video" || entry.kind === "video") continue;
        const amplitude = Number(entry.audioLevel);
        if (!Number.isFinite(amplitude) || amplitude < 0) continue;
        samples.set(userId, Math.max(samples.get(userId) ?? 0, Math.min(1, amplitude)));
    }

    for (const [userId, amplitude] of samples) {
        const percent = toPercent(amplitude);
        levels.set(userId, percent);
        levelAt.set(userId, now);

        // A zero reading while held can be post-volume silence. Require safe positive source audio.
        volumeHolds.get(userId)?.observe(percent <= threshold - 10, now);

        if (!enabled) continue;

        if (isIgnored(userId) || isLocalMuted(userId)) continue;
        if (mutedByUs.has(userId)) continue;
        if (autoMute && percent >= threshold && MediaEngineStore.getLocalVolume(userId) > 0) {
            const loud = loudAt.get(userId) ?? [];
            if (loud.length && now - loud[loud.length - 1] >= STALE_MS) loud.length = 0;
            loud.push(now);
            loudAt.set(userId, loud);
            if (loud.length >= needed && now - (lastTriggerAt.get(userId) ?? 0) > TRIGGER_COOLDOWN_MS) {
                loudAt.delete(userId);
                lastTriggerAt.set(userId, now);
                mute(userId, percent);
                continue;
            }
        } else loudAt.delete(userId);

        if (dynamicUserVolume) {
            if (isIgnored(userId) || isLocalMuted(userId) || pausedDynamics.has(userId)) continue;
            const inputDb = amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
            let state = turnedDown.get(userId);
            if (!state && inputDb >= AUTO_GATE_DB) {
                const base = MediaEngineStore.getLocalVolume(userId);
                if (!Number.isFinite(base) || base <= 0) continue;
                state = { base, volume: base, applied: base, at: now, gainDb: 0, inputDb, sampleAt: now, speechAt: now, speechMs: 0 };
                turnedDown.set(userId, state);
                savedVolume.set(userId, base);
                persistHeld();
            }
            if (state) {
                const dt = Math.min(STALE_MS, Math.max(0, now - state.sampleAt));
                if (inputDb >= AUTO_GATE_DB) {
                    state.speechMs = now - state.speechAt < STALE_MS ? state.speechMs + dt : 0;
                    const alpha = 1 - Math.exp(-dt / (inputDb > state.inputDb ? 75 : 200));
                    state.inputDb += (inputDb - state.inputDb) * alpha;
                    state.speechAt = now;
                }
                state.sampleAt = now;
            }

            continue;
        }

    }

    if (dynamicUserVolume) updateDynamics(now);
}

function bindConnection(conn: VoiceConnection | null) {
    if (conn === boundConnection) return;

    clearNotices();
    boundConnection?.emitter?.off?.("stats", onStats);
    unmuteAll("silent");
    restoreAll("silent");
    loudAt.clear();
    levels.clear();
    levelAt.clear();
    pausedDynamics.clear();
    boundConnection = conn;
    conn?.emitter?.on?.("stats", onStats);
}

function poll() {
    try {
        const conn = getConnection();
        connection = conn;
        bindConnection(conn);

        const now = Date.now();
        const members = new Set(currentVoiceMembers());
        if (noticeChannelId && noticeChannelId !== SelectedChannelStore.getVoiceChannelId()) clearNotices();
        for (const userId of [...volumeHolds.keys()]) {
            if (!members.has(userId) || isIgnored(userId) || isLocalMuted(userId)) unmute(userId, "silent");
        }
        for (const userId of [...turnedDown.keys()]) {
            if (!members.has(userId)) restoreVolume(userId, "silent");
        }
        for (const userId of [...pausedDynamics]) if (!members.has(userId)) pausedDynamics.delete(userId);
        for (const userId of [...levels.keys()]) {
            if (!members.has(userId)) {
                levels.delete(userId);
                levelAt.delete(userId);
                loudAt.delete(userId);
                lastTriggerAt.delete(userId);
            } else if (now - (levelAt.get(userId) ?? 0) >= STALE_MS) {
                levels.set(userId, 0);
            }
        }

        updateDynamics(now);

        updateProtection(now);
    } catch (e) {
        logger.error("poll failed", e);
    }
}

function persistHeld() {
    heldWrite ??= lodash.debounce(() => {
        const held = Object.fromEntries(savedVolume);
        persistQueue = persistQueue.then(() => DataStore.set(HELD_KEY, held)).catch(e => logger.error("failed to save held volumes", e));
    }, PERSIST_DEBOUNCE_MS);
    heldWrite();
}

async function saveIgnored() {
    try {
        await DataStore.set(IGNORED_KEY, [...ignored]);
    } catch (e) {
        logger.error("failed to save the ignore list", e);
    }
}

function toggleIgnored(userId: string) {
    if (!ignored.delete(userId)) ignored.add(userId);
    if (isIgnored(userId)) {
        restoreVolume(userId, "silent");
        unmute(userId, "silent");
    }
    void saveIgnored();
}

function unmuteAll(mode: "manual" | "silent" = "manual") {
    for (const userId of [...mutedByUs.keys()]) unmute(userId, mode);
}

function MeterRow({ userId }: { userId: string; }) {
    const level = levels.get(userId) ?? 0;
    const threshold = settings.store.dynamicUserVolume ? settings.store.dynamicTarget : settings.store.threshold;
    const loud = level >= threshold;
    const ignoredUser = isIgnored(userId);
    const muted = mutedByUs.has(userId);
    const turned = turnedDown.has(userId);

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
            <div style={{ width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--header-primary)" }}>
                {displayName(userId)}
            </div>
            <div style={{ position: "relative", flex: 1, height: 10, borderRadius: 5, background: "var(--background-modifier-accent)", overflow: "hidden" }}>
                <div style={{ width: `${level}%`, height: "100%", background: loud ? "var(--status-danger)" : "var(--status-positive)" }} />
                <div style={{ position: "absolute", top: 0, left: `${threshold}%`, width: 2, height: "100%", background: "var(--text-muted)" }} />
            </div>
            <div style={{ width: 68, color: ignoredUser ? "var(--text-muted)" : "var(--header-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {level}%
            </div>
            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => toggleIgnored(userId)}>
                {ignored.has(userId) ? "Allow" : "Ignore"}
            </Button>
            {muted && <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => unmute(userId, "manual")}>Unmute</Button>}
            {turned && <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => restoreVolume(userId, "manual")}>Restore</Button>}
            {pausedDynamics.has(userId) && <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => pausedDynamics.delete(userId)}>Resume</Button>}
        </div>
    );
}

function GuardPanel() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        const id = setInterval(forceUpdate, 250);
        return () => clearInterval(id);
    }, []);

    const live = currentVoiceMembers();

    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ color: "var(--header-primary)", fontWeight: 600, fontSize: 16 }}>Live levels</div>
            <div style={{ color: "var(--header-secondary)", fontSize: 13, marginBottom: 8 }}>
                Voice volumes balance automatically while Dynamic User Volume is on. Restore pauses it for that person until Resume.
            </div>

            {live.length === 0
                ? <div style={{ color: "var(--text-muted)" }}>Join a voice channel to see levels.</div>
                : live.map(userId => <MeterRow key={userId} userId={userId} />)}

            {turnedDown.size > 0 && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ color: "var(--header-primary)", fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Automatic user volumes</div>
                    {[...turnedDown].map(([userId, entry]) => (
                        <div key={userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
                            <span style={{ color: "var(--status-warning)" }}>{displayName(userId)}: {Math.round(amplitudeToVolume(entry.applied))}% volume</span>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => restoreVolume(userId, "manual")}>Restore</Button>
                        </div>
                    ))}
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => restoreAll("manual")} style={{ marginTop: 4 }}>Restore all</Button>
                </div>
            )}

            {mutedByUs.size > 0 && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ color: "var(--header-primary)", fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Muted by the guard</div>
                    {[...mutedByUs.keys()].map(userId => (
                        <div key={userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
                            <span style={{ color: "var(--status-danger)" }}>{displayName(userId)}</span>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => unmute(userId, "manual")}>Unmute</Button>
                        </div>
                    ))}
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => unmuteAll("manual")} style={{ marginTop: 4 }}>Unmute all</Button>
                </div>
            )}

            {ignored.size > 0 && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ color: "var(--header-primary)", fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Never muted</div>
                    {[...ignored].map(userId => (
                        <div key={userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
                            <span>{displayName(userId)}</span>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => toggleIgnored(userId)}>Allow again</Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function MicSpamGuardIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M10 3.2a2.8 2.8 0 0 1 2.8 2.8v5.2a2.8 2.8 0 0 1-5.6 0V6A2.8 2.8 0 0 1 10 3.2Z" fill="currentColor" />
            <path d="M5.4 11.2a4.6 4.6 0 0 0 9.2 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M10 15.9v2.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M7.6 18.6h4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <rect x="16.8" y="13.6" width="1.7" height="5" rx="0.85" fill="currentColor" />
            <rect x="19.3" y="10.9" width="1.7" height="7.7" rx="0.85" fill="currentColor" />
        </svg>
    );
}

function MicSpamGuardButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { enabled } = settings.use(MIC_GUARD_KEYS);

    return (
        <>
        <GuardNotice />
        <UserAreaButton
            icon={<MicSpamGuardIcon className={iconForeground} />}
            tooltipText={hideTooltips ? void 0 : "Mic Spam Guard"}
            aria-label="Mic Spam Guard"
            role="switch"
            aria-checked={enabled}
            redGlow={!enabled}
            plated={nameplate != null}
            onClick={() => openPluginModal(plugins.MicSpamGuard)}
            onContextMenu={event => {
                event.preventDefault();
                settings.store.enabled = !enabled;
                notifyAction(`MicSpamGuard ${settings.store.enabled ? "enabled" : "disabled"}.`);
            }}
        />
        </>
    );
}

export default definePlugin({
    name: "MicSpamGuard",
    description: "Smoothly balances voice volumes and protects the call from sustained extreme loudness.",
    authors: [TestcordDevs.Kurtzon, TestcordDevs.DavidHiFi],
    tags: ["Voice", "Utility"],
    settings,
    settingsAboutComponent: GuardPanel,

    userAreaButton: {
        icon: MicSpamGuardIcon,
        render: MicSpamGuardButton
    },

    async start() {
        try {
            if (!await DataStore.get(BALANCE_VERSION_KEY)) {
                if (settings.store.dynamicMaxReduction > 18) {
                    settings.store.dynamicTarget = 65;
                    settings.store.dynamicMaxReduction = 12;
                    settings.store.dynamicMaxBoost = 6;
                }
                if (settings.store.threshold < 90) settings.store.threshold = 98;
                await DataStore.set(BALANCE_VERSION_KEY, true);
            }
        } catch (e) {
            logger.error("failed to migrate voice balance settings", e);
        }

        try {
            const saved = await DataStore.get(IGNORED_KEY);
            if (Array.isArray(saved)) {
                for (const userId of saved) if (typeof userId === "string") ignored.add(userId);
            }
        } catch (e) {
            logger.error("failed to load the ignore list", e);
        }

        try {
            const held = await DataStore.get(HELD_KEY);
            if (held && typeof held === "object") {
                for (const [userId, volume] of Object.entries(held as Record<string, number>)) {
                    if (typeof volume === "number" && Number.isFinite(volume) && volume >= 0) setLocalVolume(userId, volume);
                }
                await DataStore.del(HELD_KEY);
            }
        } catch (e) {
            logger.error("failed to restore held volumes", e);
        }

        intervalId = setInterval(poll, POLL_MS);
    },

    stop() {
        clearNotices();
        if (intervalId !== undefined) {
            clearInterval(intervalId);
            intervalId = undefined;
        }

        bindConnection(null);
        connection = null;
        loudAt.clear();
        lastTriggerAt.clear();

        for (const userId of [...mutedByUs.keys()]) unmute(userId, "silent");
        mutedByUs.clear();
        restoreAll("silent");
        turnedDown.clear();
        levels.clear();
        levelAt.clear();
        heldWrite?.flush();
    }
});
