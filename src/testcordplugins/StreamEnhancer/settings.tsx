/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { ErrorCard } from "@components/ErrorCard";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { classNameFactory } from "@utils/css";
import { OptionType } from "@utils/types";
import type { SelectOption } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { FluxDispatcher, Select, Slider, TextInput, Toasts, useEffect, UserStore,useState } from "@webpack/common";
import type { ReactNode } from "react";

import { installMicrophoneInterceptor, syncLiveMicrophoneEffects } from "./microphone";

export type StreamCodec = "auto" | "av1" | "vp9" | "h264";
type StreamQualityPreset = "efficient" | "balanced" | "maxDetail" | "extreme" | "adaptiveMax";
type MicQualityPreset = "shittyMic" | "voice" | "studio" | "broadcast" | "hiFi" | "polished";
type ShittyMicEffectPreset = "none" | "robot" | "deep" | "echo" | "static" | "demon" | "telephone" | "underwater" | "glitch" | "bullhorn" | "chipmunk";
export type MicChannelRouting = "stereo" | "swapStereo" | "dualMonoLeft" | "dualMonoRight" | "monoMix";
type GoLiveSourceTypeLike = {
    CAMERA: string;
    SCREEN: string;
    WINDOW: string;
};
type VideoCodecEnumLike = {
    AV1?: string;
    H264: string;
    H265?: string;
    VP8: string;
    VP9: string;
};
type MicCodecLike = {
    channels?: number;
    pacsize?: number;
    params?: Record<string, string>;
    rate?: number;
};
type GoLiveQualityShape = {
    bitrateTarget?: number;
    capture?: {
        framerate?: number;
        height?: number;
        width?: number;
    };
    encode?: {
        framerate?: number;
        height?: number;
        pixelCount?: number;
        width?: number;
    };
};
type GoLiveHdrExperimentConfig = {
    hdrCaptureMode?: unknown;
};
type DesktopBitrateShape = {
    max?: number;
    min?: number;
    target?: number;
};

interface StreamParticipant {
    user?: { id?: string | bigint; };
    stream?: boolean;
    streamId?: string | number | bigint;
}

interface ApplicationStreamingStoreLike {
    getAllActiveStreams?: () => Array<{
        guildId?: string | bigint | null;
        channelId?: string | bigint;
        ownerId?: string | bigint;
        streamId?: string | bigint;
    }>;
}

interface ChannelRTCStoreLike {
    getParticipants?: (channelId: string | bigint) => StreamParticipant[];
}

interface MediaEngineLike {
    eachConnection?: (callback: (connection: LiveMediaConnectionLike) => void) => void;
    getCodecCapabilities?: (callback: (capabilities: string) => void) => void;
    setAudioInputDevice?: (deviceId: string) => void;
}

interface MediaEngineInputDeviceLike {
    disabled?: boolean;
    id?: string;
}

interface VideoCodecCapability {
    codec?: string;
    encode?: boolean;
}

interface GoLiveSourceStoreLike {
    getGoLiveSource?: () => {
        cameraSource?: {
            audioDeviceGuid?: string | null;
            videoDeviceGuid?: string | null;
        };
        desktopSource?: {
            id?: string | null;
            sound?: boolean;
        };
    } | null;
}

interface GoLiveActionCreatorsLike {
    setGoLiveSource?: (source: {
        cameraSettings?: {
            audioDeviceGuid?: string | null;
            videoDeviceGuid: string;
        };
        context: "stream";
        desktopSettings?: {
            sound: boolean;
            sourceId: string;
        };
        qualityOptions: {
            frameRate: 5 | 15 | 30 | 60;
            preset: 3;
            resolution: 480 | 720 | 1080 | 1440;
        };
    }) => void;
}

interface LiveMediaConnectionLike {
    setAutomaticGainControl?: (enabled: boolean) => void;
    setEchoCancellation?: (enabled: boolean) => void;
    setNoiseCancellation?: (enabled: boolean) => void;
    setNoiseSuppression?: (enabled: boolean) => void;
    setVoiceBitRate?: (bitrate: number) => void;
}

interface MediaEngineStoreLike {
    getInputDevices?: () => Record<string, MediaEngineInputDeviceLike>;
    getInputDeviceId?: () => string;
    getMediaEngine?: () => MediaEngineLike;
}

interface LiveMicActionCreatorsLike {
    setAutomaticGainControl?: (enabled: boolean, location?: string) => void;
    setBypassSystemInputProcessing?: (enabled: boolean, location?: string) => void;
    setEchoCancellation?: (enabled: boolean, location?: string) => void;
    setInputVolume?: (volume: number) => void;
    setNoiseCancellation?: (enabled: boolean, location?: string) => void;
    setNoiseSuppression?: (enabled: boolean, location?: string) => void;
}

interface NumberEditorProps {
    label: string;
    value: number;
    min: number;
    max: number;
    markers: number[];
    onChange: (value: number) => void;
    fixed?: boolean;
    markerFormatter?: (value: number) => string;
}

interface SettingsSectionProps {
    title: string;
    children: ReactNode;
}

export const defaultStreamEnhancerConfig = {
    micTweaksEnabled: true,
    micBitrateKbps: 160,
    micStereo: true,
    micChannelRouting: "stereo" as MicChannelRouting,
    micDtx: false,
    micFec: true,
    micSampleRate: 48000,
    micChannelCount: 2,
    micGainPercent: 100,
    micEchoCancellation: false,
    micNoiseSuppression: false,
    micAutoGainControl: false,
    micForceCbr: true,
    micBuiltInEchoCancellation: false,
    micNativeNoiseCancellation: false,
    micNativeKrisp: false,
    micShittyVoiceBoostPercent: 0,
    micShittyBassBoostPercent: 0,
    micShittyBassResonancePercent: 0,
    micShittyBitcrushPercent: 0,
    micShittyFlutterPercent: 0,
    micShittyMufflePercent: 0,
    micShittyStaticPercent: 0,
    micShittyDropoutPercent: 0,
    micShittyClippingPercent: 0,
    micShittyPitchShiftPercent: 0,
    micShittyHardCutout: false,
    micOpusComplexity: 10,
    micPacketLossPercent: 1,
    micPtimeMs: 20,
    micMaxPlaybackRate: 48000,
    micPriorityBoost: true,
    receiveStereoAudio: true,
    forceRemoteMonoAudio: false,
    streamTweaksEnabled: true,
    streamVideoBitrateKbps: 24000,
    streamMinVideoBitrateKbps: 12000,
    streamAudioBitrateKbps: 192,
    streamAudioStereo: true,
    streamAudioDtx: false,
    streamAudioFec: true,
    streamAudioMaxPlaybackRate: 48000,
    streamAudioPacketLossPercent: 1,
    streamCodec: "auto",
    streamSingleLayer: true,
    streamKeyframeIntervalMs: 1000,
    streamSdpBoostEnabled: true,
    streamSdpStartBitrateKbps: 24000,
    streamAdaptiveMaxQuality: false,
    streamHdrExperimentEnabled: false,
    streamHdrCaptureMode: false,
    goLiveOpenStreamEnhancerByDefault: false,
    goLiveOpenEntireScreenByDefault: false,
    goLiveOpenCameraByDefault: false,
    dynamicBitrateFloorEnabled: true,
    dynamicBitrateFloorPercent: 72,
    streamMaxFps: 60,
    streamWidth: 1280,
    streamHeight: 720,
    streamScalePercent: 100,
    previewTweaksEnabled: true,
    previewScalePercent: 110,
    previewSaturationPercent: 110,
    previewContrastPercent: 108,
    previewUploadWidth: 1920,
    previewUploadHeight: 1080,
    previewJpegQualityPercent: 92,
    previewRefreshIntervalSec: 30,
    previewRetryIntervalSec: 5,
    previewUploadFilterEnabled: false,
    previewUploadFilterContrastPercent: 112,
    customPreviewUrl: "",
    streamTelemetryEnabled: true,
    streamTelemetryIntervalSec: 5,
    viewerResizeSliderEnabled: false,
};

export type StreamEnhancerConfig = typeof defaultStreamEnhancerConfig;
const applicationStreamingStore = findStoreLazy("ApplicationStreamingStore") as ApplicationStreamingStoreLike | undefined;
const channelRtcStore = findStoreLazy("ChannelRTCStore") as ChannelRTCStoreLike | undefined;
const mediaEngineStore = findStoreLazy("MediaEngineStore") as MediaEngineStoreLike | undefined;
const goLiveSourceStore = findByPropsLazy("getGoLiveSource") as GoLiveSourceStoreLike;
const goLiveActionCreators = findByPropsLazy("setGoLiveSource") as GoLiveActionCreatorsLike;
const liveMicActionCreators = findByPropsLazy("setAutomaticGainControl", "setEchoCancellation", "setInputVolume") as LiveMicActionCreatorsLike;
const conflictingPlugins = ["BetterMicrophone", "BetterScreenshare", "LimitlessScreenshare", "CustomStreamQuality"] as const;
const cl = classNameFactory("vc-stream-enhancer-settings-");

const minStreamFps = 0;
const maxStreamFps = 420;
const minStreamWidth = 128;
const maxStreamWidth = 7680;
const minStreamHeight = 72;
const maxStreamHeight = 4320;
const defaultMicInputVolume = 100;
const maxMicInputVolume = 300;
const liveMicrophoneRefreshSwapDelayMs = 200;
let pendingLiveMicrophoneRefresh: ReturnType<typeof setTimeout> | null = null;
const availableVideoCodecNames = new Set<string>();

const streamFpsMarkers = [0, 5, 15, 30, 60, 90, 120, 144, 240, 420];
export const streamPresetButtons = [
    ["efficient", "Efficient"],
    ["balanced", "Balanced"],
    ["maxDetail", "Max Detail"],
    ["extreme", "Extreme"],
    ["adaptiveMax", "Adaptive Max"]
] as const satisfies ReadonlyArray<readonly [StreamQualityPreset, string]>;
export const micPresetButtons = [
    ["shittyMic", "Shitty Mic"],
    ["voice", "Voice"],
    ["studio", "Studio"],
    ["broadcast", "Broadcast"],
    ["hiFi", "Hi-Fi"],
    ["polished", "Polished"]
] as const satisfies ReadonlyArray<readonly [MicQualityPreset, string]>;
export const shittyMicEffectPresetButtons = [
    ["none", "None"],
    ["robot", "Robot / 8-bit"],
    ["deep", "Deep Voice"],
    ["echo", "Echo Chamber"],
    ["static", "Radio Static"],
    ["demon", "Demon"],
    ["telephone", "Telephone"],
    ["underwater", "Underwater"],
    ["glitch", "Glitch"],
    ["bullhorn", "Bullhorn"],
    ["chipmunk", "Chipmunk"]
] as const satisfies ReadonlyArray<readonly [ShittyMicEffectPreset, string]>;
export const micChannelRoutingOptions: SelectOption[] = [
    { label: "Stereo passthrough", value: "stereo" },
    { label: "Swap left and right", value: "swapStereo" },
    { label: "Dual mono from channel 1", value: "dualMonoLeft" },
    { label: "Dual mono from channel 2", value: "dualMonoRight" },
    { label: "Mono mix from both channels", value: "monoMix" }
] as const;
const codecButtons = ["auto", "av1", "vp9", "h264"] as const satisfies readonly StreamCodec[];
export const streamResolutionOptions = [
    "128 x 72",
    "320 x 180",
    "640 x 360",
    "960 x 540",
    "1280 x 720",
    "1600 x 900",
    "1920 x 1080",
    "2560 x 1440",
    "3200 x 1800",
    "3840 x 2160",
    "4480 x 2520",
    "5120 x 2880",
    "5760 x 3240",
    "7680 x 4320"
].map(value => ({
    label: value,
    value,
} satisfies SelectOption));

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function compactMarker(value: number): string {
    if (value < 1000) return String(Math.round(value));
    const compact = value % 1000 === 0 ? String(value / 1000) : (value / 1000).toFixed(1).replace(/\.0$/, "");
    return `${compact}k`;
}

