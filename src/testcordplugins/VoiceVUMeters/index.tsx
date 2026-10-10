/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Based on Kurtzon Audio's VoiceVUMeters as shipped in Kurtcord 2.7.5. Adds a level
 * source for Discord Desktop using participant PCM from the native stereo bridge,
 * and re-targets the voice list patch at the current client.
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { MediaEngineStore, React, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import meterStyle from "./style.css?managed";

const logger = new Logger("VoiceVUMeters");

const POLL_MS = 50;
const NOTIFY_MS = 33;
const SCAN_MS = 500;
const STATS_MS = 100;
const HOLD_MS = 1500;
const RELEASE_MS = 120;
const PEAK_FALL_DB_PER_SECOND = 12;
// Self-tap/outbound mismatch guard: the self tap reads the OS device before
// Discord processing, so bleed Discord removes downstream (echo cancellation,
// noise suppression) still pins it. Raw must stay this loud (normalized) while
// outbound stays this quiet (linear) for SELF_MISMATCH_HOLD_MS before the tap
// is dropped in favor of outbound levels.
const SELF_MISMATCH_HOLD_MS = 5000;
const SELF_MISMATCH_RAW_FLOOR = 0.5;
const SELF_MISMATCH_OUTBOUND_CEILING = 0.02;
const SELF_MISMATCH_RETRY_MS = 30000;
const STREAM_RELEASE_MS = 3000;
const BAR_HEIGHT = 18;
const BAR_WIDTH = 4;
const GRADIENT = "linear-gradient(to top, #21c55d 0%, #21c55d 50%, #eab308 75%, #ef4444 100%)";

interface AudioOutput {
    id: string;
    stream: MediaStream;
}

interface VoiceConnection {
    context: string;
    // Web clients (browser, Vesktop): one WebAudio stream per remote user.
    outputs?: Record<string, AudioOutput>;
    audioContext?: AudioContext;
    // Discord Desktop: native PCM bridge, with scalar stats as a fallback.
    localSpeakingFlags?: Record<string, number>;
    localPans?: Record<string, { left: number; right: number; }>;
    // Go live streams ride their own connection: it names the streamer and
    // carries the soundshare on its outbound when the stream has audio.
    soundshareActive?: boolean;
    streamUserId?: string;
    getStats?: () => Promise<any>;
    getUserIdBySsrc?: (ssrc: number) => string | null | undefined;
}

interface WebTap {
    output: AudioOutput;
    source: MediaStreamAudioSourceNode;
    splitter: ChannelSplitterNode;
    left: AnalyserNode;
    right: AnalyserNode;
    silent: GainNode;
    bufLeft: Float32Array<ArrayBuffer>;
    bufRight: Float32Array<ArrayBuffer>;
}

interface NativeLevel {
    userId: string;
    ageMs: number;
    channels: number;
    rmsLeft: number;
    rmsRight: number;
    peakLeft: number;
    peakRight: number;
}

interface ParticipantBridge {
    getParticipantStereoLevels(): { installed: boolean; connection: number; levels: NativeLevel[]; };
}

interface Meter {
    tap?: WebTap;
    amplitude: number;
    native?: NativeLevel;
    nativeAvailable?: boolean;
    mono: boolean;
    display: [number, number];
    peak: [number, number];
    peakAt: [number, number];
    sampleAt: [number, number];
    ownsInput?: boolean;
    inputContext?: AudioContext;
    mismatchSince?: number;
    lastStreamAt?: number;
}

const meters = new Map<string, Meter>();
const subscribers = new Set<() => void>();

let connection: VoiceConnection | null = null;
let intervalId: ReturnType<typeof setInterval> | undefined;
let lastScanAt = 0;
let lastNotifyAt = 0;
let lastStatsAt = 0;
let statsInFlight = false;
let statsFailed = false;
let inputPending = false;
let inputGeneration = 0;
let inputKey = "";
let inputRetryAt = 0;
let participantBridge: ParticipantBridge | undefined;
let bridgeChecked = false;
let selfOutboundLinear = 0;
let inputMismatchDrops = 0;
let inputSuspendKey: string | null = null;

const settings = definePluginSettings({
    floorDb: {
        type: OptionType.SLIDER,
        description: "Bottom of the meter scale in dB. -60 matches SonoBus; raise it to make quiet talkers move the meter more.",
        markers: [-80, -70, -60, -50, -40, -30, -20],
        default: -60,
        stickToMarkers: true
    },
    showPeak: {
        type: OptionType.BOOLEAN,
        description: "Show the peak hold line on each bar.",
        default: true
    },
    showSelf: {
        type: OptionType.BOOLEAN,
        description: "Show a meter for your selected microphone input on Discord Desktop.",
        default: true,
        onChange() {
            lastScanAt = 0;
        }
    },
    tileSurfaces: {
        type: OptionType.SELECT,
        description: "Which call tiles show VU meters. Screen share tiles meter the stream's own audio and show nothing while it has none.",
        options: [
            {
                label: "Voice profiles only",
                value: "voice"
            },
            {
                label: "Screen shares only",
                value: "streams"
            },
            {
                label: "Both",
                value: "both",
                default: true
            }
        ]
    },
    tilePlacement: {
        type: OptionType.SELECT,
        description: "Where the meter sits on call tiles. Profile picture pins it to the bottom right corner of the user's avatar, so it stays on the picture when tile backgrounds are hidden.",
        options: [
            {
                label: "Background",
                value: "background",
                default: true
            },
            {
                label: "Profile picture",
                value: "avatar"
            }
        ]
    },
    tileMeterSide: {
        type: OptionType.SELECT,
        description: "Which side of the tile anchors the meter, for both the background position and the profile picture. The meter always sits centered vertically so it clears the strip and the labels.",
        options: [
            {
                label: "Right",
                value: "right",
                default: true
            },
            {
                label: "Left",
                value: "left"
            }
        ]
    },
    tileMeterHeight: {
        type: OptionType.SLIDER,
        description: "Tile meter height as a percent of the tile height. 50 is the default height.",
        markers: makeRange(25, 100, 5),
        default: 50,
        stickToMarkers: true
    }
}).withPrivateSettings<{ peakHoldEnabled?: boolean; }>();

function getConnection(): VoiceConnection | null {
    const engine = MediaEngineStore.getMediaEngine();
    if (!engine?.connections) return null;

    for (const conn of engine.connections as Iterable<VoiceConnection>) {
        if (conn?.context === "default") return conn;
    }

    return null;
}

function isWebConnection(conn: VoiceConnection) {
    return conn.audioContext != null && conn.outputs != null;
}

function newMeter(mono: boolean, tap?: WebTap): Meter {
    return { tap, amplitude: 0, mono, display: [0, 0], peak: [0, 0], peakAt: [0, 0], sampleAt: [0, 0] };
}

function channelCount(output: AudioOutput) {
    return output.stream.getAudioTracks()[0]?.getSettings?.().channelCount ?? 0;
}

function createWebMeter(conn: VoiceConnection, userId: string) {
    const output = conn.outputs![userId];
    if (!output?.stream?.getAudioTracks().length) return;

    const context = conn.audioContext!;
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

    if (meter.ownsInput) {
        meter.tap.output.stream.getTracks().forEach(track => track.stop());
        void meter.inputContext?.close();
        inputKey = "";
    }

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

function dropAll() {
    inputGeneration++;
    for (const userId of [...meters.keys()]) dropMeter(userId);
}

async function syncSelfInput(conn: VoiceConnection) {
    const userId = UserStore.getCurrentUser()?.id;
    const deviceKey = MediaEngineStore.getInputDeviceId();
    if (!userId) return;
    if (!settings.store.showSelf) {
        inputSuspendKey = null;
        return;
    }
    if (inputKey === deviceKey && meters.get(userId)?.ownsInput) return;
    if (inputSuspendKey != null && inputSuspendKey === deviceKey) return;
    if (inputPending || Date.now() < inputRetryAt) return;

    dropMeter(userId);
    meters.set(userId, newMeter(true));
    const generation = inputGeneration;
    inputPending = true;
    let stream: MediaStream | undefined;
    let audioContext: AudioContext | undefined;
    let adopted = false;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(device => device.kind === "audioinput");
        const engine = MediaEngineStore.getMediaEngine() as {
            getAudioInputDevices(): Promise<Array<{ id: string; originalId?: string; name: string; }>>;
        };
        const nativeInputs = await engine.getAudioInputDevices();
        const selected = nativeInputs.find(device => device.id === deviceKey || device.originalId === deviceKey);
        const device = inputs.find(input => input.deviceId === deviceKey || input.deviceId === selected?.originalId)
            ?? inputs.find(input => input.label === selected?.name);
        const id = device?.deviceId ?? (deviceKey === "default" ? "default" : null);
        if (!id) throw new Error("Selected Discord input cannot be matched to an audio capture device.");
        stream = await navigator.mediaDevices.getUserMedia({ audio: {
            deviceId: { exact: id }, channelCount: { ideal: 2 },
            echoCancellation: false, noiseSuppression: false, autoGainControl: false
        }, video: false });
        if (generation !== inputGeneration || conn !== connection || !settings.store.showSelf || deviceKey !== MediaEngineStore.getInputDeviceId()) {
            return;
        }
        audioContext = new AudioContext();
        await audioContext.resume();
        if (generation !== inputGeneration || conn !== connection || !settings.store.showSelf || deviceKey !== MediaEngineStore.getInputDeviceId()) return;
        createWebMeter({ context: "input-meter", audioContext, outputs: { [userId]: { id: userId, stream } } }, userId);
        const meter = meters.get(userId);
        if (meter) {
            meter.ownsInput = true;
            meter.inputContext = audioContext;
            adopted = true;
            inputMismatchDrops = 0;
            inputSuspendKey = null;
        }
        inputKey = deviceKey;
    } catch (error) {
        logger.error("Cannot measure selected input channels", error);
        inputRetryAt = Date.now() + 30000;
    } finally {
        if (!adopted) {
            stream?.getTracks().forEach(track => track.stop());
            void audioContext?.close();
        }
        inputPending = false;
    }
}

function syncWebMeters(conn: VoiceConnection) {
    const outputs = conn.outputs!;

    for (const userId of Object.keys(outputs)) {
        const meter = meters.get(userId);
        if (!meter?.tap || meter.tap.output !== outputs[userId]) {
            dropMeter(userId);
            createWebMeter(conn, userId);
        } else {
            meter.mono = channelCount(outputs[userId]) === 1;
        }
    }

    for (const userId of [...meters.keys()]) {
        if (!outputs[userId]) dropMeter(userId);
    }
}

// Desktop: one meter for everyone in your voice channel, so silent users still get an empty bar.
function syncDesktopMeters() {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    const members = new Set(channelId ? Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {}) : []);

    const me = UserStore.getCurrentUser()?.id;
    if (me && !settings.store.showSelf) members.delete(me);

    for (const userId of members) {
        const meter = meters.get(userId);
        if (!meter || (meter.tap && !meter.ownsInput)) {
            dropMeter(userId);
            meters.set(userId, newMeter(true));
        }
    }

    for (const userId of [...meters.keys()]) {
        if (!members.has(userId) && !userId.startsWith("stream:")) dropMeter(userId);
    }
}

