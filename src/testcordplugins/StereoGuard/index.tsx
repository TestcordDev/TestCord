/* eslint-disable simple-header/header -- This standalone user plugin is MIT licensed. */
/*
 * StereoGuard
 * Copyright (c) 2026 Kurtzon Audio
 * Copyright (c) 2026 DavidHiFi
 * SPDX-License-Identifier: MIT
 */

import { DataStore } from "@api/index";
import { plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { openPluginModal } from "@components/settings";
import { Logger } from "@utils/Logger";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, MediaEngineStore, React, RelationshipStore, SelectedChannelStore, showToast, Toasts, UserStore, VoiceStateStore } from "@webpack/common";

import { VolumeHold } from "./protection";

const logger = new Logger("StereoGuard");

const IGNORED_KEY = "StereoGuard_ignored";
const HELD_KEY = "StereoGuard_held_volumes";
const POLL_MS = 50;
const SCAN_MS = 500;
const PAN_WINDOW_MS = 4000;
const TRIGGER_COOLDOWN_MS = 3000;
const NOISE_GATE = 0.01;
const RELEASE = 0.3;
// Slow decay so short pauses between words never erase the progress that
// already built up, even when a high certainty count is configured.
const EVIDENCE_DECAY = 0.96;
// Never mute someone within this long of their audio first appearing, so a
// person joining the call is always audible while their stream settles.
const JOIN_GRACE_MS = 1000;
// After the guard lets someone go (auto, by hand, or the owner changing their
// volume), leave them alone for this long instead of holding them again.
const REMUTE_COOLDOWN_MS = 5000;
// A held user counts as safe once their score sits this far under the threshold.
const RELEASE_MARGIN_DB = 6;
// Native participant frames older than this are not evidence of anything.
const NATIVE_MAX_AGE_MS = 150;

const STEREO_GUARD_KEYS = ["enabled"] as const;

interface AudioOutput {
    id: string;
    stream: MediaStream;
}

interface VoiceConnection {
    context: string;
    outputs?: Record<string, AudioOutput>;
    localMutes?: Record<string, boolean>;
    audioContext?: AudioContext;
}

// Decoded left/right levels for one participant, from the native voice bridge
// that VoiceVUMeters installs on Discord Desktop.
interface NativeLevel {
    userId: string;
    ageMs: number;
    channels: number;
    rtpTimestamp: number;
    rmsLeft: number;
    rmsRight: number;
    rmsMid?: number;
    rmsSide?: number;
}

interface ParticipantBridge {
    getParticipantStereoLevels(): { installed: boolean; connection: number; levels: NativeLevel[]; };
}

interface WebTap {
    output: AudioOutput;
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    splitter: ChannelSplitterNode;
    left: AnalyserNode;
    right: AnalyserNode;
    silent: GainNode;
    bufLeft: Float32Array<ArrayBuffer>;
    bufRight: Float32Array<ArrayBuffer>;
}

interface Meter {
    tap?: WebTap;
    mono: boolean;
    score: number;
    pans: number[];
    panAt: number[];
    evidence: number;
    lastTriggerAt: number;
    frameAt: number;
    lastStamp: number;
}

const meters = new Map<string, Meter>();
const meterContexts = new WeakMap<VoiceConnection, AudioContext>();
const mutedByUs = new Map<string, number>();
const volumeHolds = new Map<string, VolumeHold>();
const ignored = new Set<string>();
const savedVolume = new Map<string, number>();
// userId -> when their audio first appeared in the current call
const firstSeen = new Map<string, number>();
// userId -> don't hold before this timestamp (set on any release)
const unmuteCooldownUntil = new Map<string, number>();

const { setLocalVolume } = findByPropsLazy("setLocalVolume");

