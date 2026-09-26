/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { disableStyle, enableStyle } from "@api/Styles";
import { classNameFactory } from "@utils/css";
import { proxyLazy } from "@utils/lazy";
import { classes, sleep } from "@utils/misc";
import { findModuleId, wreq } from "@webpack";
import { ChannelStore, Flux, FluxDispatcher, React, SelectedChannelStore, UserStore, useStateFromStores } from "@webpack/common";
import type { CSSProperties } from "react";

import hiddenChannelListStyle from "./channelListHidden.css?managed";
import { applicationStreamingStore, channelRtcActions, channelRtcStore, popoutActions, popoutWindowStore, streamUiConstants, watchStream } from "./runtime";
import type { StoredAutoWatchPreferences, StreamDescriptor, StreamFitMode, StreamParticipant, StreamRtcConnectionStatePayload, StreamRtcConnectionVideoPayload, ZoomableVideoComponent, ZoomableVideoProps } from "./types";

const cl = classNameFactory("vc-stream-enhancer-");
type RenderedVideoStyle = CSSProperties & {
    "--vc-stream-enhancer-video-height"?: string;
    "--vc-stream-enhancer-video-scale"?: string;
    "--vc-stream-enhancer-video-width"?: string;
};

type RenderedStreamVideoState = {
    fit: "contain" | "cover";
    className: string | undefined;
    style: CSSProperties | undefined;
    wrapperClassName: string | undefined;
    wrapperStyle: CSSProperties | undefined;
};

const popoutOpenAttempts = 10;
const popoutOpenDelayMs = 50;
const autoWatchRetryDelayMs = 100;
const autoWatchCooldownMs = 3000;
const autoWatchPollDurationMs = 10000;
const autoWatchPollIntervalMs = 1000;
const autoWatchStoreKey = "StreamEnhancer_autoWatchUserIds";
const autoFocusStoreKey = "StreamEnhancer_autoFocusUserIds";
const autoWatchPreferencesStoreKey = "StreamEnhancer_autoWatchPreferences";
const autoWatchAllStreamsOnJoinStoreKey = "StreamEnhancer_autoWatchAllStreamsOnJoin";
const persistAutoWatchPreferencesDelayMs = 150;
const defaultRenderedStreamScale = 1;
const defaultRenderedVideoWidth = 100;
const defaultRenderedVideoHeight = 100;
const defaultRenderedVideoTintColor = 0x5865F2;
const defaultRenderedVideoTintEnabled = false;
const minRenderedStreamScale = 0.5;
const maxRenderedStreamScale = 2;
export const renderedStreamScaleStep = 0.1;
const defaultRenderedStreamBrightness = 100;
const defaultRenderedStreamContrast = 100;
const defaultRenderedStreamSaturation = 100;
const defaultRenderedStreamHue = 0;
const defaultRenderedStreamEnhanceImage = false;
export const minRenderedStreamScalePercent = Math.round(minRenderedStreamScale * 100);
export const maxRenderedStreamScalePercent = Math.round(maxRenderedStreamScale * 100);
export const minRenderedVideoSizePercent = 50;
export const maxRenderedVideoSizePercent = 200;
const defaultBottomRowOpacity = 100;
export const minBottomRowOpacityPercent = 0;
export const maxBottomRowOpacityPercent = 100;

const renderedStreamScales = new Map<string, number>();
const renderedStreamFits = new Map<string, StreamFitMode>();
const renderedVideoWidths = new Map<string, number>();
const renderedVideoHeights = new Map<string, number>();
const renderedVideoTintColors = new Map<string, number>();
const renderedVideoTintEnabled = new Map<string, boolean>();
const renderedStreamBrightnesses = new Map<string, number>();
const renderedStreamContrasts = new Map<string, number>();
const renderedStreamSaturations = new Map<string, number>();
const renderedStreamHues = new Map<string, number>();
const renderedStreamEnhanceImages = new Map<string, boolean>();
const autoWatchUserIds = new Set<string>();
const autoFocusUserIds = new Set<string>();
const autoWatchAttemptTimestamps = new Map<string, number>();

let hideBottomStreamParticipants = false;
let hideStreamChannelList = false;
let bottomRowOpacity = defaultBottomRowOpacity;
let hideControlsUntilHover = false;
let autoWatchAllStreamsOnJoin = false;
let autoWatchRetryTimeout: ReturnType<typeof setTimeout> | null = null;
let autoWatchPollTimeout: ReturnType<typeof setTimeout> | null = null;
let persistAutoWatchPreferencesTimeout: ReturnType<typeof setTimeout> | null = null;

