/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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
import { lodash } from "@webpack/common";
import { replaceObjectValuesIfExist, utils } from "../../philsPluginLibrary";
export function getDefaultVideoTransportationOptions(connection) {
    return {
        ...connection.videoQualityManager.applyQualityConstraints({}).constraints,
        videoEncoder: {
            ...connection.getCodecOptions("", "H264", "stream").videoEncoder
        },
        streamParameters: connection.videoStreamParameters[0],
        keyframeInterval: 0,
    };
}
export function getDefaultVideoDesktopSourceOptions(connection) {
    const [type, sourceId] = connection.goLiveSourceIdentifier?.split(":") ?? ["screen", 0];
    return {
        hdrCaptureMode: "never",
        allowScreenCaptureKit: true,
        useQuartzCapturer: true,
        useGraphicsCapture: true,
        useVideoHook: true,
        sourceId: sourceId,
        type: type
    };
}
export function getStreamParameters(connection, get) {
    const { currentProfile } = get();
    const { framerate, framerateEnabled, height, resolutionEnabled, videoBitrate, videoBitrateEnabled, width, } = currentProfile;
    const { bitrateMax, capture } = connection.applyQualityConstraints({}).quality;
    return {
        ...connection.videoStreamParameters[0],
        quality: 100,
        ...(videoBitrateEnabled && videoBitrate
            ? {
                maxBitrate: videoBitrate * 1000,
            }
            : {
                maxBitrate: bitrateMax
            }),
        ...((resolutionEnabled && width && height)
            ? {
                maxResolution: {
                    height: height,
                    width: width,
                    type: "fixed"
                },
                maxPixelCount: width * height
            }
            : {
                maxResolution: !capture.height || !capture.width ? {
                    height: capture.height,
                    width: capture.width,
                    type: "source"
                } : {
                    height: capture.height,
                    width: capture.width,
                    type: "fixed"
                }
            }),
        ...(framerateEnabled && framerate
            ? {
                maxFrameRate: framerate,
            }
            : {
                maxFrameRate: capture.framerate
            }),
        active: true,
    };
}
export function getReplaceableVideoTransportationOptions(connection, get) {
    const { currentProfile, audioSource, audioSourceEnabled } = get();
    const { framerate, framerateEnabled, height, keyframeInterval, keyframeIntervalEnabled, resolutionEnabled, videoBitrate, videoBitrateEnabled, videoCodec, videoCodecEnabled, width, } = currentProfile;
    return {
        ...(videoBitrateEnabled && videoBitrate
            ? {
                encodingVideoBitRate: Math.round(videoBitrate * 1000),
                encodingVideoMinBitRate: Math.round(videoBitrate * 1000),
                encodingVideoMaxBitRate: Math.round(videoBitrate * 1000),
                callBitRate: Math.round(videoBitrate * 1000),
                callMinBitRate: Math.round(videoBitrate * 1000),
                callMaxBitRate: Math.round(videoBitrate * 1000)
            }
            : {}),
        ...((resolutionEnabled && width && height)
            ? {
                encodingVideoHeight: height,
                encodingVideoWidth: width,
                remoteSinkWantsPixelCount: height * width
            }
            : {}),
        ...(framerateEnabled && framerate
            ? {
                encodingVideoFrameRate: framerate,
                remoteSinkWantsMaxFramerate: framerate,
                captureVideoFrameRate: framerate
            }
            : {}),
        ...(keyframeIntervalEnabled && keyframeInterval
            ? {
                keyframeInterval: keyframeInterval
            }
            : {}),
        ...(videoCodecEnabled && videoCodec
            ? {
                videoEncoder: connection.getCodecOptions("", videoCodec, "stream").videoEncoder
            }
            : {}),
        ...(audioSourceEnabled && audioSource && utils.getPidFromDesktopSource(audioSource)
            ? {
                soundsharePid: utils.getPidFromDesktopSource(audioSource),
                soundshareEventDriven: true,
                soundshareLoopback: true
            }
            : {}),
        streamParameters: getStreamParameters(connection, get)
    };
}
export function getReplaceableVideoDesktopSourceOptions(get) {
    const { currentProfile } = get();
    const { hdrEnabled, } = currentProfile;
    return {
        ...(hdrEnabled
            ? {
                hdrCaptureMode: "always"
            }
            : {}),
    };
}
export function patchConnectionVideoSetDesktopSourceWithOptions(connection, get, logger) {
    const oldSetDesktopSourceWithOptions = connection.conn.setDesktopSourceWithOptions;
    connection.conn.setDesktopSourceWithOptions = function (options) {
        const replaceableDesktopSourceOptions = getReplaceableVideoDesktopSourceOptions(get);
        replaceObjectValuesIfExist(options, replaceableDesktopSourceOptions);
        logger?.info("Overridden Desktop Source Options", options);
        return Reflect.apply(oldSetDesktopSourceWithOptions, this, [options]);
    };
    const forceUpdateDesktopSourceOptions = () => {
        const desktopSourceOptions = lodash.merge({ ...getDefaultVideoDesktopSourceOptions(connection) }, getReplaceableVideoDesktopSourceOptions(get));
        logger?.info("Force Updated Desktop Source Options", desktopSourceOptions);
        oldSetDesktopSourceWithOptions(desktopSourceOptions);
    };
    return {
        oldSetDesktopSourceWithOptions,
        forceUpdateDesktopSourceOptions
    };
}
export function patchConnectionVideoTransportOptions(connection, get, logger) {
    const oldSetTransportOptions = connection.conn.setTransportOptions;
    const oldGetQuality = connection.videoQualityManager.getQuality;
    connection.videoQualityManager.getQuality = function (src) {
        const { currentProfile } = get();
        const { videoBitrateEnabled, videoBitrate, framerateEnabled, framerate, resolutionEnabled, width, height } = currentProfile;
        const quality = oldGetQuality.call(this, src);
        if (videoBitrateEnabled) {
            quality.bitrateMax = Math.round(videoBitrate * 1000);
            quality.bitrateMin = Math.round(videoBitrate * 1000);
            quality.bitrateTarget = Math.round(videoBitrate * 1000);
        }
        quality.localWant = 100;
        quality.capture.framerate = framerateEnabled ? framerate : quality.capture.framerate;
        quality.capture.width = resolutionEnabled ? width : quality.capture.width;
        quality.capture.height = resolutionEnabled ? height : quality.capture.height;
        quality.capture.pixelCount = quality.capture.width * quality.capture.height;
        quality.encode = quality.capture;
        logger?.info("Overridden getQuality", quality);
        return quality;
    };
    connection.conn.setTransportOptions = function (options) {
        const replaceableTransportOptions = getReplaceableVideoTransportationOptions(connection, get);
        if (options.streamParameters)
            connection.videoStreamParameters = Array.isArray(options.streamParameters) ? options.streamParameters : [options.streamParameters];
        replaceObjectValuesIfExist(options, replaceableTransportOptions);
        logger?.info("Overridden Transport Options", options);
        return Reflect.apply(oldSetTransportOptions, this, [options]);
    };
    const forceUpdateTransportationOptions = () => {
        const transportOptions = lodash.merge({ ...getDefaultVideoTransportationOptions(connection) }, getReplaceableVideoTransportationOptions(connection, get));
        logger?.info("Force Updated Transport Options", transportOptions);
        oldSetTransportOptions(transportOptions);
    };
    return {
        oldSetTransportOptions,
        forceUpdateTransportationOptions,
    };
}