// Stats report a 0..1 linear level; older engines have used 0..100 and 16-bit scales.
function toLinear(value: unknown) {
    const level = Number(value);
    if (!Number.isFinite(level) || level <= 0) return 0;
    if (level <= 1) return level;
    if (level <= 100) return level / 100;
    if (level <= 32767) return level / 32767;
    return Math.min(level / 1e5, 1);
}

function audioEntry(value: unknown): Record<string, any> | undefined {
    const entries = Array.isArray(value) ? value : [value];
    return entries.find(entry => entry && typeof entry === "object" && (entry.type == null || entry.type === "audio"));
}

function setAmplitude(userId: string | null | undefined, level: unknown) {
    if (!userId) return;

    const meter = meters.get(userId);
    if (meter && !meter.tap) meter.amplitude = toLinear(level);
}

const STREAM_KEY = (ownerId: string) => `stream:${ownerId}`;

// Stream meters only exist while the stream actually carries audio, so a
// soundless stream shows no meter instead of a flat or microphone-driven one.
function setStreamAmplitude(ownerId: string, level: unknown) {
    const key = STREAM_KEY(ownerId);
    let meter = meters.get(key);
    if (!meter || meter.tap) {
        dropMeter(key);
        meter = newMeter(true);
        meters.set(key, meter);
    }
    meter.lastStreamAt = Date.now();
    meter.amplitude = toLinear(level);
}