export const renderedStreamScaleStore = proxyLazy(() => {
    const { Store } = Flux;

    class RenderedStreamScaleStore extends Store {
        declare emitChange: () => void;
        version = 0;

        getVersion() {
            return this.version;
        }

        updateScale(streamKey: string, scale: number) {
            if (scale === defaultRenderedStreamScale) renderedStreamScales.delete(streamKey);
            else renderedStreamScales.set(streamKey, scale);
            this.version++;
            this.emitChange();
        }

        updateFit(streamKey: string, fit: StreamFitMode) {
            if (fit === "contain") renderedStreamFits.delete(streamKey);
            else renderedStreamFits.set(streamKey, fit);
            this.version++;
            this.emitChange();
        }

        updateVideoWidth(streamKey: string, width: number) {
            if (width === defaultRenderedVideoWidth) renderedVideoWidths.delete(streamKey);
            else renderedVideoWidths.set(streamKey, width);
            this.version++;
            this.emitChange();
        }

        updateVideoHeight(streamKey: string, height: number) {
            if (height === defaultRenderedVideoHeight) renderedVideoHeights.delete(streamKey);
            else renderedVideoHeights.set(streamKey, height);

            this.version++;
            this.emitChange();
        }

        updateVideoTintColor(streamKey: string, color: number) {
            if (color === defaultRenderedVideoTintColor) renderedVideoTintColors.delete(streamKey);
            else renderedVideoTintColors.set(streamKey, color);
            this.version++;
            this.emitChange();
        }

        updateVideoTintEnabled(streamKey: string, enabled: boolean) {
            if (enabled === defaultRenderedVideoTintEnabled) renderedVideoTintEnabled.delete(streamKey);
            else renderedVideoTintEnabled.set(streamKey, enabled);
            this.version++;
            this.emitChange();
        }

        updateBrightness(streamKey: string, brightness: number) {
            if (brightness === defaultRenderedStreamBrightness) renderedStreamBrightnesses.delete(streamKey);
            else renderedStreamBrightnesses.set(streamKey, brightness);
            this.version++;
            this.emitChange();
        }

        updateContrast(streamKey: string, contrast: number) {
            if (contrast === defaultRenderedStreamContrast) renderedStreamContrasts.delete(streamKey);
            else renderedStreamContrasts.set(streamKey, contrast);
            this.version++;
            this.emitChange();
        }

        updateSaturation(streamKey: string, saturation: number) {
            if (saturation === defaultRenderedStreamSaturation) renderedStreamSaturations.delete(streamKey);
            else renderedStreamSaturations.set(streamKey, saturation);
            this.version++;
            this.emitChange();
        }

        updateHue(streamKey: string, hue: number) {
            if (hue === defaultRenderedStreamHue) renderedStreamHues.delete(streamKey);
            else renderedStreamHues.set(streamKey, hue);
            this.version++;
            this.emitChange();
        }

        updateEnhanceImage(streamKey: string, enabled: boolean) {
            if (enabled === defaultRenderedStreamEnhanceImage) renderedStreamEnhanceImages.delete(streamKey);
            else renderedStreamEnhanceImages.set(streamKey, enabled);
            this.version++;
            this.emitChange();
        }

        resetParticipant(streamKey: string) {
            const cleared = [
                renderedStreamScales.delete(streamKey),
                renderedStreamFits.delete(streamKey),
                renderedVideoWidths.delete(streamKey),
                renderedVideoHeights.delete(streamKey),
                renderedVideoTintColors.delete(streamKey),
                renderedVideoTintEnabled.delete(streamKey),
                renderedStreamBrightnesses.delete(streamKey),
                renderedStreamContrasts.delete(streamKey),
                renderedStreamSaturations.delete(streamKey),
                renderedStreamHues.delete(streamKey),
                renderedStreamEnhanceImages.delete(streamKey)
            ].some(Boolean);

            if (!cleared) return;

            this.version++;
            this.emitChange();
        }

        updateHideBottomParticipants(hidden: boolean) {
            hideBottomStreamParticipants = hidden;
            this.version++;
            this.emitChange();
        }

        updateHideChannelList(hidden: boolean) {
            hideStreamChannelList = hidden;
            this.version++;
            this.emitChange();
        }

        updateBottomRowOpacity(opacity: number) {
            bottomRowOpacity = opacity;
            this.version++;
            this.emitChange();
        }

        updateHideControlsUntilHover(hidden: boolean) {
            hideControlsUntilHover = hidden;
            this.version++;
            this.emitChange();
        }

        updateAutoWatchAllStreamsOnJoin(enabled: boolean) {
            autoWatchAllStreamsOnJoin = enabled;
            this.version++;
            this.emitChange();
        }
    }

    return new RenderedStreamScaleStore(FluxDispatcher);
});

export const getStreamKey = (stream: StreamDescriptor) => stream.streamKey ?? (
    stream.guildId != null
        ? `guild:${stream.guildId}:${stream.channelId}:${stream.ownerId}`
        : `call:${stream.channelId}:${stream.ownerId}`
);

export const parseStreamKey = (streamKey: string): StreamDescriptor | null => {
    const [streamType, first, second, third] = streamKey.split(":");

    if (streamType === "guild" && first && second && third) {
        return {
            streamKey,
            streamType,
            guildId: first,
            channelId: second,
            ownerId: third,
        };
    }

    if (streamType === "call" && first && second) {
        return {
            streamKey,
            streamType,
            channelId: first,
            ownerId: second,
        };
    }

    return null;
};

const getUserIdFromStreamKey = (streamKey: string | null | undefined) => {
    if (streamKey == null || streamKey === "") return null;

    return parseStreamKey(streamKey)?.ownerId ?? null;
};

export const normalizeUserId = (userId: string | bigint | null | undefined) => {
    if (userId == null) return null;
    return typeof userId === "bigint" ? userId.toString() : userId;
};

const sanitizeStoredUserIds = (value: unknown) => (
    Array.isArray(value)
        ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))]
        : []
);

export const isAutoWatchEnabledForUser = (userId: string) => autoWatchUserIds.has(userId);
export const isAutoFocusEnabledForUser = (userId: string) => autoFocusUserIds.has(userId);
export const isAutoWatchAllStreamsOnJoinEnabled = () => autoWatchAllStreamsOnJoin;

const shouldAutoWatchConfiguredStreamForUser = (userId: string) => (
    isAutoWatchEnabledForUser(userId) || isAutoFocusEnabledForUser(userId)
);

const persistAutoWatchPreferences = () => DataStore.set(autoWatchPreferencesStoreKey, {
    autoWatchUserIds: [...autoWatchUserIds],
    autoFocusUserIds: [...autoFocusUserIds],
    autoWatchAllStreamsOnJoin
} satisfies StoredAutoWatchPreferences);

const schedulePersistAutoWatchPreferences = () => {
    if (persistAutoWatchPreferencesTimeout != null) clearTimeout(persistAutoWatchPreferencesTimeout);

    persistAutoWatchPreferencesTimeout = setTimeout(() => {
        persistAutoWatchPreferencesTimeout = null;
        void persistAutoWatchPreferences();
    }, persistAutoWatchPreferencesDelayMs);
};

export const loadAutoWatchPreferences = async () => {
    const storedPreferences = await DataStore.get<StoredAutoWatchPreferences>(autoWatchPreferencesStoreKey);
    let savedAutoWatchUserIds: unknown = storedPreferences?.autoWatchUserIds;
    let savedAutoFocusUserIds: unknown = storedPreferences?.autoFocusUserIds;
    let savedAutoWatchAllStreamsOnJoin: unknown = storedPreferences?.autoWatchAllStreamsOnJoin;

    if (savedAutoWatchUserIds == null && savedAutoFocusUserIds == null && savedAutoWatchAllStreamsOnJoin == null) {
        [savedAutoWatchUserIds, savedAutoFocusUserIds, savedAutoWatchAllStreamsOnJoin] = await Promise.all([
            DataStore.get<string[]>(autoWatchStoreKey),
            DataStore.get<string[]>(autoFocusStoreKey),
            DataStore.get<boolean>(autoWatchAllStreamsOnJoinStoreKey)
        ]);
    }

    autoWatchUserIds.clear();
    autoFocusUserIds.clear();

    sanitizeStoredUserIds(savedAutoWatchUserIds).forEach(userId => autoWatchUserIds.add(userId));
    sanitizeStoredUserIds(savedAutoFocusUserIds).forEach(userId => autoFocusUserIds.add(userId));
    autoWatchAllStreamsOnJoin = savedAutoWatchAllStreamsOnJoin === true;
    renderedStreamScaleStore.updateAutoWatchAllStreamsOnJoin(autoWatchAllStreamsOnJoin);
};

const setAutoWatchPreferencesForUser = (userId: string, options: { watch: boolean; focus: boolean; }) => {
    if (options.watch) autoWatchUserIds.add(userId);
    else autoWatchUserIds.delete(userId);

    if (options.focus) autoFocusUserIds.add(userId);
    else autoFocusUserIds.delete(userId);

    schedulePersistAutoWatchPreferences();
};

