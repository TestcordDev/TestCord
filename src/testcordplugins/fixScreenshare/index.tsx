/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const MediaEngineStore = findByPropsLazy("getMediaEngine");

let origReload: (() => void) | undefined;
let oldOnError: OnErrorEventHandler | null = null;
let oldOnUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;
let preventMediaRejection: ((event: PromiseRejectionEvent) => void) | null = null;
let suppressTimer: ReturnType<typeof setTimeout> | undefined;
let suppressReload = false;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

function trackedTimeout(fn: () => void, ms: number) {
    const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        fn();
    }, ms);
    pendingTimers.add(timer);
    return timer;
}

function armSuppress(ms = 6000) {
    suppressReload = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => suppressReload = false, ms);
}

function fixEngine() {
    try {
        const engine = MediaEngineStore?.getMediaEngine?.();
        if (engine) {
            if (typeof engine.reconfigure === "function")
                engine.reconfigure();
        }
    } catch { }
}

function isMediaErrorMsg(msg: string) {
    return msg.includes("RTCPeerConnection")
        || msg.includes("getUserMedia")
        || msg.includes("getDisplayMedia")
        || msg.includes("MediaStream")
        || msg.includes("setVideoCapturerSource")
        || msg.includes("reconfigure")
        || msg.includes("ICE")
        || msg.includes("AVError")
        || msg.includes("NoiseCanceller")
        || msg.includes("screenshare")
        || msg.includes("screen share")
        || msg.includes("ScreenShare")
        || msg.includes("Request has been terminated")
        || msg.includes("crossDomainError")
        || msg.includes("Krisp")
        || msg.includes("krisp")
        || msg.includes("NoiseCancellation");
}

export default definePlugin({
    name: "FixScreenshare",
    description: "Prevents Discord from crashing and reloading when screensharing by stabilizing the media engine and intercepting media-related errors.",
    tags: ["Performance", "Voice"],
    authors: [{ name: "Nightcord", id: 0n }, { name: "x2b", id: 0n }],
    required: true,

    start() {
        fixEngine();
        trackedTimeout(fixEngine, 5000);
        trackedTimeout(fixEngine, 15000);

        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", () => {
            armSuppress(10000);
            trackedTimeout(fixEngine, 1000);
        });
        FluxDispatcher.subscribe("STREAM_START", () => {
            armSuppress(10000);
            trackedTimeout(fixEngine, 500);
        });
        FluxDispatcher.subscribe("STREAM_STOP", () => {
            trackedTimeout(fixEngine, 500);
        });
        FluxDispatcher.subscribe("RTC_CONNECTION_STATE", () => {
            armSuppress(10000);
            trackedTimeout(fixEngine, 300);
        });
        FluxDispatcher.subscribe("STREAM_VIEWER_COUNT_UPDATE", () => {
            armSuppress(10000);
        });

        oldOnError = window.onerror;
        window.onerror = function (event, source, lineno, colno, error) {
            const msg = typeof event === "string" ? event : "";
            if (isMediaErrorMsg(msg) || error?.message && isMediaErrorMsg(error.message)) {
                if (suppressReload) armSuppress(3000);
                return true;
            }
            if (oldOnError) return oldOnError(event, source, lineno, colno, error);
            return false;
        };

        oldOnUnhandledRejection = window.onunhandledrejection;
        preventMediaRejection = function (event) {
            const msg = event.reason?.message ?? String(event.reason);
            if (isMediaErrorMsg(msg)) {
                event.preventDefault();
                return;
            }
            if (oldOnUnhandledRejection) oldOnUnhandledRejection(event);
        };
        window.addEventListener("unhandledrejection", preventMediaRejection);

        try {
            const proto = Object.getPrototypeOf(window.location) as { reload: () => void };
            origReload = proto.reload.bind(window.location);
            proto.reload = function () {
                if (suppressReload) return;
                return origReload!();
            };
        } catch { }
    },

    stop() {
        for (const timer of pendingTimers) clearTimeout(timer);
        pendingTimers.clear();
        clearTimeout(suppressTimer);
        suppressReload = false;
        window.onerror = oldOnError;
        oldOnError = null;
        if (preventMediaRejection) {
            window.removeEventListener("unhandledrejection", preventMediaRejection);
            preventMediaRejection = null;
        }
        oldOnUnhandledRejection = null;
        if (origReload) {
            try {
                const proto = Object.getPrototypeOf(window.location) as { reload: () => void };
                proto.reload = origReload;
            } catch { }
            origReload = undefined;
        }
    }
});