let connection: VoiceConnection | null = null;
let nativeConnection = 0;
let participantBridge: ParticipantBridge | undefined;
let bridgeChecked = false;
let intervalId: ReturnType<typeof setInterval> | undefined;
let lastScanAt = 0;
let persistQueue = Promise.resolve();

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Watch the call and silence anyone whose audio is not fully mono: slight panning, stereo width, panning around, or reverb tails.",
        default: true,
        onChange() {
            if (!settings.store.enabled) unmuteAll("silent");
        }
    },
    threshold: {
        type: OptionType.SLIDER,
        description: "Silence when the stereo content passes this level, in dB relative to the center. -40 catches even a hint of panning or reverb; -4 only heavy stereo. Lower means stricter. Check the live scores above.",
        markers: makeRange(-40, -4, 3),
        default: -22,
        stickToMarkers: true
    },
    sensitivity: {
        type: OptionType.SLIDER,
        description: "How much non-mono audio is needed before the guard acts. Higher reacts to shorter and quieter bits.",
        markers: makeRange(1, 10, 1),
        default: 7,
        stickToMarkers: true
    },
    autoUnmute: {
        type: OptionType.SELECT,
        description: "How long they have to STAY mono or quiet before their volume returns smoothly. Stereo again restarts the wait. Off keeps them silenced until you restore them.",
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
    ignoreFriends: {
        type: OptionType.BOOLEAN,
        description: "Never mute your friends.",
        default: true
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when the guard mutes, unmutes, or auto-unmutes someone.",
        default: true
    }
});

function toDb(score: number) {
    return score > 0 ? Math.max(-60, 20 * Math.log10(score)) : -60;
}

function fromDb(db: number) {
    return Math.pow(10, db / 20);
}