// Go live audio rides its own RTC connection, which names the streamer. The
// streamer sends the soundshare on that connection's outbound; a viewer
// receives the stream's audio as its inbound.
function readStreamLevels(conn: VoiceConnection, stats: any) {
    const owner = conn.streamUserId;
    if (!owner) return;

    if (conn.soundshareActive) {
        const outbound = audioEntry(stats?.rtp?.outbound);
        if (outbound) setStreamAmplitude(owner, outbound.audioLevel);
        return;
    }

    const inbound = stats?.rtp?.inbound;
    const entries = Array.isArray(inbound) ? inbound : inbound && typeof inbound === "object" ? Object.values(inbound) : [];
    for (const entry of entries) {
        const audio = audioEntry(entry);
        if (!audio?.ssrc) continue;
        setStreamAmplitude(owner, audio.audioLevel);
    }
}

function readLevels(conn: VoiceConnection, stats: any) {
    const inbound = stats?.rtp?.inbound;

    if (Array.isArray(inbound)) {
        for (const value of inbound) {
            const entry = audioEntry(value);
            if (entry) setAmplitude(conn.getUserIdBySsrc?.(Number(entry.ssrc)), entry.audioLevel);
        }
    } else if (inbound && typeof inbound === "object") {
        for (const [key, value] of Object.entries(inbound)) {
            const entry = audioEntry(value);
            if (!entry) continue;

            const mapped = conn.getUserIdBySsrc?.(Number(entry.ssrc));
            const userId = mapped ?? (meters.has(key) ? key : null);
            if (mapped && meters.has(key) && mapped !== key) continue;
            setAmplitude(userId, entry.audioLevel);
        }
    }

    const me = UserStore.getCurrentUser()?.id;
    const outbound = audioEntry(stats?.rtp?.outbound);
    if (me && outbound) {
        const level = MediaEngineStore.isSelfMute() ? 0 : toLinear(outbound.audioLevel);
        selfOutboundLinear = level;
        setAmplitude(me, level);
    }
}

