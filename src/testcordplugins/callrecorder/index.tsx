/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { showItemInFolder } from "@utils/native";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { MediaEngineStore, UserStore, VoiceStateStore } from "@webpack/common";

const logger = new Logger("CallRecorder");
const Native = VencordNative.pluginHelpers.CallRecorder as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    autoStart: {
        type: OptionType.BOOLEAN,
        description: "Auto-start recording on VC join (captures your mic)",
        default: true,
    },
    outputFolder: {
        type: OptionType.STRING,
        description: "Output folder (full path). Leave empty for Downloads.",
        default: "",
    },
    lastSavedFile: {
        type: OptionType.STRING,
        description: "Last saved recording path.",
        default: "",
    },
});

let isRecording = false;
let isStopping = false;
let discordVoiceModule: any = null;
let tempFilePath: string | null = null;

function safeRequire<T>(moduleName: string): T | null {
    try {
        return (window as any).require?.(moduleName) ?? require(moduleName);
    } catch {
        return null;
    }
}

function getPathModule() {
    return safeRequire<typeof import("path")>("path");
}

function getOsModule() {
    return safeRequire<typeof import("os")>("os");
}

function resolveOutputFolder() {
    const configured = settings.store.outputFolder.trim();
    if (configured) return configured;
    const path = getPathModule();
    const os = getOsModule();
    if (path && os) return path.join(os.homedir(), "Downloads");
    const username = process.env?.USERNAME;
    return username ? `C:/Users/${username}/Downloads` : null;
}

function getFolderToOpen(lastSavedFile: string, outputFolder: string) {
    const configured = outputFolder.trim();
    if (configured) return configured;
    const savedPath = lastSavedFile.trim();
    if (!savedPath) return null;
    const path = getPathModule();
    return path?.dirname(savedPath) ?? null;
}

function getFileName() {
    const formatted = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
    return `call-${formatted}.ogg`;
}

async function saveRecordingFile(sourcePath: string) {
    const folder = resolveOutputFolder();
    if (!folder) {
        showNotification({ title: "CallRecorder", body: "No output folder." });
        return;
    }
    try {
        await sleep(300);
        const fileData = await Native.readRecording(sourcePath);
        if (!fileData || !fileData.length) {
            logger.error("Empty recording");
            showNotification({ title: "CallRecorder", body: "Empty recording." });
            return;
        }
        logger.info("Recording:", fileData.length, "bytes");
        const filePath = await Native.saveRecording(fileData.buffer as ArrayBuffer, folder, getFileName());
        settings.store.lastSavedFile = filePath;
        logger.info("Saved:", filePath);
        showNotification({ title: "CallRecorder", body: `Saved to ${filePath}` });
        showItemInFolder(filePath);
    } catch (error) {
        logger.error("Save failed", error);
        showNotification({ title: "CallRecorder", body: "Failed to save." });
    }
}

async function startRecording() {
    if (isRecording || isStopping) return;
    logger.info("Starting recording...");

    isRecording = true;
    tempFilePath = null;

    try {
        discordVoiceModule = (window as any).DiscordNative?.nativeModules?.requireModule?.("discord_voice");

        if (!discordVoiceModule) {
            throw new Error("Discord voice module not available. Join a voice channel first.");
        }

        const deviceId = MediaEngineStore.getInputDeviceId();
        logger.info("Starting native recording, device:", deviceId);

        await new Promise<void>(resolve => {
            discordVoiceModule.startLocalAudioRecording(
                {
                    echoCancellation: false,
                    noiseCancellation: false,
                    autoGainControl: false,
                    deviceId: deviceId || undefined,
                },
                success => {
                    logger.info("Native recording started:", success);
                    resolve();
                }
            );
        });

        logger.info("Recording started");
        showNotification({ title: "CallRecorder", body: "Recording your microphone" });
    } catch (error: any) {
        logger.error("Start failed:", error);
        showNotification({ title: "CallRecorder", body: error.message || "Failed to start" });
        isRecording = false;
    }
}

function stopRecording() {
    if (!isRecording && !isStopping) return;
    if (isStopping) return;

    logger.info("Stopping recording...");
    isStopping = true;

    if (discordVoiceModule) {
        discordVoiceModule.stopLocalAudioRecording(filePath => {
            logger.info("Native stopped, file:", filePath);
            tempFilePath = filePath;
            void saveRecordingFile(filePath);
            isRecording = false;
            isStopping = false;
        });
    } else {
        isRecording = false;
        isStopping = false;
    }
}

export default definePlugin({
    name: "RecordUrMic",
    description: "Records your microphone in voice channels, i coudnt make it record others' voices too, so im leaving it for whoever wants to hear what they were saying in vc.",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    native: true,
    settings,
    flux: {
        VOICE_STATE_UPDATES() {
            const user = UserStore.getCurrentUser();
            if (!user) return;
            const state = VoiceStateStore.getVoiceStateForUser(user.id);
            const inVoice = !!state?.channelId;

            if (inVoice && !isRecording && settings.store.autoStart) {
                void startRecording();
            }
            if (!inVoice && (isRecording || isStopping)) {
                stopRecording();
            }
        },
    },
    start() { },
    stop() { stopRecording(); },
});