export const setAutoWatchEnabledForUser = (userId: string, enabled: boolean) => setAutoWatchPreferencesForUser(userId, {
    watch: enabled,
    focus: enabled && autoFocusUserIds.has(userId)
});

export const setAutoFocusEnabledForUser = (userId: string, enabled: boolean) => {
    setAutoWatchPreferencesForUser(userId, {
        watch: autoWatchUserIds.has(userId),
        focus: enabled
    });
};

export const setAutoWatchAllStreamsOnJoinEnabled = (enabled: boolean) => {
    if (autoWatchAllStreamsOnJoin === enabled) return;

    renderedStreamScaleStore.updateAutoWatchAllStreamsOnJoin(enabled);
    schedulePersistAutoWatchPreferences();

    if (enabled) pollAutoWatchConfiguredStreams();
};

export const openFullscreenStream = async (stream: StreamDescriptor) => {
    if (watchStream == null || popoutActions == null || channelRtcActions == null || streamUiConstants == null) return;

    const channel = ChannelStore.getChannel(stream.channelId);
    if (channel == null) return;

    watchStream(stream, {
        forceFocus: false,
        forceMultiple: true,
        noFocus: true,
    });

    popoutActions.openChannelCallPopout(channel);

    for (let attempt = 0; attempt < popoutOpenAttempts; attempt++) {
        if (popoutWindowStore?.getWindowOpen?.(streamUiConstants.MLl.CHANNEL_CALL_POPOUT)) break;
        await sleep(popoutOpenDelayMs);
    }

    channelRtcActions.selectParticipant(stream.channelId, getStreamKey(stream));
    channelRtcActions.updateLayout(stream.channelId, streamUiConstants.DUB.FULL_SCREEN, streamUiConstants.BRT.POPOUT);
};

const isCurrentClientWatchingEligibleStream = (stream: StreamDescriptor) => {
    const currentVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
    return currentVoiceChannelId != null && currentVoiceChannelId === stream.channelId;
};

const autoWatchConfiguredStream = (userId: string | bigint | null | undefined) => {
    const normalizedUserId = normalizeUserId(userId);
    if (normalizedUserId == null || watchStream == null || !shouldAutoWatchConfiguredStreamForUser(normalizedUserId)) return;

    const stream = applicationStreamingStore?.getAnyStreamForUser?.(normalizedUserId);
    if (stream == null || !isCurrentClientWatchingEligibleStream(stream)) return;

    const streamKey = getStreamKey(stream);
    const lastAttemptAt = autoWatchAttemptTimestamps.get(streamKey) ?? 0;
    if (Date.now() - lastAttemptAt < autoWatchCooldownMs) return;

    autoWatchAttemptTimestamps.set(streamKey, Date.now());

    const shouldFocus = isAutoFocusEnabledForUser(normalizedUserId);
    watchStream(stream, {
        forceFocus: shouldFocus,
        forceMultiple: true,
        noFocus: !shouldFocus,
    });

    if (shouldFocus) channelRtcActions?.selectParticipant(stream.channelId, streamKey);
};

const autoWatchActiveStreamsInCurrentChannel = () => {
    if (!autoWatchAllStreamsOnJoin || watchStream == null) return;

    const currentVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
    if (currentVoiceChannelId == null) return;

    const currentUserId = normalizeUserId(UserStore.getCurrentUser()?.id);
    const activeStreams = applicationStreamingStore?.getAllActiveStreamsForChannel?.(currentVoiceChannelId)
        ?? applicationStreamingStore?.getAllActiveStreams?.().filter(stream => stream.channelId === currentVoiceChannelId)
        ?? [];

    for (const stream of activeStreams) {
        if (!isCurrentClientWatchingEligibleStream(stream)) continue;
        if (currentUserId != null && normalizeUserId(stream.ownerId) === currentUserId) continue;

        const streamKey = getStreamKey(stream);
        const lastAttemptAt = autoWatchAttemptTimestamps.get(streamKey) ?? 0;
        if (Date.now() - lastAttemptAt < autoWatchCooldownMs) continue;

        autoWatchAttemptTimestamps.set(streamKey, Date.now());
        watchStream(stream, {
            forceFocus: false,
            forceMultiple: true,
            noFocus: true,
        });
    }
};

const autoWatchConfiguredStreams = () => {
    autoWatchActiveStreamsInCurrentChannel();

    const configuredUserIds = new Set<string>([...autoWatchUserIds, ...autoFocusUserIds]);
    configuredUserIds.forEach(userId => autoWatchConfiguredStream(userId));
};

const scheduleAutoWatchConfiguredStreams = () => {
    if (autoWatchRetryTimeout != null) clearTimeout(autoWatchRetryTimeout);

    autoWatchRetryTimeout = setTimeout(() => {
        autoWatchRetryTimeout = null;
        void loadAutoWatchPreferences().then(autoWatchConfiguredStreams);
    }, autoWatchRetryDelayMs);
};

export const handleRtcStreamConnection = (payload: StreamRtcConnectionVideoPayload | StreamRtcConnectionStatePayload) => {
    if (payload.context !== "stream") return;

    const userId = payload.type === "RTC_CONNECTION_VIDEO"
        ? payload.userId ?? null
        : getUserIdFromStreamKey(payload.streamKey);

    autoWatchConfiguredStream(userId);
    pollAutoWatchConfiguredStreams();
};

const clearAutoWatchPoll = () => {
    if (autoWatchPollTimeout == null) return;

    clearTimeout(autoWatchPollTimeout);
    autoWatchPollTimeout = null;
};

export const pollAutoWatchConfiguredStreams = (deadline = Date.now() + autoWatchPollDurationMs) => {
    clearAutoWatchPoll();

    void loadAutoWatchPreferences().then(() => {
        autoWatchConfiguredStreams();

        if (Date.now() >= deadline) return;

        autoWatchPollTimeout = setTimeout(() => {
            autoWatchPollTimeout = null;
            pollAutoWatchConfiguredStreams(deadline);
        }, autoWatchPollIntervalMs);
    });
};

export const startAutoWatch = () => {
    applicationStreamingStore?.addChangeListener?.(scheduleAutoWatchConfiguredStreams);
    channelRtcStore?.addChangeListener?.(scheduleAutoWatchConfiguredStreams);
    FluxDispatcher.subscribe("RTC_CONNECTION_VIDEO", handleRtcStreamConnection);
    FluxDispatcher.subscribe("RTC_CONNECTION_STATE", handleRtcStreamConnection);
    FluxDispatcher.subscribe("STREAM_CREATE", scheduleAutoWatchConfiguredStreams);
    FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", scheduleAutoWatchConfiguredStreams);
    FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", pollAutoWatchConfiguredStreams);
    pollAutoWatchConfiguredStreams();
};