async function pollStats() {
    if (statsInFlight) return;
    const engine = MediaEngineStore.getMediaEngine();
    const connections = engine?.connections ? [...engine.connections as Iterable<VoiceConnection>] : [];
    if (!connections.length) return;

    statsInFlight = true;
    try {
        for (const conn of connections) {
            if (typeof conn.getStats !== "function") continue;
            try {
                const stats = await conn.getStats();
                if (!stats) continue;
                if (conn === connection) readLevels(conn, stats);
                readStreamLevels(conn, stats);
            } catch (e) {
                if (!statsFailed) logger.error("failed to read voice stats", e);
                statsFailed = true;
            }
        }
    } finally {
        statsInFlight = false;
    }
}

// The speaking flags flip the moment someone stops, well before their level decays.
function isHeard(userId: string) {
    const flags = connection?.localSpeakingFlags;
    if (!flags || !(userId in flags)) return true;
    return flags[userId] !== 0;
}

// Discord Desktop only reports one level per remote user, so their two bars come from the
// same gains the client's mixer uses. A user you have panned hard left goes quiet on the right.
function getPan(userId: string): [number, number] {
    try {
        const pan = MediaEngineStore.getLocalPan?.(userId);
        if (pan && Number.isFinite(pan.left) && Number.isFinite(pan.right)) {
            return [Math.max(0, pan.left), Math.max(0, pan.right)];
        }
    } catch (e) {
        // fall through to centered
    }

    const local = connection?.localPans?.[userId];
    if (local && Number.isFinite(local.left) && Number.isFinite(local.right)) {
        return [Math.max(0, local.left), Math.max(0, local.right)];
    }

    return [1, 1];
}