function displayName(userId: string) {
    const user = UserStore.getUser(userId);
    return user?.globalName ?? user?.username ?? userId;
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

function getConnection(): VoiceConnection | null {
    const engine = MediaEngineStore.getMediaEngine();
    if (!engine?.connections) return null;

    for (const conn of engine.connections as Iterable<VoiceConnection>) {
        if (conn?.context === "default") return conn;
    }

    return null;
}

function isWeb(conn: VoiceConnection | null): conn is VoiceConnection & { outputs: Record<string, AudioOutput>; } {
    return Boolean(conn?.outputs && conn.audioContext);
}

function inCall(userId: string) {
    if (isWeb(connection)) return Boolean(connection.outputs[userId]);

    const channelId = SelectedChannelStore.getVoiceChannelId();
    return Boolean(channelId && VoiceStateStore.getVoiceStatesForChannel(channelId)?.[userId]);
}

function newMeter(mono: boolean, tap?: WebTap): Meter {
    return { tap, mono, score: 0, pans: [], panAt: [], evidence: 0, lastTriggerAt: 0, frameAt: 0, lastStamp: -1 };
}

// Kurtzon's detector. Mid is (L + R) / 2 and side is (L - R) / 2. The score is
// the highest of stereo width, left/right imbalance and pan swing over a
// rolling window, from 0 (centered mono) to 1 (full width or hard pan).
function scoreLevels(meter: Meter, rmsL: number, rmsR: number, midRms: number, sideRms: number, now: number) {
    if (meter.mono) return 0;

    const total = rmsL + rmsR;
    if (total < NOISE_GATE) return 0;

    const pan = (rmsR - rmsL) / total;
    const imbalance = Math.abs(pan);
    const stereo = midRms + sideRms > 0 ? Math.min(1, (sideRms / (midRms + sideRms)) * 2) : 0;

    meter.pans.push(pan);
    meter.panAt.push(now);
    while (meter.panAt.length && now - meter.panAt[0] > PAN_WINDOW_MS) {
        meter.pans.shift();
        meter.panAt.shift();
    }

    let min = 1;
    let max = -1;
    for (const value of meter.pans) {
        if (value < min) min = value;
        if (value > max) max = value;
    }

    const swing = meter.pans.length > 1 ? Math.min(1, (max - min) / 2) : 0;

    return Math.max(stereo, imbalance, swing);
}

// --- Web audio path (browser, Vesktop, Equibop) ---

// Discord closes and replaces its own audio context in some clients, which
// froze every meter. The meters get their own context so they cannot die with
// it, and 48 kHz avoids the stalls on 192 kHz devices.
function getMeterContext(conn: VoiceConnection) {
    let context = meterContexts.get(conn);
    if (!context || context.state === "closed") {
        context = new AudioContext({ sampleRate: 48000 });
        meterContexts.set(conn, context);
    }
    return context;
}

function closeMeterContext(conn: VoiceConnection) {
    const context = meterContexts.get(conn);
    if (context && context.state !== "closed") void context.close();
    meterContexts.delete(conn);
}

function channelCount(output: AudioOutput) {
    return output.stream.getAudioTracks()[0]?.getSettings?.().channelCount ?? 2;
}

function createWebMeter(conn: VoiceConnection & { outputs: Record<string, AudioOutput>; }, userId: string) {
    const output = conn.outputs[userId];
    if (!output?.stream?.getAudioTracks().length) return;

    const context = getMeterContext(conn);
    const source = context.createMediaStreamSource(output.stream);
    const splitter = context.createChannelSplitter(2);
    const left = context.createAnalyser();
    const right = context.createAnalyser();
    left.fftSize = 1024;
    right.fftSize = 1024;
    left.smoothingTimeConstant = 0;
    right.smoothingTimeConstant = 0;

    const silent = context.createGain();
    silent.gain.value = 0;

    source.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    left.connect(silent);
    right.connect(silent);
    silent.connect(context.destination);

    meters.set(userId, newMeter(channelCount(output) === 1, {
        output,
        stream: output.stream,
        source,
        splitter,
        left,
        right,
        silent,
        bufLeft: new Float32Array(left.fftSize),
        bufRight: new Float32Array(right.fftSize)
    }));
}

function dropMeter(userId: string) {
    const meter = meters.get(userId);
    if (!meter) return;

    meters.delete(userId);
    if (!meter.tap) return;

    try {
        meter.tap.source.disconnect();
        meter.tap.splitter.disconnect();
        meter.tap.left.disconnect();
        meter.tap.right.disconnect();
        meter.tap.silent.disconnect();
    } catch (e) {
        logger.error("failed to release a meter", e);
    }
}

function syncWebMeters(conn: VoiceConnection & { outputs: Record<string, AudioOutput>; }, now: number) {
    for (const userId of Object.keys(conn.outputs)) {
        if (!firstSeen.has(userId)) firstSeen.set(userId, now);
        const output = conn.outputs[userId];
        const meter = meters.get(userId);
        // Discord swaps the stream on the same output object after every
        // renegotiation. Rebuild the meter then too, or the guard watches a dead
        // stream while the person keeps talking.
        if (!meter?.tap || meter.tap.output !== output || meter.tap.stream !== output.stream) {
            dropMeter(userId);
            createWebMeter(conn, userId);
        } else {
            meter.mono = channelCount(output) === 1;
        }
    }

    for (const userId of [...meters.keys()]) {
        if (!conn.outputs[userId]) dropMeter(userId);
    }

    for (const userId of [...firstSeen.keys()]) {
        if (!conn.outputs[userId]) firstSeen.delete(userId);
    }
}

function readWeb(meter: Meter, now: number) {
    const tap = meter.tap!;
    tap.left.getFloatTimeDomainData(tap.bufLeft);
    tap.right.getFloatTimeDomainData(tap.bufRight);

    const { length } = tap.bufLeft;
    let sumLL = 0;
    let sumRR = 0;
    let sumMid = 0;
    let sumSide = 0;
    for (let i = 0; i < length; i++) {
        const l = tap.bufLeft[i];
        const r = tap.bufRight[i];
        sumLL += l * l;
        sumRR += r * r;
        sumMid += (l + r) * (l + r) * 0.25;
        sumSide += (l - r) * (l - r) * 0.25;
    }

    meter.frameAt = now;
    return scoreLevels(meter, Math.sqrt(sumLL / length), Math.sqrt(sumRR / length), Math.sqrt(sumMid / length), Math.sqrt(sumSide / length), now);
}

// --- Native path (Discord Desktop) ---

function getBridge() {
    if (!bridgeChecked) {
        bridgeChecked = true;
        try {
            if (typeof DiscordNative !== "undefined") {
                const voice = DiscordNative.nativeModules.requireModule("discord_voice") as Partial<ParticipantBridge>;
                if (typeof voice.getParticipantStereoLevels === "function") participantBridge = voice as ParticipantBridge;
            }
        } catch (e) {
            logger.error("cannot reach the participant PCM bridge", e);
        }
    }
    return participantBridge;
}

function readNative(now: number) {
    const bridge = getBridge();
    if (!bridge) return null;

    const snapshot = bridge.getParticipantStereoLevels();
    if (!snapshot.installed || !snapshot.connection) return null;

    if (snapshot.connection !== nativeConnection) {
        nativeConnection = snapshot.connection;
        for (const userId of [...meters.keys()]) dropMeter(userId);
        firstSeen.clear();
    }

    const me = UserStore.getCurrentUser()?.id;
    const fresh = new Map<string, NativeLevel>();
    for (const level of snapshot.levels) {
        if (level.userId === me || level.ageMs < 0 || level.ageMs > NATIVE_MAX_AGE_MS
            || (level.channels !== 1 && level.channels !== 2)
            || ![level.rmsLeft, level.rmsRight].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) continue;

        fresh.set(level.userId, level);
        if (!firstSeen.has(level.userId)) firstSeen.set(level.userId, now);
        if (!meters.has(level.userId)) meters.set(level.userId, newMeter(level.channels === 1));
    }

    return fresh;
}

function scoreNative(meter: Meter, level: NativeLevel, now: number) {
    meter.mono = level.channels === 1;
    meter.frameAt = now;

    // The addon reports mid and side directly. An older addon without them can
    // still catch panning and pan swing from the channel levels.
    const hasSide = Number.isFinite(level.rmsMid) && Number.isFinite(level.rmsSide);
    return scoreLevels(meter, level.rmsLeft, level.rmsRight, hasSide ? level.rmsMid! : 1, hasSide ? level.rmsSide! : 0, now);
}

function syncNativeMeters() {
    for (const userId of [...meters.keys()]) {
        if (!inCall(userId)) {
            dropMeter(userId);
            firstSeen.delete(userId);
        }
    }
}

// --- Holding ---

function otherGuardHolds(userId: string): boolean {
    return Boolean((plugins.MicSpamGuard as any)?.isHolding?.(userId));
}

function heldBaseline(userId: string): number {
    const other = (plugins.MicSpamGuard as any)?.getHeldBaseline?.(userId);
    return Number.isFinite(other) && other >= 0 ? other : MediaEngineStore.getLocalVolume(userId);
}

function updateProtection(now: number) {
    for (const [userId, hold] of [...volumeHolds]) {
        const current = MediaEngineStore.getLocalVolume(userId);
        if (Math.abs(current - hold.applied) >= 0.5) {
            // The owner changed the volume by hand. Respect it and back off.
            volumeHolds.delete(userId);
            mutedByUs.delete(userId);
            savedVolume.delete(userId);
            unmuteCooldownUntil.set(userId, now + REMUTE_COOLDOWN_MS);
            persistHeld();
            continue;
        }
        const next = hold.tick(now, settings.store.autoUnmute * 1000);
        if (next.done) {
            unmute(userId, "auto");
        } else if (!otherGuardHolds(userId) && next.volume !== hold.applied) {
            hold.applied = next.volume;
            setLocalVolume(userId, next.volume);
        }
    }
}

// Silencing uses the user's local volume, not Discord's local mute, so their
// audio keeps arriving and the guard can tell when they stop.
function mute(userId: string, score: number) {
    if (!settings.store.enabled || isIgnored(userId) || mutedByUs.has(userId) || isLocalMuted(userId)) return;

    const base = heldBaseline(userId);
    if (!Number.isFinite(base) || base <= 0) return;
    savedVolume.set(userId, base);
    volumeHolds.set(userId, new VolumeHold(base, Date.now(), 200));
    setLocalVolume(userId, 0);
    mutedByUs.set(userId, Date.now());
    persistHeld();
    logger.debug(`muted ${userId} at ${Math.round(toDb(score))} dB stereo`);

    if (settings.store.notify) {
        showToast(`StereoGuard muted ${displayName(userId)} for obnoxious stereo (${Math.round(toDb(score))} dB).`, Toasts.Type.MESSAGE);
    }
}

function unmute(userId: string, mode: "manual" | "auto" | "silent") {
    if (!mutedByUs.delete(userId)) return;

    const hold = volumeHolds.get(userId);
    volumeHolds.delete(userId);
    if (!otherGuardHolds(userId) && (!hold || Math.abs(MediaEngineStore.getLocalVolume(userId) - hold.applied) < 0.5)) {
        setLocalVolume(userId, savedVolume.get(userId) ?? 100);
    }
    savedVolume.delete(userId);
    unmuteCooldownUntil.set(userId, Date.now() + REMUTE_COOLDOWN_MS);
    persistHeld();

    if (mode === "silent" || !settings.store.notify) return;

    showToast(
        mode === "auto"
            ? `StereoGuard auto-unmuted ${displayName(userId)} after ${formatDuration(settings.store.autoUnmute)}.`
            : `StereoGuard unmuted ${displayName(userId)}.`,
        Toasts.Type.MESSAGE
    );
}

function sample(userId: string, meter: Meter, raw: number, now: number, needed: number) {
    meter.score = raw >= meter.score ? raw : meter.score + (raw - meter.score) * RELEASE;

    const { threshold } = settings.store;
    volumeHolds.get(userId)?.observe(meter.score < fromDb(threshold - RELEASE_MARGIN_DB), meter.frameAt);

    const coolingDown = (unmuteCooldownUntil.get(userId) ?? 0) > now;
    const settled = now - (firstSeen.get(userId) ?? now) >= JOIN_GRACE_MS;
    const counts = meter.score >= fromDb(threshold) && !isIgnored(userId) && !mutedByUs.has(userId) && !isLocalMuted(userId) && !coolingDown && settled;

    // Evidence builds up over the stereo bits and only decays slowly, so short
    // pauses between words never wipe out progress.
    meter.evidence = counts ? meter.evidence + 1 : meter.evidence * EVIDENCE_DECAY;

    if (meter.evidence >= needed && now - meter.lastTriggerAt > TRIGGER_COOLDOWN_MS) {
        meter.evidence = 0;
        meter.lastTriggerAt = now;
        mute(userId, meter.score);
    }
}

function resetCall() {
    unmuteAll("silent");
    for (const userId of [...meters.keys()]) dropMeter(userId);
    if (connection) closeMeterContext(connection);
    firstSeen.clear();
    nativeConnection = 0;
    lastScanAt = 0;
}

function poll() {
    try {
        const conn = getConnection();
        if (conn !== connection) {
            resetCall();
            connection = conn;
        }

        if (!connection) return;

        const now = Date.now();
        const web = isWeb(connection);
        const native = web ? null : readNative(now);

        if (now - lastScanAt >= SCAN_MS) {
            lastScanAt = now;
            if (web) syncWebMeters(connection as VoiceConnection & { outputs: Record<string, AudioOutput>; }, now);
            else syncNativeMeters();
        }

        for (const userId of [...volumeHolds.keys()]) {
            if (!inCall(userId) || isIgnored(userId) || isLocalMuted(userId)) unmute(userId, "silent");
        }

        const { enabled, sensitivity } = settings.store;
        if (!enabled) return;

        const needed = Math.max(1, 11 - Math.round(sensitivity));
        for (const [userId, meter] of meters) {
            if (meter.tap) {
                sample(userId, meter, readWeb(meter, now), now, needed);
                continue;
            }

            if (!native) continue;
            const level = native.get(userId);
            if (!level) {
                // The bridge is live and this person sends no audio: they are
                // silent, which is as safe as mono.
                meter.score *= 1 - RELEASE;
                meter.evidence *= EVIDENCE_DECAY;
                meter.frameAt = now;
                volumeHolds.get(userId)?.observe(true, now);
                continue;
            }
            // Count each decoded frame once.
            if (level.rtpTimestamp === meter.lastStamp) continue;
            meter.lastStamp = level.rtpTimestamp;
            sample(userId, meter, scoreNative(meter, level, now), now, needed);
        }

        updateProtection(now);
    } catch (e) {
        logger.error("poll failed", e);
    }
}

// The web build's DataStore stub can return promises that never settle, which
// would leave start() (and every plugin after it) waiting forever. Cap the wait.
function storeWithTimeout<T>(p: Promise<T>, ms = 1200): Promise<T | null> {
    return Promise.race([
        p.catch(() => null),
        new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
    ]);
}

function persistHeld() {
    const held = Object.fromEntries(savedVolume);
    persistQueue = persistQueue.then(() => storeWithTimeout(DataStore.set(HELD_KEY, held))).then(() => { }, e => logger.error("failed to save held volumes", e));
}

async function saveIgnored() {
    try {
        await storeWithTimeout(DataStore.set(IGNORED_KEY, [...ignored]));
    } catch (e) {
        logger.error("failed to save the ignore list", e);
    }
}

function toggleIgnored(userId: string) {
    if (!ignored.delete(userId)) ignored.add(userId);
    if (isIgnored(userId)) unmute(userId, "silent");
    void saveIgnored();
}

function unmuteAll(mode: "manual" | "silent" = "manual") {
    for (const userId of [...mutedByUs.keys()]) unmute(userId, mode);
}

function ScoreRow({ userId }: { userId: string; }) {
    const db = toDb(meters.get(userId)?.score ?? 0);
    const { threshold } = settings.store;
    const hot = db >= threshold;
    const ignoredUser = isIgnored(userId);
    const muted = mutedByUs.has(userId);
    const pct = Math.max(0, Math.min(100, (db + 40) / 40 * 100));
    const thresholdPct = Math.max(0, Math.min(100, (threshold + 40) / 40 * 100));

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
            <div style={{ width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--header-primary)" }}>
                {displayName(userId)}
            </div>
            <div style={{ position: "relative", flex: 1, height: 10, borderRadius: 5, background: "var(--background-modifier-accent)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: hot ? "var(--status-danger)" : "var(--status-positive)" }} />
                <div style={{ position: "absolute", top: 0, left: `${thresholdPct}%`, width: 2, height: "100%", background: "var(--text-muted)" }} />
            </div>
            <div style={{ width: 68, color: ignoredUser ? "var(--text-muted)" : "var(--header-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {Math.round(db)} dB
            </div>
            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => toggleIgnored(userId)}>
                {ignored.has(userId) ? "Allow" : "Ignore"}
            </Button>
            {muted && <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => unmute(userId, "manual")}>Unmute</Button>}
        </div>
    );
}

function GuardPanel() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        const id = setInterval(forceUpdate, 250);
        return () => clearInterval(id);
    }, []);

    const live = [...meters.keys()];
    const source = isWeb(connection) ? "Web audio streams" : getBridge() ? "Discord Desktop native participant audio" : null;

    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ color: "var(--header-primary)", fontWeight: 600, fontSize: 16 }}>Live stereo scores</div>
            <div style={{ color: "var(--header-secondary)", fontSize: 13, marginBottom: 8 }}>
                Anything not centered mono shows up here in dB: slight panning, stereo width, panning around, and reverb all push the score up. -40 dB is the faintest stereo, 0 dB is full width. The thin line is your threshold.
            </div>

            {live.length === 0
                ? <div style={{ color: "var(--text-muted)" }}>
                    {source ? "Join a voice channel to see scores." : "No per-participant audio source. On Discord Desktop this needs the VoiceVUMeters native bridge."}
                </div>
                : live.map(userId => <ScoreRow key={userId} userId={userId} />)}

            {source && <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>Source: {source}</div>}

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

function StereoGuardIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="4.4" y="7" width="2.4" height="10" rx="1.2" fill="currentColor" />
            <rect x="17.2" y="7" width="2.4" height="10" rx="1.2" fill="currentColor" />
            <path d="M9.6 12h4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M11 10.1 9.1 12l1.9 1.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13 10.1 14.9 12 13 13.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function StereoGuardButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { enabled } = settings.use(STEREO_GUARD_KEYS);

    return (
        <UserAreaButton
            icon={<StereoGuardIcon className={iconForeground} />}
            tooltipText={hideTooltips ? void 0 : "Stereo Guard"}
            aria-label="Stereo Guard"
            role="switch"
            aria-checked={enabled}
            redGlow={!enabled}
            plated={nameplate != null}
            onClick={() => openPluginModal(plugins.StereoGuard)}
            onContextMenu={event => {
                event.preventDefault();
                settings.store.enabled = !enabled;
                showToast(
                    `Stereo Guard ${settings.store.enabled ? "enabled" : "disabled"}.`,
                    Toasts.Type.MESSAGE
                );
            }}
        />
    );
}

export default definePlugin({
    name: "StereoGuard",
    description: "Locally silences anyone whose audio is not fully mono: slight panning, stereo width, panning around, or reverb tails. Centered mono voice is never touched.",
    authors: [{ name: "Kurtzon Audio", id: 1552878708732469258n }, { name: "DavidHiFi", id: 1553713171938938891n }],
    tags: ["Voice", "Utility"],
    enabledByDefault: false,
    settings,
    settingsAboutComponent: GuardPanel,

    userAreaButton: {
        icon: StereoGuardIcon,
        render: StereoGuardButton
    },

    isHolding(userId: string) { return volumeHolds.has(userId); },
    getHeldBaseline(userId: string) { return savedVolume.get(userId); },

    async start() {
        try {
            const saved = await storeWithTimeout(DataStore.get(IGNORED_KEY));
            if (Array.isArray(saved)) {
                for (const userId of saved) if (typeof userId === "string") ignored.add(userId);
            }
        } catch (e) {
            logger.error("failed to load the ignore list", e);
        }

        try {
            const held = await storeWithTimeout(DataStore.get(HELD_KEY));
            if (held && typeof held === "object") {
                for (const [userId, volume] of Object.entries(held as Record<string, number>)) {
                    if (typeof volume === "number") setLocalVolume(userId, volume);
                }
                await storeWithTimeout(DataStore.del(HELD_KEY));
            }
        } catch (e) {
            logger.error("failed to restore held volumes", e);
        }

        // Older builds stored a positive percent threshold. Thresholds in dB
        // are never positive, so anything above zero is an old value.
        if (settings.store.threshold > 0) settings.store.threshold = -22;

        intervalId = setInterval(poll, POLL_MS);
    },

    stop() {
        if (intervalId !== undefined) {
            clearInterval(intervalId);
            intervalId = undefined;
        }

        resetCall();
        connection = null;
        participantBridge = undefined;
        bridgeChecked = false;
        unmuteCooldownUntil.clear();
    }
});