export const stopAutoWatch = () => {
    applicationStreamingStore?.removeChangeListener?.(scheduleAutoWatchConfiguredStreams);
    channelRtcStore?.removeChangeListener?.(scheduleAutoWatchConfiguredStreams);
    FluxDispatcher.unsubscribe("RTC_CONNECTION_VIDEO", handleRtcStreamConnection);
    FluxDispatcher.unsubscribe("RTC_CONNECTION_STATE", handleRtcStreamConnection);
    FluxDispatcher.unsubscribe("STREAM_CREATE", scheduleAutoWatchConfiguredStreams);
    FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", scheduleAutoWatchConfiguredStreams);
    FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", pollAutoWatchConfiguredStreams);

    if (autoWatchRetryTimeout != null) {
        clearTimeout(autoWatchRetryTimeout);
        autoWatchRetryTimeout = null;
    }

    if (persistAutoWatchPreferencesTimeout != null) {
        clearTimeout(persistAutoWatchPreferencesTimeout);
        persistAutoWatchPreferencesTimeout = null;
        void persistAutoWatchPreferences();
    }

    clearAutoWatchPoll();
};

export const isStreamParticipant = (participant?: StreamParticipant | null): participant is StreamParticipant & { id: string; } => {
    const streamKey = participant?.id;
    return typeof streamKey === "string" && (streamKey.startsWith("guild:") || streamKey.startsWith("call:"));
};

export const isCameraParticipant = (participant?: StreamParticipant | null): participant is StreamParticipant & { id: string; } => {
    const participantId = participant?.id;
    return typeof participantId === "string"
        && participantId !== ""
        && participant != null
        && !isStreamParticipant(participant)
        && normalizeUserId(participant.user?.id) === participantId;
};

export const isMediaParticipant = (participant?: StreamParticipant | null): participant is StreamParticipant & { id: string; } => {
    return isStreamParticipant(participant) || isCameraParticipant(participant);
};

export const getParticipantMediaLabel = (participant: StreamParticipant) => isStreamParticipant(participant) ? "stream" : "camera";
const hasStreamKey = (streamKey?: string | null): streamKey is string => streamKey != null && streamKey !== "";
const getMediaStreamKey = (participant?: StreamParticipant | null) => isMediaParticipant(participant) ? participant.id : null;
const readStreamValue = <T>(streamKey: string | null | undefined, values: Map<string, T>, fallback: T) => hasStreamKey(streamKey) ? values.get(streamKey) ?? fallback : fallback;

const getRenderedStreamScale = (streamKey?: string | null) => {
    return readStreamValue(streamKey, renderedStreamScales, defaultRenderedStreamScale);
};

export const getRenderedStreamFitMode = (streamKey?: string | null) => {
    return readStreamValue(streamKey, renderedStreamFits, "contain" as const);
};

const getRenderedStreamBrightness = (streamKey?: string | null) => {
    return readStreamValue(streamKey, renderedStreamBrightnesses, defaultRenderedStreamBrightness);
};

const getRenderedStreamEnhanceImageEnabled = (streamKey?: string | null) => readStreamValue(streamKey, renderedStreamEnhanceImages, defaultRenderedStreamEnhanceImage);
export const isRenderedStreamEnhanceImageEnabled = getRenderedStreamEnhanceImageEnabled;

export const openFullscreenParticipant = async (participant?: StreamParticipant | null) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    const stream = parseStreamKey(streamKey);
    if (stream == null) return;

    await openFullscreenStream(stream);
};

export const setRenderedStreamScale = (participant: StreamParticipant | null | undefined, scale: number) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    const nextScale = Math.min(maxRenderedStreamScale, Math.max(minRenderedStreamScale, Number(scale.toFixed(2))));
    renderedStreamScaleStore.updateScale(streamKey, nextScale);
    applyStreamScaleToDom(streamKey);
};

export const resizeRenderedStream = (participant: StreamParticipant | null | undefined, delta: number) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    setRenderedStreamScale(participant, getRenderedStreamScale(streamKey) + delta);
};

export const setRenderedStreamFit = (participant: StreamParticipant | null | undefined, fit: StreamFitMode) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    renderedStreamScaleStore.updateFit(streamKey, fit);
    applyStreamFitToDom(streamKey);
};

// ---------------------------------------------------------------------------
// Direct DOM fit application
//
// Threading the fit mode into Discord's VideoStream relies on minified webpack
// regexes; if any of them stop matching, the mode silently never reaches the
// DOM. To make the fit button dependable we also apply object-fit straight onto
// the <video> element, found by walking up from the fit button's own DOM anchor.
// An inline !important declaration wins over any stylesheet rule, so this works
// no matter which classes Discord happens to render.
// ---------------------------------------------------------------------------

const getStreamFitObjectFit = (mode: StreamFitMode) =>
    mode === "cover" ? "cover" : mode === "stretch" ? "fill" : "contain";

const streamFitAnchors = new Map<string, HTMLElement>();

// Opt-in diagnostics: run localStorage.setItem("vc-stream-enhancer-debug-fit", "1")
// in the Discord console to log every applied fit mode and the video element found.
const isStreamFitDebugEnabled = () => typeof localStorage !== "undefined"
    && localStorage.getItem("vc-stream-enhancer-debug-fit") === "1";

const findVideoFromAnchor = (anchor: HTMLElement): HTMLVideoElement | null => {
    // The fit button renders inside the stream tile, so the <video> lives in one
    // of its ancestors. Walk up until an ancestor contains one.
    let node: HTMLElement | null = anchor;

    for (let depth = 0; node != null && depth < 12; depth++) {
        const video = node.querySelector<HTMLVideoElement>("video");
        if (video) return video;
        node = node.parentElement;
    }

    return null;
};

const applyStreamFitToVideo = (streamKey: string) => {
    const anchor = streamFitAnchors.get(streamKey);
    if (anchor?.isConnected !== true) return;

    const mode = getRenderedStreamFitMode(streamKey);
    const objectFit = getStreamFitObjectFit(mode);

    // Re-resolve every time: Discord recreates the <video> element when the
    // stream quality or fit changes, which would orphan a cached reference.
    const video = findVideoFromAnchor(anchor);
    if (!video) {
        if (isStreamFitDebugEnabled()) console.warn(`[StreamEnhancer] no <video> found above anchor for ${streamKey}`);
        return;
    }

    video.style.setProperty("object-fit", objectFit, "important");
    video.dataset.vcStreamFit = mode;

    if (isStreamFitDebugEnabled()) console.log(`[StreamEnhancer] fit ${streamKey} -> ${mode} (${objectFit})`);
};

export const applyStreamFitToDom = (streamKey?: string | null) => {
    if (!hasStreamKey(streamKey)) return;

    applyStreamFitToVideo(streamKey);

    if (streamFitAnchors.size > 0) ensureSharedFitObserver();
};

