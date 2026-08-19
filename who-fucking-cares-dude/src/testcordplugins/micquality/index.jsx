/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { MediaEngineStore, Menu } from "@webpack/common";
const logger = new Logger("CustomMicQuality");
const QUALITY_OPTIONS = [
    { label: "Popcorn (1bps, 10Hz)", value: "null", bitrate: 1, rate: 10 },
    { label: "Radio (50bps, 500Hz)", value: "submarine", bitrate: 50, rate: 500 },
    { label: "Trash (100bps, 1kHz)", value: "am_radio", bitrate: 100, rate: 1000 },
    { label: "mid (200bps, 2kHz)", value: "fax", bitrate: 200, rate: 2000 },
    { label: "better mid (500bps, 4kHz)", value: "absolute_trash", bitrate: 500, rate: 4000 },
    { label: "Bad (1kbps, 8kHz)", value: "garbage", bitrate: 1000, rate: 8000 },
    { label: "Almost bad (4kbps, 12kHz)", value: "popcorn", bitrate: 4000, rate: 12000 },
    { label: "Low (16kbps, 16kHz)", value: "low", bitrate: 16000, rate: 16000 },
    { label: "Standard (64kbps, 48kHz)", value: "standard", bitrate: 64000, rate: 48000 },
    { label: "High (128kbps, 48kHz)", value: "high", bitrate: 128000, rate: 48000 },
    { label: "Studio (512kbps, 48kHz)", value: "studio", bitrate: 512000, rate: 48000 },
];
const EFFECTS_OPTIONS = [
    { label: "None", value: "none" },
    { label: "Robot / 8-bit", value: "robot" },
    { label: "Deep Voice", value: "deep" },
    { label: "Echo Chamber", value: "echo" },
    { label: "Radio Static", value: "static" },
    { label: "Demon", value: "demon" },
];
const settings = definePluginSettings({
    qualityEnabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Override microphone quality/bitrate.",
        default: true,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    quality: {
        type: 4 /* OptionType.SELECT */,
        description: "Microphone Quality Preset",
        options: QUALITY_OPTIONS.map(q => ({ label: q.label, value: q.value, default: q.value === "standard" })),
        onChange: triggerLiveUpdate,
    },
    stereo: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Stereo Audio (requires restart to fully apply). Noise cancellation should be off.",
        default: false,
        restartNeeded: true,
    },
    echoCancellation: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Echo Cancellation",
        default: true,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    noiseSuppression: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Noise Suppression",
        default: true,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    agc: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Automatic Gain Control (AGC)",
        default: true,
        restartNeeded: false,
        onChange: triggerLiveUpdate,
    },
    funEffect: {
        type: 4 /* OptionType.SELECT */,
        description: "Fun Audio Effects",
        options: EFFECTS_OPTIONS.map(e => ({ label: e.label, value: e.value, default: e.value === "none" })),
        onChange: triggerLiveUpdate,
    }
});
function getQualityData(value) {
    return QUALITY_OPTIONS.find(q => q.value === value) ?? QUALITY_OPTIONS[2];
}
function patchTransportOptions(options, connection) {
    const s = settings.store;
    if (!options.audioEncoder) {
        try {
            options.audioEncoder = { ...connection.getCodecOptions("opus").audioEncoder };
        }
        catch (e) {
            options.audioEncoder = {};
        }
    }
    // If a fun effect is active, apply it and skip quality settings
    if (s.funEffect !== "none") {
        if (s.funEffect === "robot") {
            options.audioEncoder.rate = 8000;
            options.audioEncoder.pacsize = 20;
            options.encodingVoiceBitRate = 8000;
        }
        else if (s.funEffect === "deep") {
            options.audioEncoder.rate = 6000;
            options.audioEncoder.pacsize = 80;
            options.encodingVoiceBitRate = 3000;
        }
        else if (s.funEffect === "echo") {
            options.audioEncoder.rate = 16000;
            options.audioEncoder.pacsize = 160;
            options.encodingVoiceBitRate = 8000;
        }
        else if (s.funEffect === "static") {
            options.audioEncoder.rate = 4000;
            options.audioEncoder.pacsize = 5;
            options.encodingVoiceBitRate = 2000;
        }
        else if (s.funEffect === "demon") {
            options.audioEncoder.rate = 3000;
            options.audioEncoder.pacsize = 45;
            options.encodingVoiceBitRate = 1500;
        }
    }
    else if (s.qualityEnabled) {
        // Only apply quality settings when no effect is active
        const qualityData = getQualityData(s.quality);
        options.encodingVoiceBitRate = qualityData.bitrate;
        options.audioEncoder.rate = qualityData.rate;
    }
    if (s.stereo) {
        options.audioEncoder.channels = 2;
    }
    else {
        options.audioEncoder.channels = 1;
    }
    options.echoCancellation = s.echoCancellation;
    options.noiseSuppression = s.noiseSuppression;
    options.automaticGainControl = s.agc;
    // Apply voice modes if available inside transport options
    if (options.modes) {
        options.modes = {
            ...options.modes,
            echoCancellation: s.echoCancellation,
            noiseSuppression: s.noiseSuppression,
            automaticGainControl: s.agc
        };
    }
}
let mediaEngine = null;
let connectionHandler = null;
const patchedConnections = new Set();
const activeConnections = new Set();
const patchedConns = new Set();
function unpatchConn(conn) {
    try {
        if (conn?._micQualityOrig) {
            conn.setTransportOptions = conn._micQualityOrig;
            delete conn._micQualityOrig;
        }
    }
    catch { }
    patchedConns.delete(conn);
}
function triggerLiveUpdate() {
    for (const connection of activeConnections) {
        if (connection.destroyed) {
            activeConnections.delete(connection);
            continue;
        }
        try {
            const transportOptions = {};
            const baseAudioEncoder = connection.getCodecOptions("opus")?.audioEncoder || {};
            transportOptions.audioEncoder = { ...baseAudioEncoder };
            // Set default voice bit rate based on discord behavior before overriding
            transportOptions.encodingVoiceBitRate = 64000;
            // Re-apply the patch over an empty object
            patchTransportOptions(transportOptions, connection);
            // Calling the hooked method applies our patches to the connection.conn
            connection.conn.setTransportOptions(transportOptions);
            logger.info("Triggered live update for mic options on connection", connection.mediaEngineConnectionId);
        }
        catch (e) {
            logger.error("Failed to live update mic options", e);
        }
    }
}
function onConnection(connection) {
    // Both default voice and streaming connections have an audio track, but we mainly want to apply to user audio.
    // context 'default' is standard voice call.
    if (connection.context !== "default" && connection.context !== "stream")
        return;
    activeConnections.add(connection);
    const connId = connection.mediaEngineConnectionId;
    if (patchedConnections.has(connId))
        return;
    patchedConnections.add(connId);
    logger.info("Patching audio connection", connId);
    const origSetTransportOptions = connection.conn.setTransportOptions;
    connection.conn._micQualityOrig = origSetTransportOptions;
    patchedConns.add(connection.conn);
    connection.conn.setTransportOptions = function (options) {
        patchTransportOptions(options, connection);
        logger.info("Overridden audio transport options", options);
        return Reflect.apply(origSetTransportOptions, this, [options]);
    };
    const emitter = connection.emitter ?? connection;
    const onConnected = () => {
        const transportOptions = {};
        try {
            transportOptions.audioEncoder = { ...connection.getCodecOptions("opus").audioEncoder };
            transportOptions.encodingVoiceBitRate = 64000;
        }
        catch (e) { }
        patchTransportOptions(transportOptions, connection);
        logger.info("Force updating audio transport options on connected", transportOptions);
        origSetTransportOptions(transportOptions);
    };
    const onDestroy = () => {
        patchedConnections.delete(connId);
        activeConnections.delete(connection);
        unpatchConn(connection.conn);
        try {
            emitter.removeListener("connected", onConnected);
            emitter.removeListener("destroy", onDestroy);
        }
        catch { }
    };
    try {
        emitter.on("connected", onConnected);
        emitter.on("destroy", onDestroy);
    }
    catch (e) {
        logger.error("Failed to attach connection event listeners", e);
    }
}
export default definePlugin({
    name: "CustomMicQuality",
    description: "Customize your microphone quality, bitrates, stereo mode, echo cancellation, and apply fun effects.",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    contextMenus: {
        "audio-device-context"(children, props) {
            if (props.renderInputDevices) {
                children.push(<Menu.MenuSeparator />, <Menu.MenuItem id="mic-quality-submenu" label="Mic Quality" action={() => { }}>
                        <>
                            <Menu.MenuCheckboxItem id="quality-enabled" label="Quality Override" checked={settings.store.qualityEnabled} action={() => {
                        settings.store.qualityEnabled = !settings.store.qualityEnabled;
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-null" label="Popcorn" checked={settings.store.quality === "null"} action={() => {
                        settings.store.quality = "null";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-submarine" label="Radio" checked={settings.store.quality === "submarine"} action={() => {
                        settings.store.quality = "submarine";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-am-radio" label="Trash" checked={settings.store.quality === "am_radio"} action={() => {
                        settings.store.quality = "am_radio";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-fax" label="mid" checked={settings.store.quality === "fax"} action={() => {
                        settings.store.quality = "fax";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-absolute-trash" label="better mid" checked={settings.store.quality === "absolute_trash"} action={() => {
                        settings.store.quality = "absolute_trash";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-garbage" label="Bad" checked={settings.store.quality === "garbage"} action={() => {
                        settings.store.quality = "garbage";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-popcorn" label="Almost bad" checked={settings.store.quality === "popcorn"} action={() => {
                        settings.store.quality = "popcorn";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-low" label="Low" checked={settings.store.quality === "low"} action={() => {
                        settings.store.quality = "low";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-standard" label="Standard" checked={settings.store.quality === "standard"} action={() => {
                        settings.store.quality = "standard";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-high" label="High" checked={settings.store.quality === "high"} action={() => {
                        settings.store.quality = "high";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="quality-preset" id="quality-studio" label="Studio" checked={settings.store.quality === "studio"} action={() => {
                        settings.store.quality = "studio";
                        triggerLiveUpdate();
                    }}/>
                        </>
                    </Menu.MenuItem>, <Menu.MenuItem id="mic-effect-submenu" label="Voice Effect" action={() => { }}>
                        <>
                            <Menu.MenuRadioItem group="voice-effect" id="effect-none" label="None" checked={settings.store.funEffect === "none"} action={() => {
                        settings.store.funEffect = "none";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="voice-effect" id="effect-robot" label="Robot / 8-bit" checked={settings.store.funEffect === "robot"} action={() => {
                        settings.store.funEffect = "robot";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="voice-effect" id="effect-deep" label="Deep Voice" checked={settings.store.funEffect === "deep"} action={() => {
                        settings.store.funEffect = "deep";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="voice-effect" id="effect-echo" label="Echo Chamber" checked={settings.store.funEffect === "echo"} action={() => {
                        settings.store.funEffect = "echo";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="voice-effect" id="effect-static" label="Radio Static" checked={settings.store.funEffect === "static"} action={() => {
                        settings.store.funEffect = "static";
                        triggerLiveUpdate();
                    }}/>
                            <Menu.MenuRadioItem group="voice-effect" id="effect-demon" label="Demon" checked={settings.store.funEffect === "demon"} action={() => {
                        settings.store.funEffect = "demon";
                        triggerLiveUpdate();
                    }}/>
                        </>
                    </Menu.MenuItem>);
            }
        }
    },
    patches: [
        // Also inject physical stereo codec change like StereoMic does to ensure WebRTC accepts stereo channel mapping.
        {
            find: "Audio codecs",
            replacement: {
                match: /channels:1,/,
                replace: "channels:2,prams:{stereo:\"2\"},",
                predicate: () => settings.store.stereo
            }
        }
    ],
    start() {
        try {
            mediaEngine = MediaEngineStore.getMediaEngine();
            if (!mediaEngine) {
                logger.error("Could not get media engine");
                return;
            }
            const emitter = mediaEngine.emitter ?? mediaEngine;
            connectionHandler = (connection) => {
                try {
                    onConnection(connection);
                }
                catch (e) {
                    logger.error("Error in connection handler", e);
                }
            };
            emitter.on("connection", connectionHandler);
            logger.info("CustomMicQuality started");
        }
        catch (e) {
            logger.error("Failed to start CustomMicQuality", e);
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
            for (const conn of patchedConns)
                unpatchConn(conn);
            patchedConns.clear();
            patchedConnections.clear();
            activeConnections.clear();
            logger.info("CustomMicQuality stopped");
        }
        catch (e) {
            logger.error("Failed to stop CustomMicQuality", e);
        }
    },
});
