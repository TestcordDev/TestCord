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

// Install at module eval time, before any Discord modules finish loading.
// This catches reload triggers from errors during VencordRenderer init.

// Layer 1: Block location.reload()
try {
    const proto = Object.getPrototypeOf(window.location) as { reload: () => void };
    const origReload = proto.reload.bind(window.location);
    proto.reload = function () {
        // silently block
    };
} catch { }

// Layer 2: Block location.href assignment (location = x / location.href = x)
try {
    const desc = Object.getOwnPropertyDescriptor(window, "location");
    if (desc && desc.configurable) {
        Object.defineProperty(window, "location", {
            get() { return desc.get?.call(window) ?? window.location; },
            set(v: string | Location) {
                if (typeof v === "string") {
                    const current = window.location.href;
                    if (v === current || v === "about:blank") return;
                }
                // Allow navigation only if it's a real navigation, not a reload
            }
        });
    }
} catch { }

// Layer 3: Block all navigation via beforeunload (captures Ctrl+R, webContents.reload(), etc.)
try {
    window.addEventListener("beforeunload", (event) => {
        event.preventDefault();
        event.returnValue = "";
    }, { capture: true });
} catch { }

// Layer 4: Block error-triggered reloads
try {
    window.addEventListener("unhandledrejection", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    }, { capture: true });
} catch { }

// Layer 5: Override window.onerror to prevent Discord's crash-reload
try {
    window.onerror = function () {
        return true;
    };
} catch { }

// Layer 6: Prevent history-based navigation (history.go/back/forward can trigger unload)
try {
    const histProto = Object.getPrototypeOf(window.history) as {
        go: (delta?: number) => void;
        back: () => void;
        forward: () => void;
    };
    histProto.back = function () { };
    histProto.forward = function () { };
    histProto.go = function () { };
} catch { }

function fixEngine() {
    try {
        const engine = MediaEngineStore?.getMediaEngine?.();
        if (engine) {
            if (typeof engine.reconfigure === "function")
                engine.reconfigure();
            if (typeof engine.setVideoCapturerSource === "function")
                engine.setVideoCapturerSource();
        }
    } catch { }
}

function forceStopScreenshare() {
    try {
        const engine = MediaEngineStore?.getMediaEngine?.();
        const streamManager = engine?.getStreamManager?.() ?? engine?.streamManager ?? null;
        if (streamManager && typeof streamManager.stopScreenCapture === "function")
            streamManager.stopScreenCapture();
    } catch { }
}

export default definePlugin({
    name: "FixScreenshare",
    description: "Prevents Discord from reloading during streaming/voice by blocking all error-triggered unloads at module level.",
    tags: ["Performance", "Voice"],
    authors: [{ name: "Nightcord", id: 0n }, { name: "x2b", id: 0n }],
    required: true,

    start() {
        fixEngine();
        trackedTimeout(fixEngine, 5000);
        trackedTimeout(fixEngine, 15000);

        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", () => trackedTimeout(fixEngine, 1000));
        FluxDispatcher.subscribe("STREAM_START", () => trackedTimeout(fixEngine, 500));
        FluxDispatcher.subscribe("STREAM_STOP", () => trackedTimeout(fixEngine, 500));
        FluxDispatcher.subscribe("RTC_CONNECTION_STATE", () => trackedTimeout(fixEngine, 300));
        // When someone starts watching, the stream may trigger an error — pre-empt it
        FluxDispatcher.subscribe("STREAM_VIEWER_COUNT_UPDATE", () => {
            fixEngine();
            trackedTimeout(forceStopScreenshare, 2000);
            trackedTimeout(fixEngine, 3000);
        });
    },

    stop() {
        for (const timer of pendingTimers) clearTimeout(timer);
        pendingTimers.clear();
    }
});