// Applies the + / - scale directly to the DOM. Like the fit handling above this
// bypasses the webpack patches, which are not applying on the current Discord build.
// Scaling the wrapper element (not the <video>) keeps the black background frame in
// step with the picture, matching what the transform-based implementation did.
const applyStreamScaleToVideo = (streamKey: string) => {
    const anchor = streamFitAnchors.get(streamKey);
    if (anchor?.isConnected !== true) return;

    const video = findVideoFromAnchor(anchor);
    const target = video?.parentElement ?? null;
    if (!target) return;

    const scale = getRenderedStreamScale(streamKey);
    const videoWidth = renderedVideoWidths.get(streamKey) ?? defaultRenderedVideoWidth;
    const videoHeight = renderedVideoHeights.get(streamKey) ?? defaultRenderedVideoHeight;
    const sx = (videoWidth / 100) * scale;
    const sy = (videoHeight / 100) * scale;

    target.style.setProperty("transform", `scaleX(${sx}) scaleY(${sy})`, "important");
    target.style.setProperty("transform-origin", "center center", "important");
    target.dataset.vcStreamScale = String(scale);

    if (isStreamFitDebugEnabled()) console.log(`[StreamEnhancer] scale ${streamKey} -> ${scale}`);
};

export const applyStreamScaleToDom = (streamKey?: string | null) => {
    if (!hasStreamKey(streamKey)) return;
    applyStreamScaleToVideo(streamKey);

    if (streamFitAnchors.size > 0) ensureSharedFitObserver();
};

// One shared document observer instead of one per stream. Discord recreates the
// <video> whenever stream quality changes, which drops any inline style we set,
// so re-apply on DOM mutations. Keys whose anchor has been removed are pruned
// so this cannot grow unbounded.
let sharedFitObserver: MutationObserver | null = null;

function ensureSharedFitObserver() {
    if (sharedFitObserver || typeof MutationObserver === "undefined") return;

    sharedFitObserver = new MutationObserver(() => {
        for (const [streamKey, anchor] of streamFitAnchors) {
            if (anchor.isConnected) {
                applyStreamFitToVideo(streamKey);
                applyStreamScaleToVideo(streamKey);
            } else {
                streamFitAnchors.delete(streamKey);
            }
        }

        if (streamFitAnchors.size === 0) {
            sharedFitObserver?.disconnect();
            sharedFitObserver = null;
        }
    });

    sharedFitObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style"],
        childList: true,
        subtree: true
    });
}

export const setStreamFitAnchor = (streamKey: string | null | undefined, element: HTMLElement | null) => {
    if (!hasStreamKey(streamKey)) {
        if (isStreamFitDebugEnabled()) console.warn(`[StreamEnhancer] setStreamFitAnchor rejected key: ${JSON.stringify(streamKey)}`);
        return;
    }

    if (element) {
        streamFitAnchors.set(streamKey, element);
        if (isStreamFitDebugEnabled()) {
            const video = findVideoFromAnchor(element);
            console.log(`[StreamEnhancer] anchor set for ${streamKey}; video found:`, video ?? "NONE");
        }
        applyStreamFitToDom(streamKey);
    } else {
        streamFitAnchors.delete(streamKey);
    }
};

// Reports which link in the fit chain is broken, so we stop guessing.
// Call from the console: __vcStreamEnhancerFitDebug()
export const debugStreamFitChain = () => {
    const report = {
        anchors: streamFitAnchors.size,
        observerActive: sharedFitObserver != null,
        entries: [] as unknown[]
    };

    for (const [streamKey, anchor] of streamFitAnchors) {
        const video = findVideoFromAnchor(anchor);
        const mode = getRenderedStreamFitMode(streamKey);

        // If the video's intrinsic aspect ratio matches its container's, then
        // contain/cover/stretch are visually identical and there is nothing to see.
        const container = video?.parentElement ?? null;
        const containerBox = container?.getBoundingClientRect();
        const containerRatio = containerBox && containerBox.height > 0
            ? containerBox.width / containerBox.height
            : null;
        const videoRatio = video && video.videoWidth > 0 && video.videoHeight > 0
            ? video.videoWidth / video.videoHeight
            : null;

        report.entries.push({
            streamKey,
            mode,
            expectedObjectFit: getStreamFitObjectFit(mode),
            anchorConnected: anchor.isConnected,
            anchorTag: anchor.tagName,
            anchorClasses: anchor.className,
            videoFound: video != null,
            videoInlineObjectFit: video?.style.getPropertyValue("object-fit") ?? null,
            videoDataAttr: video?.dataset.vcStreamFit ?? null,
            videoComputedObjectFit: video != null ? getComputedStyle(video).objectFit : null,
            scale: getRenderedStreamScale(streamKey),
            scaleAppliedTransform: video?.parentElement != null
                ? getComputedStyle(video.parentElement).transform
                : null,
            scaleDataAttr: video?.parentElement?.dataset.vcStreamScale ?? null,
            videoIntrinsicSize: video ? `${video.videoWidth}x${video.videoHeight}` : null,
            containerSize: containerBox ? `${Math.round(containerBox.width)}x${Math.round(containerBox.height)}` : null,
            videoAspectRatio: videoRatio?.toFixed(3) ?? null,
            containerAspectRatio: containerRatio?.toFixed(3) ?? null,
            ratiosMatch: videoRatio != null && containerRatio != null
                ? Math.abs(videoRatio - containerRatio) < 0.02
                : null
        });
    }

    console.log("[StreamEnhancer] fit chain report", report);
    return report;
};

export const setRenderedVideoWidth = (participant: StreamParticipant | null | undefined, width: number) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    const nextWidth = Math.min(maxRenderedVideoSizePercent, Math.max(minRenderedVideoSizePercent, Number(width.toFixed(0))));
    renderedStreamScaleStore.updateVideoWidth(streamKey, nextWidth);
};

export const setRenderedVideoHeight = (participant: StreamParticipant | null | undefined, height: number) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    const nextHeight = Math.min(maxRenderedVideoSizePercent, Math.max(minRenderedVideoSizePercent, Number(height.toFixed(0))));
    renderedStreamScaleStore.updateVideoHeight(streamKey, nextHeight);
};

export const setRenderedVideoTintColor = (participant: StreamParticipant | null | undefined, color: number) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    renderedStreamScaleStore.updateVideoTintColor(streamKey, color);
};

export const setRenderedVideoTintEnabled = (participant: StreamParticipant | null | undefined, enabled: boolean) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    renderedStreamScaleStore.updateVideoTintEnabled(streamKey, enabled);
};

export const setRenderedStreamBrightness = (participant: StreamParticipant | null | undefined, brightness: number) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    const nextBrightness = Math.min(200, Math.max(25, Number(brightness.toFixed(0))));
    renderedStreamScaleStore.updateBrightness(streamKey, nextBrightness);
};

export const resetRenderedParticipant = (participant: StreamParticipant | null | undefined) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    renderedStreamScaleStore.resetParticipant(streamKey);
};

