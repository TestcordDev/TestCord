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
        const engine = MediaEngineStore.getMediaEngine();
        if (engine) {
            if (typeof engine.reconfigure === "function") {
                console.log("[FixScreenshare] Forcing media engine reconfiguration...");
                engine.reconfigure();
            }
            // Some versions use setVideoCapturerSource for initialization
            if (typeof engine.setVideoCapturerSource === "function") {
                console.log("[FixScreenshare] Media Engine capturer ready.");
            }
        }
    } catch (e) {
        console.error("[FixScreenshare] Error during engine fix:", e);
    }
}

const handleVoiceChannelSelect = () => {
    // Small delay to let Discord settle after joining voice
    trackedTimeout(fixEngine, 1000);
};

export default definePlugin({
    name: "FixScreenshare",
    description: "Fixes infinite loading and crashes on screenshare after reload (Ctrl+R) by forcing module re-initialization.",
    tags: ["Performance", "Voice", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    required: true,

    start() {
        console.log("[FixScreenshare] Mandatory fix starting...");

        // Run immediately and after a short delay to ensure Discord is ready
        fixEngine();
        trackedTimeout(fixEngine, 5000);
        trackedTimeout(fixEngine, 15000);

        // Listen for voice channel joins to re-apply fix
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
        for (const timer of pendingTimers) clearTimeout(timer);
        pendingTimers.clear();
    }
});