function readNativeLevels() {
    if (!bridgeChecked) {
        bridgeChecked = true;
        try {
            if (typeof DiscordNative !== "undefined") {
                const voice = DiscordNative.nativeModules.requireModule("discord_voice") as unknown as Partial<ParticipantBridge>;
                if (typeof voice.getParticipantStereoLevels === "function") participantBridge = voice as ParticipantBridge;
            }
        } catch (error) {
            logger.error("Cannot access participant PCM bridge", error);
        }
    }
    if (!participantBridge) return;
    const snapshot = participantBridge.getParticipantStereoLevels();
    const me = UserStore.getCurrentUser()?.id;
    for (const [userId, meter] of meters) {
        if (meter.tap || userId === me) continue;
        meter.nativeAvailable = snapshot.installed && snapshot.connection > 0;
        meter.native = undefined;
    }
    if (!snapshot.installed || !snapshot.connection) return;
    for (const level of snapshot.levels) {
        const meter = meters.get(level.userId);
        if (!meter || meter.tap || level.userId === me || level.ageMs < 0 || level.ageMs > 150
            || (level.channels !== 1 && level.channels !== 2)
            || ![level.rmsLeft, level.rmsRight, level.peakLeft, level.peakRight].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) continue;
        meter.native = level;
        meter.mono = level.channels === 1;
    }
}

function normalize(amplitude: number, floorDb: number) {
    const db = 20 * Math.log10(Math.max(amplitude, 1e-5));
    return Math.max(0, Math.min(1, (db - floorDb) / -floorDb));
}

function readChannel(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>, floorDb: number) {
    analyser.getFloatTimeDomainData(buffer);

    let sum = 0;
    let peak = 0;
    for (const value of buffer) {
        const abs = Math.abs(value);
        if (abs > peak) peak = abs;
        sum += value * value;
    }

    return { rms: normalize(Math.sqrt(sum / buffer.length), floorDb), peak: normalize(peak, floorDb) };
}

function smooth(meter: Meter, channel: 0 | 1, level: { rms: number; peak: number; }, now: number) {
    const previousAt = meter.sampleAt[channel] || now;
    const elapsed = Math.max(0, now - previousAt);
    meter.sampleAt[channel] = now;
    const display = meter.display[channel];
    meter.display[channel] = level.rms >= display ? level.rms : level.rms + (display - level.rms) * Math.exp(-elapsed / RELEASE_MS);

    if (level.peak >= meter.peak[channel]) {
        meter.peak[channel] = level.peak;
        meter.peakAt[channel] = now;
    } else if (now - meter.peakAt[channel] > HOLD_MS) {
        const fallMs = Math.max(0, now - Math.max(previousAt, meter.peakAt[channel] + HOLD_MS));
        const fall = PEAK_FALL_DB_PER_SECOND * fallMs / (1000 * -settings.store.floorDb);
        meter.peak[channel] = Math.max(meter.display[channel], meter.peak[channel] - fall);
    }
}

function notifySubscribers() {
    for (const subscriber of subscribers) subscriber();
}

// The self tap reads the OS device before Discord processing, so bleed that
// Discord removes downstream still pins it while outbound stays silent. After
// a sustained mismatch the tap is dropped (showing outbound instead) with a
// delayed retry; after two drops the input stays on outbound until the Discord
// input device changes.
function checkSelfMismatch(meter: Meter, muted: boolean, raw: number, now: number) {
    if (!meter.ownsInput || muted || now - lastStatsAt > 1000) {
        meter.mismatchSince = undefined;
        return;
    }
    if (raw < SELF_MISMATCH_RAW_FLOOR || selfOutboundLinear > SELF_MISMATCH_OUTBOUND_CEILING) {
        meter.mismatchSince = undefined;
        inputMismatchDrops = 0;
        return;
    }
    if (meter.mismatchSince == null) meter.mismatchSince = now;
    if (now - meter.mismatchSince < SELF_MISMATCH_HOLD_MS) return;
    const me = UserStore.getCurrentUser()?.id;
    logger.warn("self input tap disagrees with voice outbound; falling back to outbound levels");
    if (me) dropMeter(me);
    inputMismatchDrops++;
    inputRetryAt = Date.now() + SELF_MISMATCH_RETRY_MS;
    if (inputMismatchDrops >= 2) inputSuspendKey = MediaEngineStore.getInputDeviceId();
}