export const useRenderedStreamWidth = (participant: StreamParticipant | null | undefined, width: number) => {
    const streamKey = participant?.id;
    const scale = useStateFromStores([renderedStreamScaleStore], () => getRenderedStreamScale(streamKey), [streamKey]);

    return Math.round(width * scale);
};

export const useRenderedWidthFromProps = (
    props: { participant?: StreamParticipant | null | undefined; } | null | undefined,
    width: number
) => useRenderedStreamWidth(props?.participant, width);

export const useRenderedStreamScaleVersion = () => useStateFromStores([renderedStreamScaleStore], () => renderedStreamScaleStore.getVersion());

export const getRenderedStreamTileStyle = (
    participant: StreamParticipant | null | undefined,
    style: CSSProperties | undefined,
    width: number
) => {
    return style;
};

export const getVideoGridTileStyle = (style: CSSProperties | undefined, key: unknown) => {
    return style;
};

export const getSelectedStreamWidth = (participant: StreamParticipant | null | undefined, width: number) => {
    if (!isMediaParticipant(participant)) return width;

    return Math.round(width * getRenderedStreamScale(participant.id));
};

const normalizeStreamFit = (fit: unknown): "contain" | "cover" => fit === "cover" ? "cover" : "contain";

export const getRenderedStreamFit = (streamKey: string | null | undefined, fit: unknown) => {
    const mode = getRenderedStreamFitMode(streamKey);
    return mode === "contain" ? normalizeStreamFit(fit) : "cover";
};

/**
 * Returns the className for the video__48b20 div.
 * `className` is Discord's own class and MUST be preserved, otherwise the video
 * loses its layout styles and every fit mode renders identically.
 * The selected fit mode is encoded as video-contain/video-cover/video-stretch so
 * the stylesheet can force the matching object-fit on the <video> element.
 */
export const getRenderedStreamVideoClassName = (
    streamKey: string | null | undefined,
    className?: string
) => {
    return classes(className, cl(`video-${getRenderedStreamFitMode(streamKey)}`));
};

// Merges Discord's own className with the fit class produced by the hook.
// The patches capture Discord's class but not the stream key, so the mode class
// has to come from vcState.className (which was resolved with the correct key).
export const mergeRenderedStreamVideoClassName = (
    className?: string,
    modeClassName?: string
) => {
    return classes(className, modeClassName) || undefined;
};

// Returns the className to inject into VideoStream's wrapperClassName prop.
// This targets the wrapper__48b20 div (the black background frame), which wraps
// the video element. CSS selectors inside these classes reach the <video> tag.
// A mode class is always emitted (including for "contain") so switching away
// from cover/stretch reliably clears the previous mode's object-fit override.
export const getRenderedStreamWrapperClassName = (streamKey: string | null | undefined) => {
    const mode = getRenderedStreamFitMode(streamKey);
    const scale = getRenderedStreamScale(streamKey);
    const videoWidth = renderedVideoWidths.get(streamKey ?? "") ?? defaultRenderedVideoWidth;
    const videoHeight = renderedVideoHeights.get(streamKey ?? "") ?? defaultRenderedVideoHeight;
    const hasCustomSize = scale !== defaultRenderedStreamScale || videoWidth !== defaultRenderedVideoWidth || videoHeight !== defaultRenderedVideoHeight;

    return classes(
        cl(`wrapper-${mode}`),
        hasCustomSize && cl("wrapper-scaled")
    ) || undefined;
};

export const getRenderedMediaWrapperClassName = (className?: string, streamKeyClassName?: string) => classes(className, streamKeyClassName);

// Returns the style to inject into VideoStream's wrapper div. Only carries our
// own CSS variables (scale/width/height) so other callers' styles are untouched.
export const getRenderedMediaWrapperStyle = (style?: CSSProperties, wrapperStyle?: CSSProperties): CSSProperties | undefined => {
    if (!style || !Object.keys(style).some(key => key.startsWith("--vc-stream-enhancer-video"))) return wrapperStyle;
    return { ...style, ...(wrapperStyle ?? undefined) };
};

// Returns the CSS transform to scale the wrapper__48b20 frame.
// scaleX/scaleY resize the visible black background and video together.
export const getRenderedStreamWrapperStyle = (streamKey: string | null | undefined): CSSProperties | undefined => {
    if (!hasStreamKey(streamKey)) return undefined;

    const scale = getRenderedStreamScale(streamKey);
    const videoWidth = renderedVideoWidths.get(streamKey) ?? defaultRenderedVideoWidth;
    const videoHeight = renderedVideoHeights.get(streamKey) ?? defaultRenderedVideoHeight;
    const hasCustomSize = scale !== defaultRenderedStreamScale
        || videoWidth !== defaultRenderedVideoWidth
        || videoHeight !== defaultRenderedVideoHeight;

    if (!hasCustomSize) return undefined;

    const sx = (videoWidth / 100) * scale;
    const sy = (videoHeight / 100) * scale;
    return { transform: `scaleX(${sx}) scaleY(${sy})`, transformOrigin: "center center" };
};

export const getRenderedStreamVideoStyle = (streamKey: string | null | undefined) => {
    if (!hasStreamKey(streamKey)) return undefined;

    const videoTintColor = renderedVideoTintColors.get(streamKey) ?? defaultRenderedVideoTintColor;
    const videoTintIsEnabled = renderedVideoTintEnabled.get(streamKey) ?? defaultRenderedVideoTintEnabled;
    const brightness = getRenderedStreamBrightness(streamKey);
    const contrast = getRenderedStreamContrastPercent(streamKey);
    const saturation = getRenderedStreamSaturationPercent(streamKey);
    const hue = getRenderedStreamHueDegrees(streamKey);
    const enhanceImage = getRenderedStreamEnhanceImageEnabled(streamKey);
    const scale = getRenderedStreamScale(streamKey);
    const videoWidth = renderedVideoWidths.get(streamKey) ?? defaultRenderedVideoWidth;
    const videoHeight = renderedVideoHeights.get(streamKey) ?? defaultRenderedVideoHeight;
    const style: RenderedVideoStyle = {};

    if (scale !== defaultRenderedStreamScale) style["--vc-stream-enhancer-video-scale"] = String(scale);
    if (videoWidth !== defaultRenderedVideoWidth) style["--vc-stream-enhancer-video-width"] = `${videoWidth}%`;
    if (videoHeight !== defaultRenderedVideoHeight) style["--vc-stream-enhancer-video-height"] = `${videoHeight}%`;

    const filters: string[] = [];
    if (brightness !== defaultRenderedStreamBrightness) filters.push(`brightness(${brightness}%)`);
    if (contrast !== defaultRenderedStreamContrast) filters.push(`contrast(${contrast}%)`);
    if (saturation !== defaultRenderedStreamSaturation) filters.push(`saturate(${saturation}%)`);
    if (hue !== defaultRenderedStreamHue) filters.push(`hue-rotate(${hue}deg)`);

    if (videoTintIsEnabled) {
        const red = (videoTintColor >> 16) & 255;
        const green = (videoTintColor >> 8) & 255;
        const blue = videoTintColor & 255;
        const normalizedRed = red / 255;
        const normalizedGreen = green / 255;
        const normalizedBlue = blue / 255;
        const maxChannel = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
        const minChannel = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
        const chroma = maxChannel - minChannel;
        const lightness = (maxChannel + minChannel) / 2;
        const saturationValue = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
        let tintHue = 0;

        if (chroma !== 0) {
            if (maxChannel === normalizedRed) tintHue = ((normalizedGreen - normalizedBlue) / chroma) % 6;
            else if (maxChannel === normalizedGreen) tintHue = (normalizedBlue - normalizedRed) / chroma + 2;
            else tintHue = (normalizedRed - normalizedGreen) / chroma + 4;
        }

        const hueDegrees = Math.round(tintHue * 60 < 0 ? tintHue * 60 + 360 : tintHue * 60);
        const tintBrightness = Math.max(45, Math.round(65 + lightness * 35));
        const tintSaturation = Math.max(150, Math.round(200 + saturationValue * 500));

        filters.push("grayscale(1)");
        filters.push("sepia(1)");
        filters.push(`saturate(${tintSaturation}%)`);
        filters.push(`hue-rotate(${hueDegrees}deg)`);
        filters.push(`brightness(${tintBrightness}%)`);
    }

    if (enhanceImage) {
        filters.push("brightness(114%)");
        filters.push("contrast(118%)");
        filters.push("saturate(126%)");
        filters.push("drop-shadow(0 0 0.35rem rgb(255 255 255 / 0.16))");
    }

    if (filters.length > 0) style.filter = filters.join(" ");

    return Object.keys(style).length > 0 ? style : undefined;
};