const hzMarker = (value: number) => compactMarker(value).replace(".1k", "k");
const isObjectRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value != null;
const getNumericValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const getPositiveNumericValue = (value: unknown) => {
    const number = getNumericValue(value);
    return number != null && number > 0 ? number : null;
};

export const refreshAvailableVideoCodecs = async () => {
    const mediaEngine = mediaEngineStore?.getMediaEngine?.();
    if (!mediaEngine?.getCodecCapabilities) return availableVideoCodecNames;

    const rawCapabilities = await new Promise<string>(resolve => mediaEngine.getCodecCapabilities?.(resolve));
    let nextCapabilities: VideoCodecCapability[] = [];

    try {
        const parsed = JSON.parse(rawCapabilities);
        if (Array.isArray(parsed)) {
            nextCapabilities = parsed.filter(isObjectRecord);
        }
    } catch {
        return availableVideoCodecNames;
    }

    availableVideoCodecNames.clear();
    for (const capability of nextCapabilities) {
        if (!capability.encode || !capability.codec) continue;
        availableVideoCodecNames.add(capability.codec);
    }

    return availableVideoCodecNames;
};

const hasAvailableVideoCodec = (codecName: string) => availableVideoCodecNames.has(codecName);
export const isStreamCodecAvailable = (codec: StreamCodec) => {
    if (codec === "auto" || codec === "h264") return true;
    if (codec === "av1") return hasAvailableVideoCodec("AV1");
    if (codec === "vp9") return hasAvailableVideoCodec("VP9");
    return false;
};
export const getSupportedStreamCodec = (codec: StreamCodec): StreamCodec => {
    if (isStreamCodecAvailable(codec)) return codec;
    return "h264";
};

function sanitizeCodec(value: unknown): StreamCodec {
    if (value === "av1" || value === "vp9" || value === "h264") return value;
    return "auto";
}

function sanitizeMicChannelRouting(value: unknown): MicChannelRouting {
    if (value === "swapStereo" || value === "dualMonoLeft" || value === "dualMonoRight" || value === "monoMix") {
        return value;
    }

    return "stereo";
}

const toGoLiveResolution = (height: number): 480 | 720 | 1080 | 1440 => {
    if (height <= 480) return 480;
    if (height <= 720) return 720;
    if (height <= 1080) return 1080;
    return 1440;
};

const toGoLiveFps = (fps: number): 5 | 15 | 30 | 60 => {
    if (fps <= 10) return 5;
    if (fps <= 22) return 15;
    if (fps <= 45) return 30;
    return 60;
};

function sanitizePreviewUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("data:image/")) return trimmed;

    try {
        const url = new URL(trimmed);
        if (url.protocol !== "https:" && url.protocol !== "http:") return "";
        return url.toString();
    } catch {
        return "";
    }
}

const getEffectiveMicProcessing = (config: StreamEnhancerConfig) => {
    const amplifiedShittyMic = isShittyMicMode(config) && config.micShittyVoiceBoostPercent > 0;

    return {
        autoGainControl: amplifiedShittyMic ? false : config.micAutoGainControl,
        bypassSystemInputProcessing: amplifiedShittyMic,
        builtInEchoCancellation: amplifiedShittyMic ? false : config.micBuiltInEchoCancellation,
        echoCancellation: amplifiedShittyMic ? false : config.micEchoCancellation,
        nativeKrisp: amplifiedShittyMic ? false : config.micNativeKrisp,
        nativeNoiseCancellation: amplifiedShittyMic ? false : config.micNativeNoiseCancellation,
        noiseSuppression: amplifiedShittyMic ? false : config.micNoiseSuppression
    };
};

const getSelectedResolution = (width: number, height: number) => `${width} x ${height}`;

function applySelectedResolution(value: string, normalized: StreamEnhancerConfig) {
    const [width, height] = value.split(" x ").map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    streamEnhancerSettings.store.config = normalizeConfig({
        ...normalized,
        streamWidth: width,
        streamHeight: height,
    });
}

export function normalizeConfig(input: Partial<StreamEnhancerConfig> | undefined): StreamEnhancerConfig {
    const source = input ?? {};
    return {
        micTweaksEnabled: source.micTweaksEnabled ?? defaultStreamEnhancerConfig.micTweaksEnabled,
        micBitrateKbps: clamp(Math.round(source.micBitrateKbps ?? defaultStreamEnhancerConfig.micBitrateKbps), 1, 512),
        micStereo: source.micStereo ?? defaultStreamEnhancerConfig.micStereo,
        micChannelRouting: sanitizeMicChannelRouting(source.micChannelRouting ?? defaultStreamEnhancerConfig.micChannelRouting),
        micDtx: source.micDtx ?? defaultStreamEnhancerConfig.micDtx,
        micFec: source.micFec ?? defaultStreamEnhancerConfig.micFec,
        micSampleRate: clamp(Math.round(source.micSampleRate ?? defaultStreamEnhancerConfig.micSampleRate), 8000, 192000),
        micChannelCount: clamp(Math.round(source.micChannelCount ?? defaultStreamEnhancerConfig.micChannelCount), 1, 2),
        micGainPercent: clamp(Math.round(source.micGainPercent ?? defaultStreamEnhancerConfig.micGainPercent), 25, 300),
        micEchoCancellation: source.micEchoCancellation ?? defaultStreamEnhancerConfig.micEchoCancellation,
        micNoiseSuppression: source.micNoiseSuppression ?? defaultStreamEnhancerConfig.micNoiseSuppression,
        micAutoGainControl: source.micAutoGainControl ?? defaultStreamEnhancerConfig.micAutoGainControl,
        micForceCbr: source.micForceCbr ?? defaultStreamEnhancerConfig.micForceCbr,
        micBuiltInEchoCancellation: source.micBuiltInEchoCancellation ?? defaultStreamEnhancerConfig.micBuiltInEchoCancellation,
        micNativeNoiseCancellation: source.micNativeNoiseCancellation ?? defaultStreamEnhancerConfig.micNativeNoiseCancellation,
        micNativeKrisp: source.micNativeKrisp ?? defaultStreamEnhancerConfig.micNativeKrisp,
        micShittyVoiceBoostPercent: clamp(Math.round(source.micShittyVoiceBoostPercent ?? defaultStreamEnhancerConfig.micShittyVoiceBoostPercent), 0, 100),
        micShittyBassBoostPercent: clamp(Math.round(source.micShittyBassBoostPercent ?? defaultStreamEnhancerConfig.micShittyBassBoostPercent), 0, 100),
        micShittyBassResonancePercent: clamp(Math.round(source.micShittyBassResonancePercent ?? defaultStreamEnhancerConfig.micShittyBassResonancePercent), 0, 100),
        micShittyBitcrushPercent: clamp(Math.round(source.micShittyBitcrushPercent ?? defaultStreamEnhancerConfig.micShittyBitcrushPercent), 0, 100),
        micShittyFlutterPercent: clamp(Math.round(source.micShittyFlutterPercent ?? defaultStreamEnhancerConfig.micShittyFlutterPercent), 0, 100),
        micShittyMufflePercent: clamp(Math.round(source.micShittyMufflePercent ?? defaultStreamEnhancerConfig.micShittyMufflePercent), 0, 100),
        micShittyStaticPercent: clamp(Math.round(source.micShittyStaticPercent ?? defaultStreamEnhancerConfig.micShittyStaticPercent), 0, 100),
        micShittyDropoutPercent: clamp(Math.round(source.micShittyDropoutPercent ?? defaultStreamEnhancerConfig.micShittyDropoutPercent), 0, 100),
        micShittyClippingPercent: clamp(Math.round(source.micShittyClippingPercent ?? defaultStreamEnhancerConfig.micShittyClippingPercent), 0, 100),
        micShittyPitchShiftPercent: clamp(Math.round(source.micShittyPitchShiftPercent ?? defaultStreamEnhancerConfig.micShittyPitchShiftPercent), 0, 100),
        micShittyHardCutout: source.micShittyHardCutout ?? defaultStreamEnhancerConfig.micShittyHardCutout,
        micOpusComplexity: clamp(Math.round(source.micOpusComplexity ?? defaultStreamEnhancerConfig.micOpusComplexity), 0, 10),
        micPacketLossPercent: clamp(Math.round(source.micPacketLossPercent ?? defaultStreamEnhancerConfig.micPacketLossPercent), 0, 30),
        micPtimeMs: clamp(Math.round(source.micPtimeMs ?? defaultStreamEnhancerConfig.micPtimeMs), 10, 60),
        micMaxPlaybackRate: clamp(Math.round(source.micMaxPlaybackRate ?? defaultStreamEnhancerConfig.micMaxPlaybackRate), 8000, 192000),
        micPriorityBoost: source.micPriorityBoost ?? defaultStreamEnhancerConfig.micPriorityBoost,
        receiveStereoAudio: source.forceRemoteMonoAudio ? false : (source.receiveStereoAudio ?? defaultStreamEnhancerConfig.receiveStereoAudio),
        forceRemoteMonoAudio: source.forceRemoteMonoAudio ?? defaultStreamEnhancerConfig.forceRemoteMonoAudio,
        streamTweaksEnabled: source.streamTweaksEnabled ?? defaultStreamEnhancerConfig.streamTweaksEnabled,
        streamVideoBitrateKbps: clamp(Math.round(source.streamVideoBitrateKbps ?? defaultStreamEnhancerConfig.streamVideoBitrateKbps), 250, 120000),
        streamMinVideoBitrateKbps: clamp(Math.round(source.streamMinVideoBitrateKbps ?? defaultStreamEnhancerConfig.streamMinVideoBitrateKbps), 250, 120000),
        streamAudioBitrateKbps: clamp(Math.round(source.streamAudioBitrateKbps ?? defaultStreamEnhancerConfig.streamAudioBitrateKbps), 24, 320),
        streamAudioStereo: source.streamAudioStereo ?? defaultStreamEnhancerConfig.streamAudioStereo,
        streamAudioDtx: source.streamAudioDtx ?? defaultStreamEnhancerConfig.streamAudioDtx,
        streamAudioFec: source.streamAudioFec ?? defaultStreamEnhancerConfig.streamAudioFec,
        streamAudioMaxPlaybackRate: clamp(Math.round(source.streamAudioMaxPlaybackRate ?? defaultStreamEnhancerConfig.streamAudioMaxPlaybackRate), 8000, 192000),
        streamAudioPacketLossPercent: clamp(Math.round(source.streamAudioPacketLossPercent ?? defaultStreamEnhancerConfig.streamAudioPacketLossPercent), 0, 30),
        streamCodec: sanitizeCodec(source.streamCodec ?? defaultStreamEnhancerConfig.streamCodec),
        streamSingleLayer: source.streamSingleLayer ?? defaultStreamEnhancerConfig.streamSingleLayer,
        streamKeyframeIntervalMs: clamp(Math.round(source.streamKeyframeIntervalMs ?? defaultStreamEnhancerConfig.streamKeyframeIntervalMs), 250, 5000),
        streamSdpBoostEnabled: source.streamSdpBoostEnabled ?? defaultStreamEnhancerConfig.streamSdpBoostEnabled,
        streamSdpStartBitrateKbps: clamp(Math.round(source.streamSdpStartBitrateKbps ?? defaultStreamEnhancerConfig.streamSdpStartBitrateKbps), 500, 120000),
        streamAdaptiveMaxQuality: source.streamAdaptiveMaxQuality ?? defaultStreamEnhancerConfig.streamAdaptiveMaxQuality,
        streamHdrExperimentEnabled: source.streamHdrExperimentEnabled ?? defaultStreamEnhancerConfig.streamHdrExperimentEnabled,
        streamHdrCaptureMode: source.streamHdrCaptureMode ?? defaultStreamEnhancerConfig.streamHdrCaptureMode,
        goLiveOpenStreamEnhancerByDefault: source.goLiveOpenStreamEnhancerByDefault ?? defaultStreamEnhancerConfig.goLiveOpenStreamEnhancerByDefault,
        goLiveOpenEntireScreenByDefault: (source.goLiveOpenStreamEnhancerByDefault ?? defaultStreamEnhancerConfig.goLiveOpenStreamEnhancerByDefault)
            ? false
            : source.goLiveOpenEntireScreenByDefault ?? defaultStreamEnhancerConfig.goLiveOpenEntireScreenByDefault,
        goLiveOpenCameraByDefault: (source.goLiveOpenStreamEnhancerByDefault ?? defaultStreamEnhancerConfig.goLiveOpenStreamEnhancerByDefault)
            ? false
            : (source.goLiveOpenEntireScreenByDefault ?? defaultStreamEnhancerConfig.goLiveOpenEntireScreenByDefault)
            ? false
            : source.goLiveOpenCameraByDefault ?? defaultStreamEnhancerConfig.goLiveOpenCameraByDefault,
        dynamicBitrateFloorEnabled: source.dynamicBitrateFloorEnabled ?? defaultStreamEnhancerConfig.dynamicBitrateFloorEnabled,
        dynamicBitrateFloorPercent: clamp(Math.round(source.dynamicBitrateFloorPercent ?? defaultStreamEnhancerConfig.dynamicBitrateFloorPercent), 35, 100),
        streamMaxFps: clamp(Math.round(source.streamMaxFps ?? defaultStreamEnhancerConfig.streamMaxFps), minStreamFps, maxStreamFps),
        streamWidth: clamp(Math.round(source.streamWidth ?? defaultStreamEnhancerConfig.streamWidth), minStreamWidth, maxStreamWidth),
        streamHeight: clamp(Math.round(source.streamHeight ?? defaultStreamEnhancerConfig.streamHeight), minStreamHeight, maxStreamHeight),
        streamScalePercent: clamp(Math.round(source.streamScalePercent ?? defaultStreamEnhancerConfig.streamScalePercent), 50, 400),
        previewTweaksEnabled: source.previewTweaksEnabled ?? defaultStreamEnhancerConfig.previewTweaksEnabled,
        previewScalePercent: clamp(Math.round(source.previewScalePercent ?? defaultStreamEnhancerConfig.previewScalePercent), 80, 160),
        previewSaturationPercent: clamp(Math.round(source.previewSaturationPercent ?? defaultStreamEnhancerConfig.previewSaturationPercent), 50, 200),
        previewContrastPercent: clamp(Math.round(source.previewContrastPercent ?? defaultStreamEnhancerConfig.previewContrastPercent), 50, 200),
        previewUploadWidth: clamp(Math.round(source.previewUploadWidth ?? defaultStreamEnhancerConfig.previewUploadWidth), 320, 3840),
        previewUploadHeight: clamp(Math.round(source.previewUploadHeight ?? defaultStreamEnhancerConfig.previewUploadHeight), 180, 2160),
        previewJpegQualityPercent: clamp(Math.round(source.previewJpegQualityPercent ?? defaultStreamEnhancerConfig.previewJpegQualityPercent), 10, 100),
        previewRefreshIntervalSec: clamp(Math.round(source.previewRefreshIntervalSec ?? defaultStreamEnhancerConfig.previewRefreshIntervalSec), 5, 300),
        previewRetryIntervalSec: clamp(Math.round(source.previewRetryIntervalSec ?? defaultStreamEnhancerConfig.previewRetryIntervalSec), 3, 120),
        previewUploadFilterEnabled: source.previewUploadFilterEnabled ?? defaultStreamEnhancerConfig.previewUploadFilterEnabled,
        previewUploadFilterContrastPercent: clamp(Math.round(source.previewUploadFilterContrastPercent ?? defaultStreamEnhancerConfig.previewUploadFilterContrastPercent), 50, 200),
        customPreviewUrl: sanitizePreviewUrl(source.customPreviewUrl ?? defaultStreamEnhancerConfig.customPreviewUrl),
        streamTelemetryEnabled: source.streamTelemetryEnabled ?? defaultStreamEnhancerConfig.streamTelemetryEnabled,
        streamTelemetryIntervalSec: clamp(Math.round(source.streamTelemetryIntervalSec ?? defaultStreamEnhancerConfig.streamTelemetryIntervalSec), 1, 30),
        viewerResizeSliderEnabled: source.viewerResizeSliderEnabled ?? false
    };
}