function tick() {
    try {
        const conn = getConnection();
        if (conn !== connection) {
            dropAll();
            connection = conn;
            lastScanAt = 0;
            statsFailed = false;
        }

        if (!connection) return;

        const now = Date.now();
        const web = isWebConnection(connection);

        if (now - lastScanAt >= SCAN_MS) {
            lastScanAt = now;
            if (web) syncWebMeters(connection);
            else {
                syncDesktopMeters();
                void syncSelfInput(connection);
            }
        }

        if (!web && subscribers.size && !document.hidden && now - lastStatsAt >= STATS_MS) {
            lastStatsAt = now;
            void pollStats();
        }

        if (!web) readNativeLevels();

        for (const userId of [...meters.keys()]) {
            if (userId.startsWith("stream:") && now - (meters.get(userId)?.lastStreamAt ?? 0) > STREAM_RELEASE_MS) dropMeter(userId);
        }

        const { floorDb } = settings.store;
        for (const [userId, meter] of meters) {
            if (meter.tap) {
                const muted = meter.ownsInput && MediaEngineStore.isSelfMute();
                const left = muted ? { rms: 0, peak: 0 } : readChannel(meter.tap.left, meter.tap.bufLeft, floorDb);
                const right = muted || meter.mono ? left : readChannel(meter.tap.right, meter.tap.bufRight, floorDb);

                smooth(meter, 0, left, now);
                smooth(meter, 1, right, now);
                checkSelfMismatch(meter, muted === true, Math.max(left.rms, right.rms), now);
            } else if (meter.nativeAvailable) {
                const value = meter.native;
                smooth(meter, 0, { rms: normalize(value?.rmsLeft ?? 0, floorDb), peak: normalize(value?.peakLeft ?? 0, floorDb) }, now);
                smooth(meter, 1, { rms: normalize(value?.rmsRight ?? 0, floorDb), peak: normalize(value?.peakRight ?? 0, floorDb) }, now);
            } else {
                const value = isHeard(userId) ? normalize(meter.amplitude, floorDb) : 0;
                const [panL, panR] = getPan(userId);

                smooth(meter, 0, { rms: value * panL, peak: value * panL }, now);
                smooth(meter, 1, { rms: value * panR, peak: value * panR }, now);
            }
        }

        if (meters.size && now - lastNotifyAt >= NOTIFY_MS) {
            lastNotifyAt = now;
            notifySubscribers();
        }
    } catch (e) {
        logger.error("meter tick failed", e);
    }
}

function MeterBar({ width, value, peak, showPeak }: { width: number; value: number; peak: number; showPeak: boolean; }) {
    return (
        <div style={{ position: "relative", boxSizing: "border-box", width, height: "100%", background: "#000", border: "1px solid rgba(144,144,144,0.35)", borderRadius: 2, overflow: "hidden" }}>
            <div
                style={{
                    position: "absolute", inset: 0,
                    backgroundImage: GRADIENT,
                    clipPath: `inset(${(1 - value) * 100}% 0 0 0)`
                }}
            />
            {showPeak && peak > 0.01 && (
                <div
                    style={{
                        position: "absolute", top: `clamp(0px, calc(${(1 - peak) * 100}% - 1px), calc(100% - 2px))`, left: 0, right: 0, height: 2,
                        background: peak > 0.995 ? "#ef4444" : peak > 0.916 ? "#ffa500" : "#d3d3d3"
                    }}
                />
            )}
        </div>
    );
}

const VoiceMeter = ErrorBoundary.wrap(({ userId, height = BAR_HEIGHT, width = BAR_WIDTH, style }: { userId: string; height?: number | string; width?: number; style?: React.CSSProperties; }) => {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const lastKey = React.useRef("");

    React.useEffect(() => {
        const check = () => {
            const meter = meters.get(userId);
            const key = meter
                ? `${meter.mono}|${settings.store.showPeak}|${meter.display[0].toFixed(3)}|${meter.display[1].toFixed(3)}|${meter.peak[0].toFixed(3)}|${meter.peak[1].toFixed(3)}`
                : "";

            if (key !== lastKey.current) {
                lastKey.current = key;
                forceUpdate();
            }
        };

        check();
        subscribers.add(check);
        return () => void subscribers.delete(check);
    }, [userId]);

    const meter = meters.get(userId);
    if (!meter) return null;

    const { display, peak } = meter;
    const { showPeak } = settings.store;
    const gap = Math.max(2, Math.round(width / 2));
    const measured = (meter.tap != null || meter.nativeAvailable === true) && !meter.mono;
    const title = userId.startsWith("stream:")
        ? "Screen share audio. Left | Right"
        : meter.ownsInput
        ? "Your selected input before Discord encoding. Left | Right"
        : meter.nativeAvailable
            ? "Participant decoded audio channels before your local pan. Left | Right"
            : measured
                ? "Participant audio channels. Left | Right"
            : "Left | Right after your local pan. Discord Desktop reports one level per participant, so both bars carry it.";

    return (
        <div style={{ display: "flex", alignItems: "stretch", height, ...style }} data-vu-meter={measured ? "lr" : "level"} title={title}>
            <MeterBar width={width} value={display[0]} peak={peak[0]} showPeak={showPeak} />
            <div style={{ width: gap, display: "flex", alignItems: "stretch", justifyContent: "center" }}>
                <div style={{ width: 1, background: "rgba(235,235,235,0.6)", borderRadius: 1 }} />
            </div>
            <MeterBar width={width} value={display[1]} peak={peak[1]} showPeak={showPeak} />
        </div>
    );
}, { noop: true });