export const getRenderedFrameStyle = (streamKey: string | null | undefined) => {
    // This is kept for compatibility but is no longer used for fit/size.
    // Cover/stretch/size are applied via wrapperClassName on the VideoStream component.
    if (!hasStreamKey(streamKey)) return undefined;

    const scale = getRenderedStreamScale(streamKey);
    if (scale === defaultRenderedStreamScale) return undefined;

    return {
        width: "100%",
        maxWidth: "100%",
        flexShrink: 0,
        marginLeft: "auto",
        marginRight: "auto"
    } satisfies CSSProperties;
};

const getZoomableVideoComponent = () => {
    if (wreq?.m == null) return null;

    const zoomableVideoModuleId = findModuleId(
        "--custom-zoom-scale",
        "transform 0.15s ease-out"
    );

    if (zoomableVideoModuleId == null) return null;

    return (wreq(zoomableVideoModuleId as number | string | symbol) as { A?: ZoomableVideoComponent | null; } | null)?.A ?? null;
};

export const renderZoomableCameraVideo = (props: ZoomableVideoProps, key: string | number | bigint | null | undefined) => {
    const ZoomableVideo = getZoomableVideoComponent();
    if (ZoomableVideo == null) return null;

    return React.createElement(ZoomableVideo, { ...props, key: key == null ? undefined : String(key) });
};

// useStateFromStores compares results with reference equality by default, which would
// re-render on every store change because the mapper builds a new object each call.
// Compare by value instead so the component only re-renders when something really changed.
const isSameStyle = (a: CSSProperties | undefined, b: CSSProperties | undefined) => {
    if (a === b) return true;
    if (a == null || b == null) return false;

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every(key => a[key as keyof CSSProperties] === b[key as keyof CSSProperties]);
};

const renderedStreamVideoStateEqual = (a: RenderedStreamVideoState, b: RenderedStreamVideoState) =>
    a.fit === b.fit
    && a.className === b.className
    && a.wrapperClassName === b.wrapperClassName
    && isSameStyle(a.style, b.style)
    && isSameStyle(a.wrapperStyle, b.wrapperStyle);

export const useRenderedStreamVideoState = (streamKey: string | null | undefined, fit: unknown) => useStateFromStores(
    [renderedStreamScaleStore],
    () => {
        const mode = getRenderedStreamFitMode(streamKey);
        const normalizedFit = normalizeStreamFit(fit);

        const state: RenderedStreamVideoState = {
            // "contain" keeps Discord's own fit; "cover" and "stretch" both ask Discord for
            // the cover layout, and "stretch" is then forced to object-fit:fill by our CSS.
            fit: mode === "contain" ? normalizedFit : "cover",
            // className goes on the video__48b20 div. Discord's own class is merged in by the
            // patches; this adds the video-<mode> class that drives object-fit.
            className: getRenderedStreamVideoClassName(streamKey),
            // style carries filter effects only (object-fit handled by CSS classes)
            style: getRenderedStreamVideoStyle(streamKey),
            // wrapperClassName goes on the wrapper__48b20 div (the black background frame)
            wrapperClassName: getRenderedStreamWrapperClassName(streamKey),
            // wrapperStyle carries the transform:scale for width/height sliders
            wrapperStyle: getRenderedStreamWrapperStyle(streamKey)
        };

        return state;
    },
    [streamKey, fit],
    renderedStreamVideoStateEqual
);

export const getRenderedStreamFitLabel = (streamKey?: string | null) => {
    const mode = getRenderedStreamFitMode(streamKey);

    if (mode === "cover") return "Cover";
    if (mode === "stretch") return "Stretch";
    return "Contain";
};

export const getRenderedStreamScalePercent = (streamKey?: string | null) => Math.round(getRenderedStreamScale(streamKey) * 100);
export const getRenderedVideoWidthPercent = (streamKey?: string | null) => Math.round(readStreamValue(streamKey, renderedVideoWidths, defaultRenderedVideoWidth));
export const getRenderedVideoHeightPercent = (streamKey?: string | null) => Math.round(readStreamValue(streamKey, renderedVideoHeights, defaultRenderedVideoHeight));
export const getRenderedVideoTintColor = (streamKey?: string | null) => readStreamValue(streamKey, renderedVideoTintColors, defaultRenderedVideoTintColor);
export const isRenderedVideoTintEnabled = (streamKey?: string | null) => readStreamValue(streamKey, renderedVideoTintEnabled, defaultRenderedVideoTintEnabled);
export const getRenderedStreamBrightnessPercent = (streamKey?: string | null) => Math.round(getRenderedStreamBrightness(streamKey));
export const getRenderedStreamContrastPercent = (streamKey?: string | null) => Math.round(readStreamValue(streamKey, renderedStreamContrasts, defaultRenderedStreamContrast));
export const getRenderedStreamSaturationPercent = (streamKey?: string | null) => Math.round(readStreamValue(streamKey, renderedStreamSaturations, defaultRenderedStreamSaturation));
export const getRenderedStreamHueDegrees = (streamKey?: string | null) => Math.round(readStreamValue(streamKey, renderedStreamHues, defaultRenderedStreamHue));