export function applyStreamPreset(config: StreamEnhancerConfig, preset: StreamQualityPreset): StreamEnhancerConfig {
    switch (preset) {
        case "efficient":
            return normalizeConfig({
                ...config,
                streamCodec: "auto",
                streamSingleLayer: true,
                streamVideoBitrateKbps: 24000,
                streamMinVideoBitrateKbps: 12000,
                streamAudioBitrateKbps: 192,
                streamAudioStereo: true,
                streamAudioDtx: false,
                streamAudioFec: true,
                streamAudioMaxPlaybackRate: 48000,
                streamAudioPacketLossPercent: 1,
                streamMaxFps: 60,
                streamWidth: 1280,
                streamHeight: 720,
                streamScalePercent: 100,
                streamKeyframeIntervalMs: 1000,
                streamSdpBoostEnabled: true,
                streamSdpStartBitrateKbps: 24000,
                streamAdaptiveMaxQuality: false,
                dynamicBitrateFloorEnabled: true,
                dynamicBitrateFloorPercent: 72
            });
        case "balanced":
            return normalizeConfig({
                ...config,
                streamCodec: "auto",
                streamSingleLayer: true,
                streamVideoBitrateKbps: 18000,
                streamMinVideoBitrateKbps: 9000,
                streamAudioBitrateKbps: 192,
                streamAudioStereo: true,
                streamAudioDtx: false,
                streamAudioFec: true,
                streamAudioMaxPlaybackRate: 48000,
                streamAudioPacketLossPercent: 1,
                streamMaxFps: 60,
                streamWidth: 1920,
                streamHeight: 1080,
                streamScalePercent: 100,
                streamKeyframeIntervalMs: 1000,
                streamSdpBoostEnabled: true,
                streamSdpStartBitrateKbps: 12000,
                streamAdaptiveMaxQuality: false,
                dynamicBitrateFloorEnabled: true,
                dynamicBitrateFloorPercent: 65
            });
        case "maxDetail":
            return normalizeConfig({
                ...config,
                streamCodec: "av1",
                streamSingleLayer: true,
                streamVideoBitrateKbps: 50000,
                streamMinVideoBitrateKbps: 26000,
                streamAudioBitrateKbps: 256,
                streamAudioStereo: true,
                streamAudioDtx: false,
                streamAudioFec: true,
                streamAudioMaxPlaybackRate: 96000,
                streamAudioPacketLossPercent: 1,
                streamMaxFps: 120,
                streamWidth: 3840,
                streamHeight: 2160,
                streamScalePercent: 100,
                streamKeyframeIntervalMs: 750,
                streamSdpBoostEnabled: true,
                streamSdpStartBitrateKbps: 28000,
                streamAdaptiveMaxQuality: false,
                dynamicBitrateFloorEnabled: true,
                dynamicBitrateFloorPercent: 82
            });
        case "extreme":
            return normalizeConfig({
                ...config,
                streamCodec: "av1",
                streamSingleLayer: true,
                streamVideoBitrateKbps: 110000,
                streamMinVideoBitrateKbps: 70000,
                streamAudioBitrateKbps: 320,
                streamAudioStereo: true,
                streamAudioDtx: false,
                streamAudioFec: true,
                streamAudioMaxPlaybackRate: 192000,
                streamAudioPacketLossPercent: 0,
                streamMaxFps: 240,
                streamWidth: 7680,
                streamHeight: 4320,
                streamScalePercent: 100,
                streamKeyframeIntervalMs: 500,
                streamSdpBoostEnabled: true,
                streamSdpStartBitrateKbps: 85000,
                streamAdaptiveMaxQuality: false,
                dynamicBitrateFloorEnabled: true,
                dynamicBitrateFloorPercent: 92
            });
        case "adaptiveMax":
            return normalizeConfig({
                ...config,
                streamCodec: "av1",
                streamSingleLayer: true,
                streamVideoBitrateKbps: 42000,
                streamMinVideoBitrateKbps: 12000,
                streamAudioBitrateKbps: 256,
                streamAudioStereo: true,
                streamAudioDtx: false,
                streamAudioFec: true,
                streamAudioMaxPlaybackRate: 96000,
                streamAudioPacketLossPercent: 1,
                streamMaxFps: 120,
                streamWidth: 5120,
                streamHeight: 2880,
                streamScalePercent: 100,
                streamKeyframeIntervalMs: 500,
                streamSdpBoostEnabled: true,
                streamSdpStartBitrateKbps: 26000,
                streamAdaptiveMaxQuality: true,
                dynamicBitrateFloorEnabled: true,
                dynamicBitrateFloorPercent: 76
            });
    }
}

