/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const MediaEngineStore = findByPropsLazy("getMediaEngine");

const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

function trackedTimeout(fn: () => void, ms: number) {
    const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        fn();
    }, ms);
    pendingTimers.add(timer);
    return timer;
}

function fixEngine() {
    try {
        const engine = MediaEngineStore?.getMediaEngine?.();
        if (engine) {
            if (typeof engine.reconfigure === "function") {
                engine.reconfigure();
            }
            if (typeof engine.setVideoCapturerSource === "function") {
                engine.setVideoCapturerSource();
            }
        }
    } catch (e) {
        console.error("[FixScreenshare] Error during engine fix:", e);
    }
}

function getStreamManager() {
    try {
        const engine = MediaEngineStore?.getMediaEngine?.();
        return engine?.getStreamManager?.() ?? engine?.streamManager ?? null;
    } catch { return null; }
}

function forceStopScreenshare() {
    try {
        const streamManager = getStreamManager();
        if (streamManager && typeof streamManager.stopScreenCapture === "function") {
            streamManager.stopScreenCapture();
        }
    } catch { }
}

let oldOnError: OnErrorEventHandler | null = null;
let oldOnUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;

function preventReloadOnError(event: Event | string, source?: string, lineno?: number, colno?: number, error?: Error) {
    const msg = typeof event === "string" ? event : "";
    if (
        error?.message?.includes("RTCPeerConnection") ||
        error?.message?.includes("getUserMedia") ||
        error?.message?.includes("getDisplayMedia") ||
        error?.message?.includes("MediaStream") ||
        error?.message?.includes("setVideoCapturerSource") ||
        error?.message?.includes("reconfigure") ||
        error?.message?.includes("ICE") ||
        msg?.includes("screenshare") ||
        msg?.includes("screen share") ||
        msg?.includes("ScreenShare")
    ) {
        return true;
    }
    if (oldOnError) return oldOnError(event, source, lineno, colno, error);
    return false;
}

function preventUnhandledRejection(event: PromiseRejectionEvent) {
    const msg = event.reason?.message ?? String(event.reason);
    if (
        msg.includes("RTCPeerConnection") ||
        msg.includes("getUserMedia") ||
        msg.includes("getDisplayMedia") ||
        msg.includes("MediaStream") ||
        msg.includes("setVideoCapturerSource") ||
        msg.includes("reconfigure") ||
        msg.includes("ICE") ||
        msg.includes("screenshare") ||
        msg.includes("screen share") ||
        msg.includes("ScreenShare") ||
        msg.includes("Request has been terminated") ||
        msg.includes("crossDomainError")
    ) {
        event.preventDefault();
        return;
    }
    if (oldOnUnhandledRejection) oldOnUnhandledRejection(event);
}

export default definePlugin({
    name: "FixScreenshare",
    description: "Prevents Discord from crashing and reloading when screensharing by stabilizing the media engine and intercepting related errors.",
    tags: ["Performance", "Voice"],
    authors: [{ name: "Nightcord", id: 0n }, { name: "x2b", id: 0n }],
    required: true,

    start() {
        fixEngine();
        trackedTimeout(fixEngine, 5000);
        trackedTimeout(fixEngine, 15000);

        const handler = () => trackedTimeout(fixEngine, 1000);
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handler);
        FluxDispatcher.subscribe("STREAM_START", () => trackedTimeout(fixEngine, 500));
        FluxDispatcher.subscribe("STREAM_STOP", () => trackedTimeout(fixEngine, 500));
        FluxDispatcher.subscribe("RTC_CONNECTION_STATE", () => trackedTimeout(fixEngine, 300));

        oldOnError = window.onerror;
        window.onerror = preventReloadOnError;
        oldOnUnhandledRejection = window.onunhandledrejection;
        window.addEventListener("unhandledrejection", preventUnhandledRejection);
    },

    stop() {
        for (const timer of pendingTimers) clearTimeout(timer);
        pendingTimers.clear();
        window.onerror = oldOnError;
        oldOnError = null;
        if (oldOnUnhandledRejection) {
            window.removeEventListener("unhandledrejection", preventUnhandledRejection);
            oldOnUnhandledRejection = null;
        }
    }
});