// A tile renders stream audio only when a content component above it received
// the stream id (CallTile passes streamId for stream participants and null for
// camera participants), which holds for watched and preview states alike.
interface ReactFiberNode {
    memoizedProps?: { streamId?: unknown; participant?: { streamId?: unknown; }; };
    return?: ReactFiberNode | null;
}

function fiberHasStreamId(tile: HTMLElement): boolean {
    const key = Object.keys(tile).find(k => k.startsWith("__reactFiber$"));
    if (!key) return false;
    let fiber = Reflect.get(tile, key) as ReactFiberNode | undefined;
    for (let hops = 0; fiber && hops < 40; hops++, fiber = fiber.return ?? undefined) {
        const props = fiber.memoizedProps;
        if (!props || typeof props !== "object") continue;
        if (props.streamId != null) return true;
        if (props.participant?.streamId != null) return true;
    }
    return false;
}

function TileMeter({ userId }: { userId?: string; }) {
    settings.use(["tilePlacement", "tileMeterSide", "tileMeterHeight", "tileSurfaces"]);
    const onPicture = settings.store.tilePlacement === "avatar";
    const fromLeft = settings.store.tileMeterSide === "left";
    const surfaces = settings.store.tileSurfaces;
    const boxRef = React.useRef<HTMLDivElement | null>(null);
    const [pictureInset, setPictureInset] = React.useState<{ right: number; bottom: number; } | null>(null);
    const [isStreamSlot, setIsStreamSlot] = React.useState(false);
    const [isStreamTile, setIsStreamTile] = React.useState(false);

    React.useLayoutEffect(() => {
        const tile = boxRef.current?.closest<HTMLElement>("div[data-selenium-video-tile]");
        if (!tile) return;

        // Stream PREVIEW slots (the plugin's video wrapper with an idle video
        // element) hide their meter until the stream is opened: unopened
        // streams are inaudible, so a meter there lies. Camera tiles and opened
        // streams have a live video element and keep theirs; avatar tiles carry
        // no wrapper class at all. Stream tiles are marked by their content
        // component receiving the stream id: the live indicator class also
        // shows on avatar-only tiles and disappears on watched streams.
        const syncStreamState = () => {
            const hasStreamWrapper = !!tile.querySelector("[class*='vc-stream-enhancer-wrapper']");
            const video = tile.querySelector("video");
            const playing = video != null && video.srcObject != null && video.videoWidth > 0;
            setIsStreamTile(fiberHasStreamId(tile));
            setIsStreamSlot(hasStreamWrapper && !playing);
        };
        syncStreamState();
        const observer = new MutationObserver(syncStreamState);
        observer.observe(tile, { childList: true, subtree: true, attributes: true });
        return () => observer.disconnect();
    }, []);

    React.useLayoutEffect(() => {
        if (!onPicture) return;

        const box = boxRef.current;
        const tile = box?.closest<HTMLElement>("div[data-selenium-video-tile]");
        if (!box || !tile) return;

        // Discord paints the tile picture as one role=img element that fills the tile
        // box, and FullVCPFP scales that box. Mask and background both cover a centered
        // square, so the visible picture is that square, and the meter must pin to it
        // instead of the box. ResizeObserver misses style-only changes; a zoom or
        // rounding change re-measures at the next remount.
        const measure = () => {
            const picture = tile.querySelector<HTMLElement>("div[role=img]");
            if (!picture) return;

            const tileBox = tile.getBoundingClientRect();
            const pictureBox = picture.getBoundingClientRect();
            if (!tileBox.width || !pictureBox.width) return;

            const zoom = picture.clientHeight ? pictureBox.height / picture.clientHeight : 1;
            const square = Math.min(picture.clientWidth, picture.clientHeight) * zoom;
            if (!square) return;
            const squareRight = pictureBox.left + (pictureBox.width + square) / 2;
            const squareBottom = pictureBox.top + (pictureBox.height + square) / 2;

            const right = Math.max(0, tileBox.right - squareRight);
            const bottom = Math.max(0, tileBox.bottom - squareBottom);
            if (!Number.isFinite(right) || !Number.isFinite(bottom)) return;
            setPictureInset(prev => (prev && Math.abs(prev.right - right) < 0.5 && Math.abs(prev.bottom - bottom) < 0.5 ? prev : { right, bottom }));
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(tile);
        return () => observer.disconnect();
    }, [onPicture]);

    if (!userId) return null;
    if (isStreamSlot) return null;
    if (isStreamTile && surfaces === "voice") return null;
    if (!isStreamTile && surfaces === "streams") return null;

    const height = `calc(${Math.round(settings.store.tileMeterHeight)}% - 10px)`;
    // 18px is the native seat (bars centered in the background strip); the
    // mirrored left seat uses the same inset from the tile's left edge, and the
    // picture seat hugs the measured square's corner. Every meter is centered
    // vertically (top 50% + translateY), which clears the strip and the labels.
    const inset = pictureInset ? pictureInset.right + 14 : 14;
    const style: React.CSSProperties = { position: "absolute", height, zIndex: 3, pointerEvents: "none", top: "50%", transform: "translateY(-50%)" };
    if (fromLeft) {
        style.left = onPicture ? inset : 18;
    } else {
        style.right = onPicture ? (pictureInset ? pictureInset.right + 14 : 14) : 18;
    }

    return (
        <div ref={boxRef} style={style}>
            <VoiceMeter userId={isStreamTile ? `stream:${userId}` : userId} height="100%" width={8} />
        </div>
    );
}

export default definePlugin({
    name: "VoiceVUMeters",
    description: "Draws left and right voice meters with a divider next to everyone in your voice channel and on call tiles.",
    authors: [TestcordDevs.Kurtzon, TestcordDevs.DavidHiFi],
    tags: ["Voice", "Utility"],
    settings,
    managedStyle: meterStyle,

    patches: [
        {
            // Voice channel list row: the meter goes last, after the mute/deafen icons, so every bar lines up.
            find: "VOICE_PANEL}}",
            replacement: {
                match: /(?<=userId:(\i)\.id,.{0,300}?)\(0,\i\.jsx\)\(\i,\{disabled:\i,[^}]{0,80}?isHovered:\i\}\)/,
                replace: "$&,$self.renderMeter($1.id)"
            }
        },
        {
            find: "data-selenium-video-tile",
            replacement: {
                // 1.0.9261 moved `ref` after participantUserId in the tile
                // destructuring and now closes the JSX call with `})}}`. USRBG and
                // the tile-avatar plugins inject Object.assign statements right
                // after the destructuring when they patch first, so also skip past
                // any of those before `return` (notes/2026-10-08-voice-tile-avatars.md).
                match: /(?<=participantUserId:(\i).{0,40}?\}=\i;(?:[^;\n]{0,220}?Object\.assign\([^;\n]+?\);){0,3}return.{0,200}?children:)(\i)(?=\}\)\}\})/,
                replace: "[$2,$self.renderTileMeter($1)]"
            }
        }
    ],

    renderMeter(userId: string) {
        return <VoiceMeter userId={userId} style={{ flexShrink: 0 }} />;
    },

    renderTileMeter(userId?: string) {
        return <TileMeter userId={userId} />;
    },

    start() {
        if (!settings.store.peakHoldEnabled) {
            settings.store.showPeak = true;
            settings.store.peakHoldEnabled = true;
        }
        intervalId = setInterval(tick, POLL_MS);
    },

    stop() {
        if (intervalId !== undefined) {
            clearInterval(intervalId);
            intervalId = undefined;
        }

        dropAll();
        connection = null;
        statsInFlight = false;
        participantBridge = undefined;
        bridgeChecked = false;
        selfOutboundLinear = 0;
        inputMismatchDrops = 0;
        inputSuspendKey = null;
    }
});