export function applyMicPreset(config: StreamEnhancerConfig, preset: MicQualityPreset): StreamEnhancerConfig {
    switch (preset) {
        case "shittyMic":
            return normalizeConfig({
                ...config,
                micTweaksEnabled: true,
                micBitrateKbps: 2,
                micSampleRate: 8000,
                micChannelCount: 1,
                micStereo: false,
                micChannelRouting: "monoMix",
                micDtx: true,
                micFec: false,
                micEchoCancellation: true,
                micNoiseSuppression: true,
                micAutoGainControl: true,
                micBuiltInEchoCancellation: true,
                micNativeNoiseCancellation: true,
                micNativeKrisp: true,
                micShittyVoiceBoostPercent: 35,
                micShittyBassBoostPercent: 45,
                micShittyBassResonancePercent: 55,
                micShittyBitcrushPercent: 70,
                micShittyFlutterPercent: 40,
                micShittyMufflePercent: 60,
                micShittyStaticPercent: 35,
                micShittyDropoutPercent: 80,
                micShittyClippingPercent: 75,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: true,
                micForceCbr: false,
                micOpusComplexity: 0,
                micPacketLossPercent: 30,
                micPtimeMs: 60,
                micMaxPlaybackRate: 8000,
                micPriorityBoost: false,
                receiveStereoAudio: false,
                forceRemoteMonoAudio: false
            });
        case "voice":
            return normalizeConfig({
                ...config,
                micTweaksEnabled: true,
                micBitrateKbps: 128,
                micSampleRate: 48000,
                micChannelCount: 1,
                micStereo: false,
                micChannelRouting: "monoMix",
                micDtx: true,
                micFec: true,
                micOpusComplexity: 8,
                micPacketLossPercent: 3,
                micPtimeMs: 20,
                micMaxPlaybackRate: 48000,
                micPriorityBoost: true,
                micShittyVoiceBoostPercent: 0,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 0,
                micShittyFlutterPercent: 0,
                micShittyMufflePercent: 0,
                micShittyStaticPercent: 0,
                micShittyDropoutPercent: 0,
                micShittyClippingPercent: 0,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                receiveStereoAudio: false,
                forceRemoteMonoAudio: false
            });
        case "studio":
            return normalizeConfig({
                ...config,
                micTweaksEnabled: true,
                micBitrateKbps: 256,
                micSampleRate: 48000,
                micChannelCount: 2,
                micStereo: true,
                micChannelRouting: "stereo",
                micDtx: false,
                micFec: true,
                micOpusComplexity: 10,
                micPacketLossPercent: 1,
                micPtimeMs: 20,
                micMaxPlaybackRate: 48000,
                micPriorityBoost: true,
                micShittyVoiceBoostPercent: 0,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 0,
                micShittyFlutterPercent: 0,
                micShittyMufflePercent: 0,
                micShittyStaticPercent: 0,
                micShittyDropoutPercent: 0,
                micShittyClippingPercent: 0,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                receiveStereoAudio: true,
                forceRemoteMonoAudio: false
            });
        case "broadcast":
            return normalizeConfig({
                ...config,
                micTweaksEnabled: true,
                micBitrateKbps: 320,
                micSampleRate: 48000,
                micChannelCount: 2,
                micStereo: true,
                micChannelRouting: "stereo",
                micEchoCancellation: false,
                micNoiseSuppression: false,
                micAutoGainControl: false,
                micBuiltInEchoCancellation: false,
                micNativeNoiseCancellation: false,
                micNativeKrisp: false,
                micForceCbr: true,
                micDtx: false,
                micFec: true,
                micOpusComplexity: 10,
                micPacketLossPercent: 1,
                micPtimeMs: 20,
                micMaxPlaybackRate: 48000,
                micPriorityBoost: true,
                micShittyVoiceBoostPercent: 0,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 0,
                micShittyFlutterPercent: 0,
                micShittyMufflePercent: 0,
                micShittyStaticPercent: 0,
                micShittyDropoutPercent: 0,
                micShittyClippingPercent: 0,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                receiveStereoAudio: true,
                forceRemoteMonoAudio: false
            });
        case "hiFi":
            return normalizeConfig({
                ...config,
                micTweaksEnabled: true,
                micBitrateKbps: 512,
                micSampleRate: 48000,
                micChannelCount: 2,
                micStereo: true,
                micChannelRouting: "stereo",
                micEchoCancellation: false,
                micNoiseSuppression: false,
                micAutoGainControl: false,
                micBuiltInEchoCancellation: false,
                micNativeNoiseCancellation: false,
                micNativeKrisp: false,
                micForceCbr: true,
                micDtx: false,
                micFec: false,
                micOpusComplexity: 10,
                micPacketLossPercent: 0,
                micPtimeMs: 10,
                micMaxPlaybackRate: 48000,
                micPriorityBoost: true,
                micShittyVoiceBoostPercent: 0,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 0,
                micShittyFlutterPercent: 0,
                micShittyMufflePercent: 0,
                micShittyStaticPercent: 0,
                micShittyDropoutPercent: 0,
                micShittyClippingPercent: 0,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                receiveStereoAudio: true,
                forceRemoteMonoAudio: false
            });
        case "polished":
            return normalizeConfig({
                ...config,
                micTweaksEnabled: true,
                micBitrateKbps: 320,
                micSampleRate: 48000,
                micChannelCount: 2,
                micStereo: true,
                micChannelRouting: "stereo",
                micEchoCancellation: true,
                micNoiseSuppression: true,
                micAutoGainControl: true,
                micBuiltInEchoCancellation: true,
                micNativeNoiseCancellation: true,
                micNativeKrisp: true,
                micForceCbr: true,
                micDtx: false,
                micFec: true,
                micOpusComplexity: 10,
                micPacketLossPercent: 2,
                micPtimeMs: 20,
                micMaxPlaybackRate: 48000,
                micPriorityBoost: true,
                micShittyVoiceBoostPercent: 0,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 0,
                micShittyFlutterPercent: 0,
                micShittyMufflePercent: 0,
                micShittyStaticPercent: 0,
                micShittyDropoutPercent: 0,
                micShittyClippingPercent: 0,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                receiveStereoAudio: true,
                forceRemoteMonoAudio: false
            });
    }
}

export function applyShittyMicEffectPreset(config: StreamEnhancerConfig, preset: ShittyMicEffectPreset): StreamEnhancerConfig {
    const base = applyMicPreset(config, "shittyMic");

    switch (preset) {
        case "none":
            return base;
        case "robot":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 8,
                micSampleRate: 8000,
                micShittyVoiceBoostPercent: 20,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 100,
                micShittyFlutterPercent: 10,
                micShittyMufflePercent: 20,
                micShittyStaticPercent: 8,
                micShittyDropoutPercent: 15,
                micShittyClippingPercent: 95,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                micPtimeMs: 20
            });
        case "deep":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 3,
                micSampleRate: 8000,
                micShittyVoiceBoostPercent: 55,
                micShittyBassBoostPercent: 100,
                micShittyBassResonancePercent: 90,
                micShittyBitcrushPercent: 18,
                micShittyFlutterPercent: 5,
                micShittyMufflePercent: 78,
                micShittyStaticPercent: 6,
                micShittyDropoutPercent: 12,
                micShittyClippingPercent: 88,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                micPtimeMs: 40
            });
        case "echo":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 8,
                micSampleRate: 16000,
                micShittyVoiceBoostPercent: 25,
                micShittyBassBoostPercent: 10,
                micShittyBassResonancePercent: 15,
                micShittyBitcrushPercent: 22,
                micShittyFlutterPercent: 75,
                micShittyMufflePercent: 35,
                micShittyStaticPercent: 15,
                micShittyDropoutPercent: 10,
                micShittyClippingPercent: 40,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                micPtimeMs: 60
            });
        case "static":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 2,
                micSampleRate: 8000,
                micShittyVoiceBoostPercent: 10,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 80,
                micShittyFlutterPercent: 35,
                micShittyMufflePercent: 70,
                micShittyStaticPercent: 100,
                micShittyDropoutPercent: 95,
                micShittyClippingPercent: 70,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: true,
                micPtimeMs: 60
            });
        case "demon":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 2,
                micSampleRate: 8000,
                micShittyVoiceBoostPercent: 65,
                micShittyBassBoostPercent: 95,
                micShittyBassResonancePercent: 100,
                micShittyBitcrushPercent: 45,
                micShittyFlutterPercent: 18,
                micShittyMufflePercent: 85,
                micShittyStaticPercent: 18,
                micShittyDropoutPercent: 20,
                micShittyClippingPercent: 100,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                micPtimeMs: 45
            });
        case "telephone":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 6,
                micSampleRate: 8000,
                micShittyVoiceBoostPercent: 8,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 38,
                micShittyFlutterPercent: 4,
                micShittyMufflePercent: 82,
                micShittyStaticPercent: 10,
                micShittyDropoutPercent: 4,
                micShittyClippingPercent: 55,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                micPtimeMs: 20
            });
        case "underwater":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 4,
                micSampleRate: 8000,
                micShittyVoiceBoostPercent: 18,
                micShittyBassBoostPercent: 35,
                micShittyBassResonancePercent: 35,
                micShittyBitcrushPercent: 20,
                micShittyFlutterPercent: 68,
                micShittyMufflePercent: 92,
                micShittyStaticPercent: 12,
                micShittyDropoutPercent: 10,
                micShittyClippingPercent: 30,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                micPtimeMs: 60
            });
        case "glitch":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 2,
                micSampleRate: 8000,
                micShittyVoiceBoostPercent: 22,
                micShittyBassBoostPercent: 5,
                micShittyBassResonancePercent: 10,
                micShittyBitcrushPercent: 100,
                micShittyFlutterPercent: 100,
                micShittyMufflePercent: 48,
                micShittyStaticPercent: 52,
                micShittyDropoutPercent: 100,
                micShittyClippingPercent: 92,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: true,
                micPtimeMs: 60
            });
        case "bullhorn":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 12,
                micSampleRate: 16000,
                micShittyVoiceBoostPercent: 70,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 28,
                micShittyFlutterPercent: 6,
                micShittyMufflePercent: 58,
                micShittyStaticPercent: 6,
                micShittyDropoutPercent: 0,
                micShittyClippingPercent: 85,
                micShittyPitchShiftPercent: 0,
                micShittyHardCutout: false,
                micPtimeMs: 20
            });
        case "chipmunk":
            return normalizeConfig({
                ...base,
                micBitrateKbps: 64,
                micSampleRate: 48000,
                micShittyVoiceBoostPercent: 40,
                micShittyBassBoostPercent: 0,
                micShittyBassResonancePercent: 0,
                micShittyBitcrushPercent: 0,
                micShittyFlutterPercent: 0,
                micShittyMufflePercent: 0,
                micShittyStaticPercent: 0,
                micShittyDropoutPercent: 0,
                micShittyClippingPercent: 0,
                micShittyPitchShiftPercent: 100,
                micShittyHardCutout: false,
                micPtimeMs: 20
            });
    }
}

const syncLiveMicPresetSettings = (config: StreamEnhancerConfig, preset: MicQualityPreset) => {
    const location = "StreamEnhancer";
    const processing = getEffectiveMicProcessing(config);
    const bypassSystemInputProcessing = processing.bypassSystemInputProcessing || preset !== "shittyMic";

    liveMicActionCreators.setAutomaticGainControl?.(processing.autoGainControl, location);
    liveMicActionCreators.setEchoCancellation?.(processing.echoCancellation, location);
    liveMicActionCreators.setNoiseSuppression?.(processing.noiseSuppression, location);
    liveMicActionCreators.setNoiseCancellation?.(processing.nativeNoiseCancellation, location);
    liveMicActionCreators.setBypassSystemInputProcessing?.(bypassSystemInputProcessing, location);
};

const syncLiveMicConnections = (config: StreamEnhancerConfig) => {
    const mediaEngine = mediaEngineStore?.getMediaEngine?.();
    const liveBitrate = Math.max(1000, config.micBitrateKbps * 1000);
    const processing = getEffectiveMicProcessing(config);
    const liveInputVolume = clamp(defaultMicInputVolume + config.micShittyVoiceBoostPercent * 2, defaultMicInputVolume, maxMicInputVolume);
    let synced = false;

    if (liveMicActionCreators.setInputVolume) {
        liveMicActionCreators.setInputVolume(liveInputVolume);
        synced = true;
    }

    liveMicActionCreators.setAutomaticGainControl?.(processing.autoGainControl, "StreamEnhancer");
    liveMicActionCreators.setEchoCancellation?.(processing.echoCancellation, "StreamEnhancer");
    liveMicActionCreators.setNoiseSuppression?.(processing.noiseSuppression, "StreamEnhancer");
    liveMicActionCreators.setNoiseCancellation?.(processing.nativeNoiseCancellation, "StreamEnhancer");
    liveMicActionCreators.setBypassSystemInputProcessing?.(processing.bypassSystemInputProcessing, "StreamEnhancer");

    mediaEngine?.eachConnection?.(connection => {
        synced = true;
        connection.setVoiceBitRate?.(liveBitrate);
        connection.setAutomaticGainControl?.(processing.autoGainControl);
        connection.setEchoCancellation?.(processing.echoCancellation);
        connection.setNoiseSuppression?.(processing.noiseSuppression);
        connection.setNoiseCancellation?.(processing.nativeNoiseCancellation);
    });

    return synced;
};