export const setRenderedStreamContrast = (participant: StreamParticipant | null | undefined, contrast: number) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    const nextContrast = Math.min(200, Math.max(25, Number(contrast.toFixed(0))));
    renderedStreamScaleStore.updateContrast(streamKey, nextContrast);
};

export const setRenderedStreamSaturation = (participant: StreamParticipant | null | undefined, saturation: number) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    const nextSaturation = Math.min(200, Math.max(0, Number(saturation.toFixed(0))));
    renderedStreamScaleStore.updateSaturation(streamKey, nextSaturation);
};

export const setRenderedStreamHue = (participant: StreamParticipant | null | undefined, hue: number) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    const nextHue = Math.min(180, Math.max(-180, Number(hue.toFixed(0))));
    renderedStreamScaleStore.updateHue(streamKey, nextHue);
};

export const setRenderedStreamEnhanceImage = (participant: StreamParticipant | null | undefined, enabled: boolean) => {
    const streamKey = getMediaStreamKey(participant);
    if (!streamKey) return;

    renderedStreamScaleStore.updateEnhanceImage(streamKey, enabled);
};

export const shouldHideBottomStreamParticipants = () => hideBottomStreamParticipants;
export const shouldHideChannelList = () => hideStreamChannelList;
export const getBottomRowOpacity = () => bottomRowOpacity;
export const shouldHideControlsUntilHover = () => hideControlsUntilHover;

export const getShowStreamParticipants = (showParticipants: boolean) => hideBottomStreamParticipants ? false : showParticipants;

const shouldCenterSelectedStream = () => hideBottomStreamParticipants && !hideStreamChannelList;

export const getSelectedStreamContainerStyle = (
    participant: StreamParticipant | null | undefined,
    style: CSSProperties,
    animatedWidth?: unknown
) => {
    if (!isMediaParticipant(participant)) return style;
    const scale = getRenderedStreamScale(participant.id);
    if (!shouldCenterSelectedStream() && scale === defaultRenderedStreamScale) return style;

    const animatedWidthValue = typeof animatedWidth === "object"
        && animatedWidth != null
        && "to" in animatedWidth
        && typeof animatedWidth.to === "function"
            ? animatedWidth as { to: (mapper: (value: number) => number) => unknown; }
            : null;

    const baseWidth = typeof style.width === "number"
        ? style.width
        : typeof style.width === "string" && style.width.endsWith("px")
            ? Number.parseFloat(style.width)
            : null;

    return {
        ...style,
        width: animatedWidthValue != null
            ? animatedWidthValue.to(value => Math.round(value * scale)) as CSSProperties["width"]
            : baseWidth == null || Number.isNaN(baseWidth)
                ? style.width
                : Math.round(baseWidth * scale),
        maxWidth: scale === defaultRenderedStreamScale ? "100%" : "none",
        flexShrink: 0,
        display: "flex",
        justifyContent: "center",
        marginLeft: "auto",
        marginRight: "auto"
    } satisfies CSSProperties;
};

export const getSelectedRootClassName = () => classes(
    cl("selected-root"),
    hideControlsUntilHover && cl("controls-hover-hidden")
);
export const useSelectedRootClassName = () => useStateFromStores([renderedStreamScaleStore], getSelectedRootClassName);
export const getActionRowClassName = (className?: string) => classes(className, cl("action-row"));
export const getParticipantsWrapperClassName = (className?: string) => classes(className, cl("participants-wrapper"));
export const getParticipantsListClassName = (className?: string) => classes(className, cl("participants-list"));
export const getParticipantsTileClassName = (className?: string) => classes(className, cl("participants-tile"));
export const getParticipantsItemClassName = (className?: string) => classes(className, cl("participants-item"));
export const useShowStreamParticipants = (showParticipants: boolean) => (
    useStateFromStores([renderedStreamScaleStore], () => getShowStreamParticipants(showParticipants))
);

type PositionedOverlayStyle = Pick<CSSProperties, "opacity" | "visibility"> & {
    translateY?: CSSProperties["translate"];
};
type AnimatedValue = {
    to: <T>(mapper: (value: number) => T) => T;
};

const getAnimatedValue = (value: unknown): AnimatedValue | null => {
    if (typeof value !== "object" || value == null || !("to" in value) || typeof value.to !== "function") return null;
    return value as AnimatedValue;
};

export const getVideoFrameStyle = (style: Pick<CSSProperties, "top" | "left" | "right" | "width" | "display" | "justifyContent">) => {
    return style;
};

export const getParticipantsWrapperStyle = (style: PositionedOverlayStyle) => {
    const opacityValue = getAnimatedValue(style.opacity);
    const opacity = opacityValue != null
        ? opacityValue.to(value => value * bottomRowOpacity / 100)
        : typeof style.opacity === "number"
            ? style.opacity * bottomRowOpacity / 100
            : bottomRowOpacity / 100;

    return {
        ...style,
        opacity,
    } satisfies CSSProperties;
};

export const getSelectedStreamItemStyle = (
    participant: StreamParticipant | null | undefined,
    style: CSSProperties
) => {
    return style;
};

export const setHideBottomStreamParticipants = (hidden: boolean) => {
    renderedStreamScaleStore.updateHideBottomParticipants(hidden);
};

export const setBottomRowOpacity = (opacity: number) => {
    const nextOpacity = Math.min(maxBottomRowOpacityPercent, Math.max(minBottomRowOpacityPercent, Number(opacity.toFixed(0))));
    if (bottomRowOpacity === nextOpacity) return;

    renderedStreamScaleStore.updateBottomRowOpacity(nextOpacity);
};

export const setHideControlsUntilHover = (hidden: boolean) => {
    if (hideControlsUntilHover === hidden) return;

    renderedStreamScaleStore.updateHideControlsUntilHover(hidden);
};

export const setHideChannelList = (hidden: boolean) => {
    if (hideStreamChannelList === hidden) return;

    if (hidden) enableStyle(hiddenChannelListStyle);
    else disableStyle(hiddenChannelListStyle);

    renderedStreamScaleStore.updateHideChannelList(hidden);
};

export const resetRenderedStreamMenuState = (participant: StreamParticipant | null | undefined) => {
    resetRenderedParticipant(participant);
    setHideChannelList(false);
    setHideBottomStreamParticipants(false);
    setBottomRowOpacity(defaultBottomRowOpacity);
    setHideControlsUntilHover(false);
    applyStreamFitToDom(getMediaStreamKey(participant));
};

const clearStreamFitAnchors = () => {
    sharedFitObserver?.disconnect();
    sharedFitObserver = null;
    streamFitAnchors.clear();
};

export const stopStreamEnhancerState = () => {
    stopAutoWatch();
    disableStyle(hiddenChannelListStyle);
    clearStreamFitAnchors();
    hideStreamChannelList = false;
    hideBottomStreamParticipants = false;
    bottomRowOpacity = defaultBottomRowOpacity;
    hideControlsUntilHover = false;
};
