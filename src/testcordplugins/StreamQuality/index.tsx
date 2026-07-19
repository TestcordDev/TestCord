/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { MediaEngineStore, UserStore } from "@webpack/common";

const logger = new Logger("CustomStreamQuality");

const RESOLUTION_OPTIONS = [
    { label: "32p (56x32)", value: 32, width: 56, height: 32 },
    { label: "144p (256x144)", value: 144, width: 256, height: 144 },
    { label: "240p (426x240)", value: 240, width: 426, height: 240 },
    { label: "360p (640x360)", value: 360, width: 640, height: 360 },
    { label: "480p (854x480)", value: 480, width: 854, height: 480 },
    { label: "720p (1280x720)", value: 720, width: 1280, height: 720 },
    { label: "1080p (1920x1080)", value: 1080, width: 1920, height: 1080 },
    { label: "1440p (2560x1440)", value: 1440, width: 2560, height: 1440 },
    { label: "2160p / 4K (3840x2160)", value: 2160, width: 3840, height: 2160 },
    { label: "4320p / 8K (7680x4320)", value: 4320, width: 7680, height: 4320 },
] as const;

const settings = definePluginSettings({
    fpsEnabled: {
        type: OptionType.BOOLEAN,
        description: "Override the stream frame rate.",
        default: true,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    fps: {
        type: OptionType.SLIDER,
        description: "Stream frame rate (FPS).",
        default: 60,
        markers: [1, 5, 10, 15, 20, 30, 60, 120, 240, 360],
        stickToMarkers: true,
        onChange: triggerLiveUpdate,
    },
    resolutionEnabled: {
        type: OptionType.BOOLEAN,
        description: "Override the stream resolution.",
        default: true,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    resolution: {
        type: OptionType.SELECT,
        description: "Stream resolution.",
        options: [
            { label: "32p (56x32)", value: 32 },
            { label: "144p (256x144)", value: 144 },
            { label: "240p (426x240)", value: 240 },
            { label: "360p (640x360)", value: 360 },
            { label: "480p (854x480)", value: 480 },
            { label: "720p (1280x720)", value: 720 },
            { label: "1080p (1920x1080)", value: 1080, default: true },
            { label: "1440p (2560x1440)", value: 1440 },
            { label: "2160p / 4K (3840x2160)", value: 2160 },
            { label: "4320p / 8K (7680x4320)", value: 4320 },
            { label: "Custom", value: 0 },
        ],
        onChange: triggerLiveUpdate,
    },
    resolutionWidth: {
        type: OptionType.STRING,
        description: "Custom resolution width in pixels (e.g. 1920).",
        default: "1920",
        hidden: () => settings.store.resolution !== 0,
        onChange: triggerLiveUpdate,
    },
    resolutionHeight: {
        type: OptionType.STRING,
        description: "Custom resolution height in pixels (e.g. 1080).",
        default: "1080",
        hidden: () => settings.store.resolution !== 0,
        onChange: triggerLiveUpdate,
    },
    bitrateEnabled: {
        type: OptionType.BOOLEAN,
        description: "Override the stream bitrate.",
        default: true,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    bitrate: {
        type: OptionType.SLIDER,
        description: "Stream bitrate in kbps.",
        default: 5000,
        markers: [500, 1000, 2500, 5000, 7500, 10000, 20000, 40000, 60000, 80000, 100000],
        stickToMarkers: false,
        onChange: triggerLiveUpdate,
    },
    codecEnabled: {
        type: OptionType.BOOLEAN,
        description: "Override the video codec.",
        default: false,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    videoCodec: {
        type: OptionType.SELECT,
        description: "Video codec to use for streaming.",
        options: [
            { label: "H264", value: "H264", default: true },
            { label: "VP8", value: "VP8" },
            { label: "VP9", value: "VP9" },
            { label: "AV1", value: "AV1" },
        ],
        onChange: triggerLiveUpdate,
    },
    keyframeIntervalEnabled: {
        type: OptionType.BOOLEAN,
        description: "Override the keyframe interval.",
        default: false,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    keyframeInterval: {
        type: OptionType.SLIDER,
        description: "Keyframe interval in milliseconds (0 for auto).",
        default: 0,
        markers: [0, 500, 1000, 2000, 5000, 10000],
        stickToMarkers: true,
        onChange: triggerLiveUpdate,
    },
    hdrEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable HDR capture mode for streaming.",
        default: false,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    spoofBadgeEnabled: {
        type: OptionType.BOOLEAN,
        description: "Spoof the resolution and FPS badge viewers see, independent of what you actually encode.",
        default: false,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    spoofBadgeResolution: {
        type: OptionType.SELECT,
        description: "Resolution shown to viewers.",
        options: [
            { label: "32p (56x32)", value: 32 },
            { label: "144p (256x144)", value: 144 },
            { label: "240p (426x240)", value: 240 },
            { label: "360p (640x360)", value: 360 },
            { label: "480p (854x480)", value: 480 },
            { label: "720p (1280x720)", value: 720 },
            { label: "1080p (1920x1080)", value: 1080 },
            { label: "1440p (2560x1440)", value: 1440 },
            { label: "2160p / 4K (3840x2160)", value: 2160, default: true },
            { label: "4320p / 8K (7680x4320)", value: 4320 },
            { label: "Custom", value: 0 },
        ],
        onChange: triggerLiveUpdate,
    },
    spoofBadgeWidth: {
        type: OptionType.STRING,
        description: "Custom resolution width shown to viewers (e.g. 3840).",
        default: "3840",
        hidden: () => settings.store.spoofBadgeResolution !== 0,
        onChange: triggerLiveUpdate,
    },
    spoofBadgeHeight: {
        type: OptionType.STRING,
        description: "Custom resolution height shown to viewers (e.g. 2160).",
        default: "2160",
        hidden: () => settings.store.spoofBadgeResolution !== 0,
        onChange: triggerLiveUpdate,
    },
    spoofBadgeFps: {
        type: OptionType.SLIDER,
        description: "Frame rate shown to viewers.",
        default: 120,
        markers: [1, 5, 10, 15, 20, 30, 60, 120, 240, 360],
        stickToMarkers: true,
        onChange: triggerLiveUpdate,
    },
});

function parseDimension(value: string, fallback: number) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getPreset(value: number) {
    return RESOLUTION_OPTIONS.find(r => r.value === value) ?? RESOLUTION_OPTIONS[6];
}

function getRealResolution() {
    const s = settings.store;
    if (s.resolution === 0) {
        return {
            width: parseDimension(s.resolutionWidth, 1920),
            height: parseDimension(s.resolutionHeight, 1080),
        };
    }
    const res = getPreset(s.resolution);
    return { width: res.width, height: res.height };
}

function getSpoofResolution() {
    const s = settings.store;
    if (s.spoofBadgeResolution === 0) {
        return {
            width: parseDimension(s.spoofBadgeWidth, 3840),
            height: parseDimension(s.spoofBadgeHeight, 2160),
        };
    }
    const res = getPreset(s.spoofBadgeResolution);
    return { width: res.width, height: res.height };
}

function patchTransportOptions(options: Record<string, any>, connection: any) {
    const s = settings.store;

    if (s.bitrateEnabled) {
        const bitrateValue = s.bitrate * 1000;
        options.encodingVideoBitRate = bitrateValue;
        options.encodingVideoMinBitRate = bitrateValue;
        options.encodingVideoMaxBitRate = bitrateValue;
        options.callBitRate = bitrateValue;
        options.callMinBitRate = bitrateValue;
        options.callMaxBitRate = bitrateValue;
        options.minBitrate = bitrateValue;
        options.maxBitrate = bitrateValue;
        options.targetBitrate = bitrateValue;
    }

    if (s.resolutionEnabled) {
        const res = getRealResolution();
        options.encodingVideoHeight = res.height;
        options.encodingVideoWidth = res.width;
        options.remoteSinkWantsPixelCount = res.height * res.width;
        options.width = res.width;
        options.height = res.height;
    }

    if (s.fpsEnabled) {
        options.encodingVideoFrameRate = s.fps;
        options.remoteSinkWantsMaxFramerate = s.fps;
        options.framerate = s.fps;
        options.maxFrameRate = s.fps;
    }

    if (s.keyframeIntervalEnabled) {
        options.keyframeInterval = s.keyframeInterval;
    }

    if (s.codecEnabled && connection) {
        try {
            const codecOptions = connection.getCodecOptions("", s.videoCodec, "stream");
            if (codecOptions?.videoEncoder) {
                options.videoEncoder = codecOptions.videoEncoder;
            }
        } catch (e) {
            logger.error("Failed to get codec options", e);
        }
    }

    if (options.streamParameters) {
        const streamParams = Array.isArray(options.streamParameters)
            ? options.streamParameters
            : [options.streamParameters];

        for (const param of streamParams) {
            if (s.bitrateEnabled) {
                param.maxBitrate = s.bitrate * 1000;
            }
            if (s.spoofBadgeEnabled || s.fpsEnabled) {
                param.maxFrameRate = s.spoofBadgeEnabled ? s.spoofBadgeFps : s.fps;
            }
            if (s.spoofBadgeEnabled || s.resolutionEnabled) {
                const res = s.spoofBadgeEnabled ? getSpoofResolution() : getRealResolution();
                param.maxResolution = {
                    height: res.height,
                    width: res.width,
                    type: "fixed",
                };
                param.maxPixelCount = res.height * res.width;
            }
        }

        options.streamParameters = streamParams;
    }
}

function patchDesktopSourceOptions(options: Record<string, any>) {
    if (settings.store.hdrEnabled) {
        options.hdrCaptureMode = "always";
    }

    if (settings.store.fpsEnabled) {
        options.framerate = settings.store.fps;
    }

    if (settings.store.resolutionEnabled) {
        const res = getRealResolution();
        options.resolution = res.height;
        options.width = res.width;
        options.height = res.height;
    }
}

let mediaEngine: any = null;
let connectionHandler: ((...args: any[]) => void) | null = null;
const patchedConnections = new Set<string>();
const activeConnections = new Set<any>();

function triggerLiveUpdate() {
    for (const connection of activeConnections) {
        if (connection.destroyed || !connection.conn) {
            activeConnections.delete(connection);
            continue;
        }

        try {
            const transportOptions: Record<string, any> = {};
            const qualityConstraints = connection.videoQualityManager?.applyQualityConstraints({})?.constraints ?? {};
            Object.assign(transportOptions, qualityConstraints);

            if (connection.videoStreamParameters?.[0]) {
                transportOptions.streamParameters = { ...connection.videoStreamParameters[0] };
            }

            // Calling the hooked method applies our patches and forwards to Discord dynamically
            connection.conn.setTransportOptions(transportOptions);
            logger.info("Triggered live update for transport options", connection.mediaEngineConnectionId);
        } catch (e) {
            logger.error("Failed to live update transport options", e);
        }

        if (connection.conn.setDesktopSourceWithOptions) {
            try {
                const [type, sourceId] = (connection.goLiveSourceIdentifier ?? "").split(":");
                const desktopSourceOptions: Record<string, any> = {
                    hdrCaptureMode: "never",
                    sourceId: sourceId || "0",
                    type: type || "screen",
                };
                connection.conn.setDesktopSourceWithOptions(desktopSourceOptions);
                logger.info("Triggered live update for desktop source options");
            } catch (e) {
                logger.error("Failed to live update desktop source options", e);
            }
        }
    }
}

function onConnection(connection: any) {
    if (connection.context !== "stream") return;
    if (!connection.conn) return;

    // We only patch outbound streams
    if (connection.streamUserId && connection.streamUserId !== UserStore.getCurrentUser()?.id) return;

    activeConnections.add(connection);

    const connId = connection.mediaEngineConnectionId;
    if (patchedConnections.has(connId)) return;
    patchedConnections.add(connId);

    logger.info("Patching stream connection", connId);

    const s = settings.store;

    const origSetTransportOptions = connection.conn.setTransportOptions;
    const origSetDesktopSourceWithOptions = connection.conn.setDesktopSourceWithOptions;
    const origSetStreamParameters = connection.conn.setStreamParameters;
    const origInitializeStreamParameters = connection.conn.initializeStreamParameters;

    if (origSetTransportOptions) {
        connection.conn.setTransportOptions = function (this: any, options: Record<string, any>) {
            patchTransportOptions(options, connection);
            logger.info("Overridden transport options", options);
            return origSetTransportOptions.apply(this, [options]);
        };
    }

    if (origSetDesktopSourceWithOptions) {
        connection.conn.setDesktopSourceWithOptions = function (this: any, options: Record<string, any>) {
            patchDesktopSourceOptions(options);
            logger.info("Overridden desktop source options", options);
            return origSetDesktopSourceWithOptions.apply(this, [options]);
        };
    }

    if (origSetStreamParameters) {
        connection.conn.setStreamParameters = function (this: any, options: Record<string, any>) {
            patchTransportOptions(options, connection); // Uses same param logic
            logger.info("Overridden stream parameters", options);
            return origSetStreamParameters.apply(this, [options]);
        };
    }

    if (connection.videoQualityManager) {
        const vqm = connection.videoQualityManager;

        const oldGetQuality = vqm.getQuality;
        vqm.getQuality = function (this: any, ...args: any[]) {
            const quality = oldGetQuality.apply(this, args);
            if (s.resolutionEnabled) {
                const res = getRealResolution();
                quality.width = res.width;
                quality.height = res.height;
            }
            if (s.fpsEnabled) {
                quality.framerate = s.fps;
            }
            return quality;
        };

        const oldGetDesktopQuality = vqm.getDesktopQuality;
        vqm.getDesktopQuality = function (this: any, ...args: any[]) {
            const quality = oldGetDesktopQuality.apply(this, args);
            if (s.resolutionEnabled) {
                const res = getRealResolution();
                quality.width = res.width;
                quality.height = res.height;
            }
            if (s.fpsEnabled) {
                quality.framerate = s.fps;
            }
            return quality;
        };

        const oldApplyQualityConstraints = vqm.applyQualityConstraints;
        vqm.applyQualityConstraints = function (this: any, ...args: any[]) {
            const resConstraints = oldApplyQualityConstraints.apply(this, args);
            if (s.resolutionEnabled) {
                const res = getRealResolution();
                resConstraints.constraints.encodingVideoHeight = res.height;
                resConstraints.constraints.encodingVideoWidth = res.width;
            }
            if (s.fpsEnabled) {
                resConstraints.constraints.encodingVideoFrameRate = s.fps;
            }
            return resConstraints;
        };

        // The engine recomputes quality on encoder/bandwidth feedback and pushes
        // a fresh quality object via setQuality, which otherwise clobbers the
        // values stamped by the getters above. Re-stamp on every recompute so our
        // settings survive renegotiation rather than only applying at connect.
        if (typeof vqm.setQuality === "function") {
            const oldSetQuality = vqm.setQuality;
            vqm.setQuality = function (this: any, quality: any, ...rest: any[]) {
                if (quality && typeof quality === "object") {
                    if (s.resolutionEnabled) {
                        const res = getRealResolution();
                        quality.width = res.width;
                        quality.height = res.height;
                    }
                    if (s.fpsEnabled) {
                        quality.framerate = s.fps;
                    }
                }
                return oldSetQuality.apply(this, [quality, ...rest]);
            };
        }
    }

    const forceEngineSettings = () => {
        if (!connection.conn) return;
        if (connection.conn.overwriteQualityForTesting) {
            const res = getRealResolution();
            const bitrateValue = s.bitrate * 1000;
            const settingsObject = {
                encode: {
                    height: s.resolutionEnabled ? res.height : 1080,
                    width: s.resolutionEnabled ? res.width : 1920,
                    framerate: s.fpsEnabled ? s.fps : 60
                },
                capture: {
                    height: s.resolutionEnabled ? res.height : 1080,
                    width: s.resolutionEnabled ? res.width : 1920,
                    framerate: s.fpsEnabled ? s.fps : 60
                },
                bitrateMin: bitrateValue,
                bitrateMax: bitrateValue,
                bitrateTarget: bitrateValue
            };
            connection.conn.overwriteQualityForTesting(settingsObject);
            logger.info("Forced engine quality overwrite", settingsObject);
        }
    };

    const emitter = connection.emitter ?? connection;

    const onConnected = () => {
        if (!connection.conn) return;
        // Double check if it's our stream
        if (connection.streamUserId && connection.streamUserId !== UserStore.getCurrentUser()?.id) return;

        forceEngineSettings();

        const transportOptions: Record<string, any> = {};

        try {
            const qualityConstraints = connection.videoQualityManager?.applyQualityConstraints({})?.constraints ?? {};
            Object.assign(transportOptions, qualityConstraints);
        } catch { }

        if (connection.videoStreamParameters?.[0]) {
            transportOptions.streamParameters = { ...connection.videoStreamParameters[0] };
        }

        patchTransportOptions(transportOptions, connection);
        logger.info("Force updating transport options on connected", transportOptions);
        origSetTransportOptions.apply(connection.conn, [transportOptions]);

        if (origSetDesktopSourceWithOptions) {
            const [type, sourceId] = connection.goLiveSourceIdentifier?.split(":") ?? ["screen", "0"];
            const desktopSourceOptions: Record<string, any> = {
                hdrCaptureMode: "never",
                allowScreenCaptureKit: true,
                useQuartzCapturer: true,
                useGraphicsCapture: true,
                useVideoHook: true,
                sourceId,
                type,
            };
            patchDesktopSourceOptions(desktopSourceOptions);
            logger.info("Force updating desktop source options on connected", desktopSourceOptions);
            origSetDesktopSourceWithOptions.apply(connection.conn, [desktopSourceOptions]);
        }
    };

    const onDestroy = () => {
        patchedConnections.delete(connId);
        activeConnections.delete(connection);
        try {
            emitter.removeListener("connected", onConnected);
            emitter.removeListener("destroy", onDestroy);
        } catch { }
    };

    try {
        emitter.on("connected", onConnected);
        emitter.on("destroy", onDestroy);
    } catch (e) {
        logger.error("Failed to attach connection listeners", e);
    }
}

export default definePlugin({
    name: "CustomStreamQuality",
    description: "Customize your stream quality beyond Discord's limits. Set custom FPS, resolution, bitrate, codec, keyframe interval, and HDR.",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    patches: [
        {
            find: "#{intl::STREAM_FPS_OPTION}",
            replacement: {
                match: /guildPremiumTier:\i\.\i\.TIER_\d,?/,
                replace: "",
            },
        },
        {
            find: "canUseCustomStickersEverywhere:",
            replacement: [
                {
                    match: /canStreamQuality:function\([^)]+\)\{[^}]+\},?/,
                    replace: "canStreamQuality:() => true,",
                },
                {
                    match: /canUseHighVideoUploadQuality:function\([^)]+\)\{[^}]+\},?/,
                    replace: "canUseHighVideoUploadQuality:() => true,",
                },
            ],
        },
    ],
    start() {
        try {
            mediaEngine = MediaEngineStore.getMediaEngine();
            if (!mediaEngine) {
                logger.error("Could not get media engine");
                return;
            }

            const emitter = mediaEngine.emitter ?? mediaEngine;

            connectionHandler = (connection: any) => {
                try {
                    onConnection(connection);
                } catch (e) {
                    logger.error("Error in connection handler", e);
                }
            };

            emitter.on("connection", connectionHandler);
            logger.info("CustomStreamQuality started");
        } catch (e) {
            logger.error("Failed to start CustomStreamQuality", e);
        }
    },
    stop() {
        try {
            if (mediaEngine && connectionHandler) {
                const emitter = mediaEngine.emitter ?? mediaEngine;
                emitter.removeListener("connection", connectionHandler);
            }
            connectionHandler = null;
            mediaEngine = null;
            patchedConnections.clear();
            activeConnections.clear();
            logger.info("CustomStreamQuality stopped");
        } catch (e) {
            logger.error("Failed to stop CustomStreamQuality", e);
        }
    },
});