export const syncCurrentLiveMicConnections = () => {
    return syncLiveMicConnections(normalizeConfig(streamEnhancerSettings.store.config));
};

const refreshLiveMicrophoneInput = () => {
    const inputDeviceId = mediaEngineStore?.getInputDeviceId?.();
    const mediaEngine = mediaEngineStore?.getMediaEngine?.();
    if (!inputDeviceId || !mediaEngine?.setAudioInputDevice) return;

    const inputDevices = Object.values(mediaEngineStore?.getInputDevices?.() ?? {});
    const alternateInputDeviceId = inputDevices.find(device => device.id && !device.disabled && device.id !== inputDeviceId)?.id;
    if (!alternateInputDeviceId) {
        mediaEngine.setAudioInputDevice(inputDeviceId);
        return;
    }

    mediaEngine.setAudioInputDevice(alternateInputDeviceId);
    setTimeout(() => mediaEngine.setAudioInputDevice?.(inputDeviceId), liveMicrophoneRefreshSwapDelayMs);
};

export const scheduleLiveMicrophoneRefresh = () => {
    if (pendingLiveMicrophoneRefresh != null) clearTimeout(pendingLiveMicrophoneRefresh);
    pendingLiveMicrophoneRefresh = setTimeout(() => {
        pendingLiveMicrophoneRefresh = null;
        refreshLiveMicrophoneInput();
    }, 120);
};

export const syncCurrentGoLiveSource = (config: StreamEnhancerConfig) => {
    if (!shouldOverrideStreamResolution()) return;
    void refreshAvailableVideoCodecs();
    const currentSource = goLiveSourceStore.getGoLiveSource?.();
    const qualityOptions = {
        frameRate: toGoLiveFps(config.streamMaxFps),
        preset: 3 as const,
        resolution: toGoLiveResolution(config.streamHeight)
    };

    if (currentSource?.cameraSource?.videoDeviceGuid) {
        goLiveActionCreators.setGoLiveSource?.({
            cameraSettings: {
                audioDeviceGuid: currentSource.cameraSource.audioDeviceGuid,
                videoDeviceGuid: currentSource.cameraSource.videoDeviceGuid
            },
            context: "stream",
            qualityOptions
        });
        return;
    }

    const desktopSource = currentSource?.desktopSource;
    const sourceId = desktopSource?.id;
    if (!sourceId) return;

    goLiveActionCreators.setGoLiveSource?.({
        context: "stream",
        desktopSettings: {
            sound: desktopSource.sound ?? true,
            sourceId
        },
        qualityOptions
    });
};

export const applyMicPresetAndSync = (config: StreamEnhancerConfig, preset: MicQualityPreset) => {
    installMicrophoneInterceptor();
    const next = applyMicPreset(config, preset);
    streamEnhancerSettings.store.config = next;
    const syncedEffects = syncLiveMicrophoneEffects();
    const syncedConnections = syncLiveMicConnections(next);

    if (!syncedEffects && !syncedConnections) {
        syncLiveMicPresetSettings(next, preset);
        refreshLiveMicrophoneInput();
    }

    return next;
};

export const applyShittyMicEffectPresetAndSync = (config: StreamEnhancerConfig, preset: ShittyMicEffectPreset) => {
    installMicrophoneInterceptor();
    const next = applyShittyMicEffectPreset(config, preset);
    streamEnhancerSettings.store.config = next;
    const syncedEffects = syncLiveMicrophoneEffects();
    const syncedConnections = syncLiveMicConnections(next);
    scheduleLiveMicrophoneRefresh();

    if (!syncedEffects && !syncedConnections) refreshLiveMicrophoneInput();

    return next;
};

export const isShittyMicMode = (config: StreamEnhancerConfig) => {
    return config.micTweaksEnabled && config.micSampleRate <= 8000 && config.micBitrateKbps <= 4;
};

function getActiveConflicts(): string[] {
    return conflictingPlugins.filter(name => isPluginEnabled(name));
}

function forceRefreshStreamPreview() {
    const currentUser = UserStore.getCurrentUser();
    const currentUserId = currentUser?.id != null ? String(currentUser.id) : null;
    if (!currentUserId) return;

    const activeStreams = applicationStreamingStore?.getAllActiveStreams?.() ?? [];
    const ownStream = activeStreams.find(stream => stream.ownerId != null && String(stream.ownerId) === currentUserId);
    if (!ownStream || ownStream.channelId == null) {
        Toasts.show({
            id: Toasts.genId(),
            message: "StreamEnhancer: No active stream found to refresh preview.",
            type: Toasts.Type.FAILURE
        });
        return;
    }

    const participants = channelRtcStore?.getParticipants?.(ownStream.channelId) ?? [];
    const ownStreamParticipant = participants.find(participant =>
        participant.stream
        && participant.streamId != null
        && participant.user?.id != null
        && String(participant.user.id) === currentUserId
    );

    const streamId = ownStreamParticipant?.streamId ?? ownStream.streamId ?? null;
    if (streamId == null) {
        Toasts.show({
            id: Toasts.genId(),
            message: "StreamEnhancer: Preview refresh needs an active stream ID. Try again after the stream stabilizes.",
            type: Toasts.Type.FAILURE
        });
        return;
    }

    FluxDispatcher.dispatch({
        type: "RTC_CONNECTION_VIDEO",
        guildId: ownStream.guildId ?? null,
        channelId: ownStream.channelId,
        userId: currentUser.id,
        streamId: String(streamId),
        context: "stream"
    });

    Toasts.show({
        id: Toasts.genId(),
        message: "StreamEnhancer: Requested immediate stream preview refresh.",
        type: Toasts.Type.SUCCESS
    });
}

function NumberEditor({
    label,
    value,
    min,
    max,
    markers,
    onChange,
    fixed = true,
    markerFormatter
}: NumberEditorProps) {
    return (
        <div className={cl("control")}>
            <div className={cl("label")}>
                {label}: <span className={cl("label-value")}>{value}</span>
            </div>
            <Slider
                key={fixed ? `${label}-${value}-${min}-${max}` : undefined}
                minValue={min}
                maxValue={max}
                markers={markers}
                initialValue={value}
                stickToMarkers={fixed}
                onValueChange={next => onChange(clamp(Math.round(next), min, max))}
                onMarkerRender={next => markerFormatter?.(next) ?? String(Math.round(next))}
                onValueRender={next => String(Math.round(next))}
            />
        </div>
    );
}

function SettingsSection({ title, children }: SettingsSectionProps) {
    return (
        <div className={cl("group")}>
            <Heading tag="h4" className={cl("section-title")}>{title}</Heading>
            {children}
        </div>
    );
}

export function StreamEnhancerControlPanel() {
    const { config } = streamEnhancerSettings.use(["config"]);
    const normalized = normalizeConfig(config);
    const [availableCodecs, setAvailableCodecs] = useState<Record<StreamCodec, boolean>>({
        auto: true,
        av1: false,
        vp9: false,
        h264: true
    });
    const conflicts = getActiveConflicts();
    const selectedResolution = getSelectedResolution(normalized.streamWidth, normalized.streamHeight);
    const resolutionOptions = streamResolutionOptions.some(option => option.value === selectedResolution)
        ? streamResolutionOptions
        : [{ label: selectedResolution, value: selectedResolution }, ...streamResolutionOptions];
    const set = <K extends keyof StreamEnhancerConfig>(key: K, next: StreamEnhancerConfig[K]) => {
        const updated = normalizeConfig({ ...normalized, [key]: next });
        streamEnhancerSettings.store.config = updated;

        if (key === "streamCodec") {
            syncCurrentGoLiveSource(updated);
        }
    };

    useEffect(() => {
        installMicrophoneInterceptor();
    }, []);

    useEffect(() => {
        void refreshAvailableVideoCodecs().then(() => {
            setAvailableCodecs({
                auto: true,
                av1: isStreamCodecAvailable("av1"),
                vp9: isStreamCodecAvailable("vp9"),
                h264: true
            });
        });
    }, []);

    return (
        <div className={cl("card")}>
            <ErrorCard>
                StreamEnhancer overrides Discord's normal stream and microphone pipeline. Keep only one stream tuning plugin enabled and restart Discord after changing overlapping plugins.
                {conflicts.length > 0 ? ` Active conflicts: ${conflicts.join(", ")}.` : ""}
            </ErrorCard>

            <SettingsSection title="Screenshare Quality">
                <FormSwitch value={normalized.streamTweaksEnabled} onChange={value => set("streamTweaksEnabled", value)} title="Improve stream quality" />
                <div className={cl("label")}>Quick preset</div>
                <div className={cl("preset-row")}>
                    {streamPresetButtons.map(([preset, label]) => (
                        <Button key={preset} size="small" variant="secondary" onClick={() => { streamEnhancerSettings.store.config = applyStreamPreset(normalized, preset); }}>
                            {label}
                        </Button>
                    ))}
                </div>
                <div className={cl("label")}>Video codec</div>
                <div className={cl("preset-row")}>
                    {codecButtons.map(codec => (
                        <Button
                            key={codec}
                            size="small"
                            variant={codec === normalized.streamCodec ? "primary" : "secondary"}
                            className={codec === normalized.streamCodec ? cl("codec-active") : ""}
                            disabled={!availableCodecs[codec]}
                            onClick={() => set("streamCodec", getSupportedStreamCodec(codec))}
                        >
                            {codec.toUpperCase()}
                        </Button>
                    ))}
                </div>
                <Divider />
                <FormSwitch value={normalized.streamSingleLayer} onChange={value => set("streamSingleLayer", value)} title="Prefer one high quality stream layer" />
                <FormSwitch value={normalized.streamAdaptiveMaxQuality} onChange={value => set("streamAdaptiveMaxQuality", value)} title="Adaptive max quality" description="Keep quality high but back off faster on weaker connections." />
                <FormSwitch value={normalized.dynamicBitrateFloorEnabled} onChange={value => set("dynamicBitrateFloorEnabled", value)} title="Keep bitrate from dropping too low" />
                <FormSwitch value={normalized.streamHdrExperimentEnabled} onChange={value => set("streamHdrExperimentEnabled", value)} title="Enable HDR Go Live experiment" description="Forces Discord's 2026-02 Go Live HDR experiment into its HDR-enabled treatment." />
                <FormSwitch value={normalized.streamHdrCaptureMode} onChange={value => set("streamHdrCaptureMode", value)} title="Use HDR capture mode" description="Passes Discord's HDR capture mode through to the native capture pipeline." />
                <NumberEditor label="Max stream FPS" value={normalized.streamMaxFps} min={minStreamFps} max={maxStreamFps} markers={streamFpsMarkers} onChange={next => set("streamMaxFps", next)} fixed={false} />
                <div className={cl("label")}>Stream resolution</div>
                <Select
                    options={resolutionOptions}
                    isSelected={value => value === selectedResolution}
                    select={value => applySelectedResolution(value, normalized)}
                    serialize={value => value}
                />
                <NumberEditor label="Resolution quality (%)" value={normalized.streamScalePercent} min={50} max={400} markers={[50, 75, 100, 125, 150, 200, 250, 300, 400]} onChange={next => set("streamScalePercent", next)} />
                <NumberEditor label="Video bitrate (kbps)" value={normalized.streamVideoBitrateKbps} min={250} max={120000} markers={[5000, 20000, 50000, 120000]} markerFormatter={compactMarker} onChange={next => set("streamVideoBitrateKbps", next)} />
                <NumberEditor label="Minimum video bitrate (kbps)" value={normalized.streamMinVideoBitrateKbps} min={250} max={120000} markers={[5000, 20000, 50000, 120000]} markerFormatter={compactMarker} onChange={next => set("streamMinVideoBitrateKbps", next)} />
                <NumberEditor label="Dynamic floor strength (%)" value={normalized.dynamicBitrateFloorPercent} min={35} max={100} markers={[35, 45, 55, 65, 75, 85, 100]} onChange={next => set("dynamicBitrateFloorPercent", next)} />
                <NumberEditor label="Keyframe interval (ms)" value={normalized.streamKeyframeIntervalMs} min={250} max={5000} markers={[250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000]} onChange={next => set("streamKeyframeIntervalMs", next)} />
                <FormSwitch value={normalized.streamSdpBoostEnabled} onChange={value => set("streamSdpBoostEnabled", value)} title="SDP bitrate boost" />
                <NumberEditor label="SDP start bitrate (kbps)" value={normalized.streamSdpStartBitrateKbps} min={500} max={120000} markers={[500, 2000, 5000, 20000, 50000, 120000]} markerFormatter={compactMarker} onChange={next => set("streamSdpStartBitrateKbps", next)} />
                <Divider />
                <Heading tag="h5" className={cl("section-subtitle")}>Stream audio</Heading>
                <NumberEditor label="Stream audio bitrate (kbps)" value={normalized.streamAudioBitrateKbps} min={24} max={320} markers={[64, 96, 128, 160, 192, 256, 320]} onChange={next => set("streamAudioBitrateKbps", next)} />
                <div className={cl("grid")}>
                    <FormSwitch value={normalized.streamAudioStereo} onChange={value => set("streamAudioStereo", value)} title="Stereo stream audio" />
                    <FormSwitch value={normalized.streamAudioFec} onChange={value => set("streamAudioFec", value)} title="Forward error correction" />
                    <FormSwitch value={normalized.streamAudioDtx} onChange={value => set("streamAudioDtx", value)} title="Silence compression" />
                </div>
                <NumberEditor label="Stream audio max playback rate (Hz)" value={normalized.streamAudioMaxPlaybackRate} min={8000} max={192000} markers={[16000, 48000, 96000, 192000]} markerFormatter={hzMarker} onChange={next => set("streamAudioMaxPlaybackRate", next)} />
                <NumberEditor label="Stream audio packet loss protection (%)" value={normalized.streamAudioPacketLossPercent} min={0} max={30} markers={[0, 2, 5, 10, 15, 20, 30]} onChange={next => set("streamAudioPacketLossPercent", next)} />
                <Divider />
                <Heading tag="h5" className={cl("section-subtitle")}>Telemetry</Heading>
                <FormSwitch value={normalized.streamTelemetryEnabled} onChange={value => set("streamTelemetryEnabled", value)} title="Show outgoing and observed stream stats" />
                <NumberEditor label="Telemetry interval (sec)" value={normalized.streamTelemetryIntervalSec} min={1} max={30} markers={[1, 2, 3, 5, 10, 15, 30]} onChange={next => set("streamTelemetryIntervalSec", next)} />
            </SettingsSection>

            <SettingsSection title="Microphone Quality">
                <FormSwitch value={normalized.micTweaksEnabled} onChange={value => set("micTweaksEnabled", value)} title="Improve microphone quality" />
                <div className={cl("note")}>Discord still encodes voice chat, so this aims for the cleanest path Discord will allow rather than true lossless audio.</div>
                <div className={cl("label")}>Quick preset</div>
                <div className={cl("preset-row")}>
                    {micPresetButtons.map(([preset, label]) => (
                        <Button key={preset} size="small" variant="secondary" onClick={() => { applyMicPresetAndSync(normalized, preset); }}>
                            {label}
                        </Button>
                    ))}
                </div>
                <Divider />
                <NumberEditor label="Upload bitrate (kbps)" value={normalized.micBitrateKbps} min={1} max={512} markers={[1, 2, 4, 8, 12, 16, 24, 32, 64, 96, 128, 256, 320, 512]} onChange={next => set("micBitrateKbps", next)} />
                <NumberEditor label="Sample rate (Hz)" value={normalized.micSampleRate} min={8000} max={192000} markers={[16000, 48000, 96000, 192000]} markerFormatter={hzMarker} onChange={next => set("micSampleRate", next)} />
                <NumberEditor label="Input channels" value={normalized.micChannelCount} min={1} max={2} markers={[1, 2]} onChange={next => set("micChannelCount", next)} />
                <NumberEditor label="Mic gain (%)" value={normalized.micGainPercent} min={25} max={300} markers={[25, 50, 75, 100, 125, 150, 200, 250, 300]} onChange={next => { set("micGainPercent", next); syncLiveMicrophoneEffects(); syncCurrentLiveMicConnections(); scheduleLiveMicrophoneRefresh(); }} />
                <div className={cl("label")}>Input routing</div>
                <Select
                    options={micChannelRoutingOptions}
                    select={option => set("micChannelRouting", sanitizeMicChannelRouting(option))}
                    isSelected={option => option === normalized.micChannelRouting}
                    serialize={option => option}
                />
                <NumberEditor label="Encoder quality" value={normalized.micOpusComplexity} min={0} max={10} markers={[0, 2, 4, 6, 8, 10]} onChange={next => set("micOpusComplexity", next)} />
                <NumberEditor label="Packet loss protection (%)" value={normalized.micPacketLossPercent} min={0} max={30} markers={[0, 2, 5, 10, 15, 20, 30]} onChange={next => set("micPacketLossPercent", next)} />
                <NumberEditor label="Packet duration (ms)" value={normalized.micPtimeMs} min={10} max={60} markers={[10, 20, 30, 40, 50, 60]} onChange={next => set("micPtimeMs", next)} />
                <NumberEditor label="Playback rate hint (Hz)" value={normalized.micMaxPlaybackRate} min={8000} max={192000} markers={[16000, 48000, 96000, 192000]} markerFormatter={hzMarker} onChange={next => set("micMaxPlaybackRate", next)} />
                <Divider />
                <div className={cl("label")}>Voice effect</div>
                <div className={cl("preset-row")}>
                    {shittyMicEffectPresetButtons.map(([preset, label]) => (
                        <Button key={preset} size="small" variant="secondary" onClick={() => { applyShittyMicEffectPresetAndSync(normalized, preset); }}>
                            {label}
                        </Button>
                    ))}
                </div>
                {isShittyMicMode(normalized) && (
                    <>
                        <Divider />
                        <div className={cl("grid")}>
                            <NumberEditor label="Bad mic amplifier (%)" value={normalized.micShittyVoiceBoostPercent} min={0} max={100} markers={[0, 10, 20, 30, 40, 50, 60, 75, 100]} onChange={next => { set("micShittyVoiceBoostPercent", next); syncLiveMicrophoneEffects(); syncCurrentLiveMicConnections(); scheduleLiveMicrophoneRefresh(); }} />
                            <NumberEditor label="Bad mic bass boost (%)" value={normalized.micShittyBassBoostPercent} min={0} max={100} markers={[0, 10, 20, 30, 40, 50, 60, 75, 100]} onChange={next => { set("micShittyBassBoostPercent", next); syncLiveMicrophoneEffects(); scheduleLiveMicrophoneRefresh(); }} />
                            <NumberEditor label="Bad mic bass resonance (%)" value={normalized.micShittyBassResonancePercent} min={0} max={100} markers={[0, 10, 20, 30, 40, 50, 60, 75, 100]} onChange={next => { set("micShittyBassResonancePercent", next); syncLiveMicrophoneEffects(); scheduleLiveMicrophoneRefresh(); }} />
                            <NumberEditor label="Bad mic bitcrush (%)" value={normalized.micShittyBitcrushPercent} min={0} max={100} markers={[0, 10, 20, 30, 40, 50, 60, 75, 100]} onChange={next => { set("micShittyBitcrushPercent", next); syncLiveMicrophoneEffects(); scheduleLiveMicrophoneRefresh(); }} />
                            <NumberEditor label="Bad mic flutter (%)" value={normalized.micShittyFlutterPercent} min={0} max={100} markers={[0, 10, 20, 30, 40, 50, 60, 75, 100]} onChange={next => { set("micShittyFlutterPercent", next); syncLiveMicrophoneEffects(); scheduleLiveMicrophoneRefresh(); }} />
                            <NumberEditor label="Bad mic muffle (%)" value={normalized.micShittyMufflePercent} min={0} max={100} markers={[0, 10, 20, 30, 40, 50, 60, 75, 100]} onChange={next => { set("micShittyMufflePercent", next); syncLiveMicrophoneEffects(); scheduleLiveMicrophoneRefresh(); }} />
                            <NumberEditor label="Bad mic static (%)" value={normalized.micShittyStaticPercent} min={0} max={100} markers={[0, 10, 20, 30, 40, 50, 60, 75, 100]} onChange={next => { set("micShittyStaticPercent", next); syncLiveMicrophoneEffects(); scheduleLiveMicrophoneRefresh(); }} />
                            <NumberEditor label="Bad mic dropout (%)" value={normalized.micShittyDropoutPercent} min={0} max={100} markers={[0, 10, 20, 30, 40, 50, 60, 75, 100]} onChange={next => { set("micShittyDropoutPercent", next); syncLiveMicrophoneEffects(); scheduleLiveMicrophoneRefresh(); }} />
                            <NumberEditor label="Bad mic clipping (%)" value={normalized.micShittyClippingPercent} min={0} max={100} markers={[0, 10, 20, 30, 40, 50, 60, 75, 100]} onChange={next => { set("micShittyClippingPercent", next); syncLiveMicrophoneEffects(); scheduleLiveMicrophoneRefresh(); }} />
                            <FormSwitch value={normalized.micShittyHardCutout} onChange={value => { set("micShittyHardCutout", value); syncLiveMicrophoneEffects(); scheduleLiveMicrophoneRefresh(); }} title="Cut out more aggressively" />
                        </div>
                    </>
                )}
                <Divider />
                <div className={cl("grid")}>
                    <FormSwitch value={normalized.micStereo} onChange={value => set("micStereo", value)} title="Ask Discord for stereo" />
                    <FormSwitch value={normalized.receiveStereoAudio} onChange={value => set("receiveStereoAudio", value)} title="Prefer stereo playback" />
                    <FormSwitch value={normalized.forceRemoteMonoAudio} onChange={value => set("forceRemoteMonoAudio", value)} title="Force incoming voices to mono" />
                    <FormSwitch value={normalized.micDtx} onChange={value => set("micDtx", value)} title="Silence compression" />
                    <FormSwitch value={normalized.micFec} onChange={value => set("micFec", value)} title="Forward error correction" />
                    <FormSwitch value={normalized.micEchoCancellation} onChange={value => set("micEchoCancellation", value)} title="Echo cancellation" />
                    <FormSwitch value={normalized.micNoiseSuppression} onChange={value => set("micNoiseSuppression", value)} title="Noise suppression" />
                    <FormSwitch value={normalized.micAutoGainControl} onChange={value => set("micAutoGainControl", value)} title="Auto gain control" />
                    <FormSwitch value={normalized.micForceCbr} onChange={value => set("micForceCbr", value)} title="Use constant bitrate" />
                    <FormSwitch value={normalized.micPriorityBoost} onChange={value => set("micPriorityBoost", value)} title="Favor mic quality" />
                </div>
            </SettingsSection>

            <SettingsSection title="Preview Controls">
                <FormSwitch value={normalized.previewTweaksEnabled} onChange={value => set("previewTweaksEnabled", value)} title="Enable stream preview tweaks" />
                <NumberEditor label="Preview scale (%)" value={normalized.previewScalePercent} min={80} max={160} markers={[80, 90, 100, 110, 120, 140, 160]} onChange={next => set("previewScalePercent", next)} />
                <NumberEditor label="Preview saturation (%)" value={normalized.previewSaturationPercent} min={50} max={200} markers={[50, 75, 100, 125, 150, 175, 200]} onChange={next => set("previewSaturationPercent", next)} />
                <NumberEditor label="Preview contrast (%)" value={normalized.previewContrastPercent} min={50} max={200} markers={[50, 75, 100, 125, 150, 175, 200]} onChange={next => set("previewContrastPercent", next)} />
                <Divider />
                <Heading tag="h5" className={cl("section-subtitle")}>Upload pipeline</Heading>
                <NumberEditor label="Preview upload width" value={normalized.previewUploadWidth} min={320} max={3840} markers={[640, 960, 1280, 1600, 1920, 2560, 3840]} onChange={next => set("previewUploadWidth", next)} />
                <NumberEditor label="Preview upload height" value={normalized.previewUploadHeight} min={180} max={2160} markers={[360, 540, 720, 900, 1080, 1440, 2160]} onChange={next => set("previewUploadHeight", next)} />
                <NumberEditor label="Preview JPEG quality (%)" value={normalized.previewJpegQualityPercent} min={10} max={100} markers={[10, 25, 40, 55, 70, 85, 100]} onChange={next => set("previewJpegQualityPercent", next)} />
                <NumberEditor label="Preview refresh interval (sec)" value={normalized.previewRefreshIntervalSec} min={5} max={300} markers={[5, 15, 30, 60, 120, 300]} onChange={next => set("previewRefreshIntervalSec", next)} />
                <NumberEditor label="Preview retry interval (sec)" value={normalized.previewRetryIntervalSec} min={3} max={120} markers={[3, 5, 10, 15, 30, 60, 120]} onChange={next => set("previewRetryIntervalSec", next)} />
                <FormSwitch value={normalized.previewUploadFilterEnabled} onChange={value => set("previewUploadFilterEnabled", value)} title="Enable upload contrast and sharpness filter" />
                <NumberEditor label="Upload filter contrast (%)" value={normalized.previewUploadFilterContrastPercent} min={50} max={200} markers={[50, 75, 100, 125, 150, 175, 200]} onChange={next => set("previewUploadFilterContrastPercent", next)} />
                <Button size="small" variant="secondary" onClick={forceRefreshStreamPreview}>Force Refresh Preview</Button>
                <Divider />
                <Heading tag="h5" className={cl("section-subtitle")}>Custom stream preview URL</Heading>
                <TextInput value={normalized.customPreviewUrl} placeholder="https://example.com/preview.png or data:image/..." onChange={value => set("customPreviewUrl", sanitizePreviewUrl(value))} />
                <Button size="small" variant="secondary" onClick={() => set("customPreviewUrl", "")}>Clear Preview URL</Button>
                <div className={cl("note")}>Changes apply live to outgoing media and stream previews.</div>
            </SettingsSection>

            <SettingsSection title="Viewer Controls">
                <FormSwitch
                    value={normalized.viewerResizeSliderEnabled}
                    onChange={value => set("viewerResizeSliderEnabled", value)}
                    title="Show resize slider in stream menu"
                    description="Adds a video size slider to the in-viewer stream menu."
                />
            </SettingsSection>
        </div>
    );
}

export const streamEnhancerSettings = definePluginSettings({
    config: {
        type: OptionType.CUSTOM,
        description: "Persistent StreamEnhancer tuning values.",
        default: defaultStreamEnhancerConfig,
    },
    controlPanel: {
        type: OptionType.COMPONENT,
        component: StreamEnhancerControlPanel
    }
});

const getConfig = () => normalizeConfig(streamEnhancerSettings.store.config);

export const shouldOverrideStreamResolution = () => {
    return (
        getConfig().streamTweaksEnabled &&
        !isPluginEnabled("LimitlessScreenshare") &&
        !isPluginEnabled("CustomStreamQuality") &&
        !isPluginEnabled("BetterScreenshare")
    );
};

const getScaledStreamDimensions = (config: StreamEnhancerConfig) => {
    const scale = config.streamScalePercent / 100;
    const roundEven = (value: number, min: number, max: number) => clamp(Math.round(value / 2) * 2, min, max);

    return {
        width: roundEven(config.streamWidth * scale, minStreamWidth, maxStreamWidth),
        height: roundEven(config.streamHeight * scale, minStreamHeight, maxStreamHeight)
    };
};
const getStreamConfig = () => {
    const config = getConfig();
    const scaled = getScaledStreamDimensions(config);

    return {
        config,
        fps: config.streamTweaksEnabled ? config.streamMaxFps : defaultStreamEnhancerConfig.streamMaxFps,
        width: config.streamTweaksEnabled ? scaled.width : defaultStreamEnhancerConfig.streamWidth,
        height: config.streamTweaksEnabled ? scaled.height : defaultStreamEnhancerConfig.streamHeight,
    };
};
const getMicConfig = () => {
    const config = getConfig();
    const processing = getEffectiveMicProcessing(config);

    return {
        autoGainControl: processing.autoGainControl,
        builtInEchoCancellation: processing.builtInEchoCancellation,
        channelCount: config.micChannelCount,
        cleanGain: config.micGainPercent / 100,
        degradeAudio: config.micBitrateKbps <= 16 && config.micSampleRate <= 8000,
        echoCancellation: processing.echoCancellation,
        nativeKrisp: processing.nativeKrisp,
        nativeNoiseCancellation: processing.nativeNoiseCancellation,
        noiseSuppression: processing.noiseSuppression,
        ptimeSeconds: clamp(Math.round(config.micPtimeMs), 10, 60) / 1000,
        routing: config.micChannelRouting,
        sampleRate: config.micSampleRate,
        shittyBassBoostPercent: config.micShittyBassBoostPercent,
        shittyBassResonancePercent: config.micShittyBassResonancePercent,
        shittyBitcrushPercent: config.micShittyBitcrushPercent,
        shittyFlutterPercent: config.micShittyFlutterPercent,
        shittyMufflePercent: config.micShittyMufflePercent,
        shittyStaticPercent: config.micShittyStaticPercent,
        shittyDropoutPercent: config.micShittyDropoutPercent,
        shittyClippingPercent: config.micShittyClippingPercent,
        shittyPitchShiftPercent: config.micShittyPitchShiftPercent,
        shittyHardCutout: config.micShittyHardCutout,
        shittyVoiceBoostPercent: config.micShittyVoiceBoostPercent,
        tweaksEnabled: config.micTweaksEnabled
    };
};
const getParticipantSize = (value: Record<string, unknown>, key: "width" | "height") => getNumericValue(value[key]) ?? 0;
const makeScaledCanvas = (source: HTMLCanvasElement, width: number, height: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(source, 0, 0, source.width, source.height, 0, 0, width, height);
    return canvas;
};

export const shouldShowViewerResizeSlider = () => getConfig().viewerResizeSliderEnabled;

export const getConfiguredStreamFps = (fallback?: number) => {
    if (!shouldOverrideStreamResolution()) {
        return fallback != null && fallback > 0 ? fallback : defaultStreamEnhancerConfig.streamMaxFps;
    }
    return getStreamConfig().fps;
};

export const getConfiguredStreamWidth = (fallback?: number) => {
    if (!shouldOverrideStreamResolution()) {
        return fallback != null && fallback > 0 ? fallback : defaultStreamEnhancerConfig.streamWidth;
    }
    return getStreamConfig().width;
};

export const getConfiguredStreamHeight = (fallback?: number) => {
    if (!shouldOverrideStreamResolution()) {
        return fallback != null && fallback > 0 ? fallback : defaultStreamEnhancerConfig.streamHeight;
    }
    return getStreamConfig().height;
};

export const getConfiguredStreamPixelCount = (fallback?: number) => {
    if (!shouldOverrideStreamResolution()) {
        return fallback != null && fallback > 0 ? fallback : defaultStreamEnhancerConfig.streamWidth * defaultStreamEnhancerConfig.streamHeight;
    }
    const { width, height } = getStreamConfig();
    return width * height;
};

export const getConfiguredMicBitrate = () => {
    const config = getConfig();
    const bitrate = config.micTweaksEnabled
        ? Math.max(1, config.micBitrateKbps)
        : defaultStreamEnhancerConfig.micBitrateKbps;
    return bitrate * 1000;
};

export const getMaxMicInputVolume = () => {
    const config = getConfig();
    return isShittyMicMode(config) && config.micShittyVoiceBoostPercent > 0
        ? maxMicInputVolume
        : defaultMicInputVolume;
};

export const getConfiguredStreamBitrateTarget = () => getConfig().streamVideoBitrateKbps * 1000;

export const getConfiguredStreamBitrateMin = () => getConfig().streamMinVideoBitrateKbps * 1000;

export const getConfiguredStreamBitrateMax = getConfiguredStreamBitrateTarget;

export const getGoLiveHdrExperimentConfig = <T extends GoLiveHdrExperimentConfig>(config: T) => {
    if (!getConfig().streamHdrExperimentEnabled) return config;

    return {
        ...config,
        hdrCaptureMode: "always"
    };
};

export const getHdrCaptureMode = (currentMode: unknown) => {
    const config = getConfig();
    if (!config.streamHdrCaptureMode && !config.streamHdrExperimentEnabled) return 0;
    if (config.streamHdrExperimentEnabled) return "always";
    return currentMode;
};

export const getHdrCaptureModeEnabled = () => {
    const config = getConfig();
    return config.streamHdrCaptureMode || config.streamHdrExperimentEnabled;
};

export const getDefaultGoLiveSourceType = (sourceTypes: GoLiveSourceTypeLike) => {
    const config = getConfig();
    if (config.goLiveOpenEntireScreenByDefault) return sourceTypes.SCREEN;
    if (config.goLiveOpenCameraByDefault) return sourceTypes.CAMERA;
    return sourceTypes.WINDOW;
};

export const getDefaultGoLiveSourceTypeValue = () => {
    const config = getConfig();
    if (config.goLiveOpenStreamEnhancerByDefault) return "stream_enhance";
    if (config.goLiveOpenEntireScreenByDefault) return "screen";
    if (config.goLiveOpenCameraByDefault) return "camera";
    return "window";
};

export const getPreferredVideoCodecOrder = (codecEnum: VideoCodecEnumLike, includeH265: boolean) => {
    const { streamCodec } = getConfig();
    const codecOrder = new Set<string>();

    if (includeH265 && codecEnum.H265) codecOrder.add(codecEnum.H265);

    if (streamCodec === "av1" && codecEnum.AV1 && hasAvailableVideoCodec("AV1")) codecOrder.add(codecEnum.AV1);
    if (streamCodec === "vp9" && hasAvailableVideoCodec("VP9")) codecOrder.add(codecEnum.VP9);
    if (streamCodec === "h264") codecOrder.add(codecEnum.H264);

    codecOrder.add(codecEnum.H264);
    codecOrder.add(codecEnum.VP8);
    codecOrder.add(codecEnum.VP9);
    if (codecEnum.AV1) codecOrder.add(codecEnum.AV1);

    return [...codecOrder];
};

export const getPreferredVideoCodecName = (fallbackCodec: string, includeH265: boolean) => {
    const { streamCodec } = getConfig();

    if (streamCodec === "auto") return fallbackCodec;
    if (streamCodec === "h264") return "H264";
    if (streamCodec === "av1") return hasAvailableVideoCodec("AV1") ? "AV1" : "H264";
    if (streamCodec === "vp9") return hasAvailableVideoCodec("VP9") ? "VP9" : "H264";
    if (includeH265) return "H265";

    return fallbackCodec;
};

export const getMicBuiltInEchoCancellationEnabled = () => getConfig().micBuiltInEchoCancellation;

export const getMicEchoCancellationEnabled = () => getConfig().micEchoCancellation;

export const getMicNoiseSuppressionEnabled = () => getConfig().micNoiseSuppression;

export const getMicAutoGainControlEnabled = () => getConfig().micAutoGainControl;

export const getMicNativeNoiseCancellationEnabled = () => getConfig().micNativeNoiseCancellation;

export const getMicNativeKrispEnabled = () => getConfig().micNativeKrisp;

export const getMicTweaksEnabled = () => getConfig().micTweaksEnabled;

export const getMicDtxEnabled = () => getConfig().micDtx;

export const getMicFecEnabled = () => getConfig().micFec;

export const getMicForceCbrEnabled = () => getConfig().micForceCbr;

export const getMicStereoEnabled = () => {
    const config = getConfig();
    return config.micTweaksEnabled && config.micStereo && config.micChannelCount > 1;
};

export const getMicChannelRouting = () => getConfig().micChannelRouting;

export const getMicSampleRate = () => getConfig().micSampleRate;

export const getMicChannelCount = () => getConfig().micChannelCount;

export const getMicGainFactor = () => getConfig().micGainPercent / 100;

export const getMicPtimeSeconds = () => clamp(Math.round(getConfig().micPtimeMs), 10, 60) / 1000;

export const getMicPacketSize = () => Math.max(120, Math.round(getMicSampleRate() * getMicPtimeSeconds()));

export const getMicPacketLossRate = () => clamp(Math.round(getConfig().micPacketLossPercent), 0, 30) / 100;

export const getConfiguredMicOpusBitrate = () => clamp(getConfiguredMicBitrate(), 6000, 510000);
export const getMicrophoneRuntimeConfig = getMicConfig;

const getMicCodecParams = (stereo: boolean) => ({
    stereo: stereo ? "1" : "0",
    "sprop-stereo": stereo ? "1" : "0",
    maxaveragebitrate: String(getConfiguredMicOpusBitrate()),
    cbr: getMicForceCbrEnabled() ? "1" : "0",
    useinbandfec: getMicFecEnabled() ? "1" : "0",
    usedtx: getMicDtxEnabled() ? "1" : "0",
    minptime: String(Math.max(10, Math.round(getMicPtimeSeconds() * 1e3)))
});

export const getMicOpusFmtpConfig = () => {
    const params = getMicCodecParams(getMicStereoEnabled());
    return Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join(";");
};

export const applyMicCodecPreference = (
    primaryCodec: MicCodecLike,
    audioCodecs: MicCodecLike[],
    mediaType: unknown,
    streamMediaType: unknown
) => {
    const stereo = mediaType === streamMediaType || getMicStereoEnabled();
    const channels = stereo ? 2 : 1;
    const params = getMicCodecParams(stereo);
    const rate = getConfiguredMicOpusBitrate();
    const pacsize = getMicPacketSize();

    primaryCodec.channels = channels;
    primaryCodec.rate = rate;
    primaryCodec.pacsize = pacsize;
    primaryCodec.params = { ...(primaryCodec.params ?? {}), ...params };

    for (const codec of audioCodecs) {
        codec.channels = channels;
        codec.params = { ...(codec.params ?? {}), ...params };
    }
};

export const getMicTransportAutomaticGainControlConfig = (currentConfig: Record<string, unknown>) => ({
    ...currentConfig,
    enabled: getMicAutoGainControlEnabled()
});

export const normalizeGoLiveQualityOverride = (quality: GoLiveQualityShape) => {
    if (!shouldOverrideStreamResolution()) return quality;
    return {
        ...quality,
        bitrateTarget: getConfiguredStreamBitrateTarget(),
        capture: {
            ...quality?.capture,
            width: getConfiguredStreamWidth(quality?.capture?.width),
            height: getConfiguredStreamHeight(quality?.capture?.height),
            framerate: getConfiguredStreamFps(quality?.capture?.framerate)
        },
        encode: {
            ...quality?.encode,
            width: getConfiguredStreamWidth(quality?.encode?.width),
            height: getConfiguredStreamHeight(quality?.encode?.height),
            framerate: getConfiguredStreamFps(quality?.encode?.framerate),
            pixelCount: getConfiguredStreamPixelCount(quality?.encode?.pixelCount)
        }
    };
};

export const getDefaultGoLiveQualityOptions = (desktopBitrate: DesktopBitrateShape) => {
    if (!shouldOverrideStreamResolution()) {
        return {
            capture: {
                width: 1280,
                height: 720,
                framerate: 30
            },
            encode: {
                width: 1280,
                height: 720,
                framerate: 30,
                pixelCount: 921600
            },
            bitrateMin: desktopBitrate.min,
            bitrateMax: desktopBitrate.max,
            bitrateTarget: getConfiguredStreamBitrateTarget()
        };
    }
    return {
        capture: {
            width: getConfiguredStreamWidth(),
            height: getConfiguredStreamHeight(),
            framerate: getConfiguredStreamFps()
        },
        encode: {
            width: getConfiguredStreamWidth(),
            height: getConfiguredStreamHeight(),
            framerate: getConfiguredStreamFps(),
            pixelCount: getConfiguredStreamPixelCount()
        },
        bitrateMin: desktopBitrate.min,
        bitrateMax: desktopBitrate.max,
        bitrateTarget: getConfiguredStreamBitrateTarget()
    };
};

export const getPreviewUploadWidth = () => clamp(Math.round(getConfig().previewUploadWidth), 320, 3840);

export const getPreviewUploadHeight = () => clamp(Math.round(getConfig().previewUploadHeight), 180, 2160);

export const getPreviewJpegQuality = () => clamp(getConfig().previewJpegQualityPercent / 100, 0.1, 1);

export const getPreviewRefreshIntervalMs = () => clamp(Math.round(getConfig().previewRefreshIntervalSec), 5, 300) * 1000;

export const getPreviewRetryIntervalMs = () => clamp(Math.round(getConfig().previewRetryIntervalSec), 3, 120) * 1000;

export const applyPreviewUploadFilter = (ctx: CanvasRenderingContext2D | null) => {
    if (!ctx) return;

    const config = getConfig();
    if (!config.previewUploadFilterEnabled) {
        ctx.filter = "none";
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        return;
    }

    const contrast = clamp(Math.round(config.previewUploadFilterContrastPercent), 50, 200);
    ctx.filter = `contrast(${contrast}%) saturate(112%)`;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
};

const getDataUrlBytes = (value: string) => Math.ceil((value.length - value.indexOf(",") - 1) * 3 / 4);

export const getPreviewUploadDataUrl = (canvas: HTMLCanvasElement) => {
    let quality = getPreviewJpegQuality();
    let { width, height } = canvas;
    let current = canvas;

    while (width >= 160 && height >= 90) {
        for (let nextQuality = quality; nextQuality >= 0.35; nextQuality -= 0.1) {
            const dataUrl = current.toDataURL("image/jpeg", Number(nextQuality.toFixed(2)));
            if (getDataUrlBytes(dataUrl) <= 200 * 1024) {
                return dataUrl;
            }
        }

        width = Math.max(160, Math.round(width * 0.85));
        height = Math.max(90, Math.round(height * 0.85));
        if (width === current.width && height === current.height) {
            break;
        }

        current = makeScaledCanvas(canvas, width, height);
        quality = Math.min(quality, 0.7);
    }

    return current.toDataURL("image/jpeg", 0.35);
};

export const coerceParticipantResolution = (value: unknown) => {
    if (!shouldOverrideStreamResolution() || !isObjectRecord(value)) {
        return value;
    }

    const { width, height } = getStreamConfig();
    const next = { ...value };
    if (getParticipantSize(next, "width") <= 0 && "width" in next) next.width = width;
    if (getParticipantSize(next, "height") <= 0 && "height" in next) next.height = height;
    return next;
};

export const getDisplayResolutionForLabel = (value: unknown) => {
    if (!isObjectRecord(value)) return 0;

    const height = getParticipantSize(value, "height");
    const width = getParticipantSize(value, "width");
    if (height > 0 && width > 0) {
        return Math.max(height, Math.round(width * 9 / 16));
    }

    return height;
};

export const coerceParticipantFrameRate = (value: unknown) => {
    if (!shouldOverrideStreamResolution()) return value;
    const { fps } = getStreamConfig();
    return Math.max(getPositiveNumericValue(value) ?? 0, fps);
};

export const makeSelfResolutionFromSetting = (value: unknown) => {
    const numeric = getNumericValue(value) ?? 720;
    if (numeric === 0) return { height: 0, width: 0, type: 1 };

    if (!shouldOverrideStreamResolution()) {
        return { height: numeric, width: 0, type: 0 };
    }

    const { width, height: streamHeight } = getStreamConfig();
    return {
        height: clamp(Math.round(streamHeight), 0, maxStreamHeight),
        width: clamp(Math.round(width), 0, maxStreamWidth),
        type: 0
    };
};

export const streamEnhancerRuntime = {
    shouldOverrideStreamResolution,
    getConfiguredMicBitrate,
    getMaxMicInputVolume,
    getConfiguredStreamFps,
    getConfiguredStreamWidth,
    getConfiguredStreamHeight,
    getConfiguredStreamPixelCount,
    getConfiguredStreamBitrateTarget,
    getConfiguredStreamBitrateMin,
    getConfiguredStreamBitrateMax,
    getGoLiveHdrExperimentConfig,
    getHdrCaptureMode,
    getHdrCaptureModeEnabled,
    getDefaultGoLiveSourceType,
    getDefaultGoLiveSourceTypeValue,
    getPreferredVideoCodecOrder,
    getPreferredVideoCodecName,
    getMicBuiltInEchoCancellationEnabled,
    getMicEchoCancellationEnabled,
    getMicNoiseSuppressionEnabled,
    getMicAutoGainControlEnabled,
    getMicNativeNoiseCancellationEnabled,
    getMicNativeKrispEnabled,
    getMicDtxEnabled,
    getMicFecEnabled,
    getMicForceCbrEnabled,
    getMicStereoEnabled,
    getMicGainFactor,
    getMicPacketSize,
    getMicPacketLossRate,
    getConfiguredMicOpusBitrate,
    getMicPtimeSeconds,
    getMicOpusFmtpConfig,
    applyMicCodecPreference,
    getMicTransportAutomaticGainControlConfig,
    normalizeGoLiveQualityOverride,
    getDefaultGoLiveQualityOptions,
    getPreviewUploadWidth,
    getPreviewUploadHeight,
    getPreviewJpegQuality,
    getPreviewRefreshIntervalMs,
    getPreviewRetryIntervalMs,
    getPreviewUploadDataUrl,
    applyPreviewUploadFilter,
    coerceParticipantResolution,
    getDisplayResolutionForLabel,
    coerceParticipantFrameRate,
    makeSelfResolutionFromSetting,
};
