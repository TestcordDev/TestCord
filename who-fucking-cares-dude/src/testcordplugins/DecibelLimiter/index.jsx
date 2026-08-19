/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { showToast, Toasts, UserStore } from "@webpack/common";
const MediaEngineStore = findStoreLazy("MediaEngineStore");
const settings = definePluginSettings({
    enabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable DecibelLimiter",
        default: true
    },
    thresholdPercent: {
        type: 5 /* OptionType.SLIDER */,
        description: "Critical threshold (in %). Lower = more sensitive",
        default: 85,
        markers: [50, 65, 75, 85, 95],
        minValue: 30,
        maxValue: 99,
        stickToMarkers: false
    },
    muteDurationMs: {
        type: 5 /* OptionType.SLIDER */,
        description: "Auto‑mute duration (ms)",
        default: 1200,
        markers: [500, 800, 1200, 2000, 3000],
        minValue: 300,
        maxValue: 5000,
        stickToMarkers: false
    },
    cooldownMs: {
        type: 5 /* OptionType.SLIDER */,
        description: "Anti‑spam cooldown (ms) per user",
        default: 2000,
        markers: [500, 1000, 2000, 3000, 5000],
        minValue: 250,
        maxValue: 10000,
        stickToMarkers: false
    },
    showToasts: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show protection notifications",
        default: true
    },
    verboseLogs: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show detailed logs",
        default: false
    }
});
let mediaEngine = null;
let removeConnectionListener = null;
const statsUnsubscribers = new Map();
const restoreTimeouts = new Map();
const rememberedVolumes = new Map();
const mutedTargets = new Map();
const lastTriggers = new Map();
function log(message) {
    if (!settings.store.verboseLogs)
        return;
    console.log(`[DecibelLimiter] ${message}`);
}
function toast(message, type = Toasts.Type.MESSAGE) {
    if (!settings.store.showToasts)
        return;
    showToast(message, type);
}
function getConnectionId(connection) {
    return connection.mediaEngineConnectionId ?? "default-connection";
}
function getVolumeKey(connection, userId) {
    return `${getConnectionId(connection)}:${userId}`;
}
function normalizeAudioLevel(rawLevel) {
    const value = Number(rawLevel);
    if (!Number.isFinite(value) || value <= 0)
        return 0;
    if (value <= 1)
        return value;
    if (value <= 100)
        return value / 100;
    if (value <= 32767)
        return value / 32767;
    return Math.min(value / 100000, 1);
}
function extractInboundStats(payload) {
    if (!payload)
        return [];
    const candidates = [
        payload?.rtp?.inbound,
        payload?.inbound,
        payload?.stats?.rtp?.inbound,
        payload?.stats?.inbound,
        payload?.[0]?.rtp?.inbound,
        payload?.[0]?.inbound
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
        if (candidate && typeof candidate === "object") {
            const values = Object.values(candidate);
            if (values.length && values.every(item => typeof item === "object" && item != null)) {
                return values;
            }
        }
    }
    return [];
}
function getCurrentLocalVolume(connection, userId) {
    const direct = Number(connection.getLocalVolume?.(userId));
    if (Number.isFinite(direct))
        return direct;
    const fromMap = Number(connection.localVolumes?.[userId]);
    if (Number.isFinite(fromMap))
        return fromMap;
    return 100;
}
function clearRestoreTimeout(key) {
    const timeout = restoreTimeouts.get(key);
    if (timeout) {
        clearTimeout(timeout);
        restoreTimeouts.delete(key);
    }
}
function scheduleRestore(connection, userId, key) {
    clearRestoreTimeout(key);
    const timeout = setTimeout(() => {
        restoreTimeouts.delete(key);
        const remembered = rememberedVolumes.get(key);
        if (remembered == null)
            return;
        try {
            connection.setLocalVolume?.(userId, remembered);
            log(`Volume restored for ${userId}: ${remembered}`);
        }
        catch (error) {
            console.error("[DecibelLimiter] Error restoring volume:", error);
        }
        finally {
            rememberedVolumes.delete(key);
            mutedTargets.delete(key);
        }
    }, settings.store.muteDurationMs);
    restoreTimeouts.set(key, timeout);
}
function shouldTrigger(key) {
    const now = Date.now();
    const last = lastTriggers.get(key) ?? 0;
    if (now - last < settings.store.cooldownMs)
        return false;
    lastTriggers.set(key, now);
    return true;
}
function applyHardMute(connection, userId, normalizedLevel) {
    if (!settings.store.enabled)
        return;
    if (!connection.setLocalVolume)
        return;
    const key = getVolumeKey(connection, userId);
    if (!shouldTrigger(key))
        return;
    if (!rememberedVolumes.has(key)) {
        const currentVolume = getCurrentLocalVolume(connection, userId);
        rememberedVolumes.set(key, currentVolume);
    }
    mutedTargets.set(key, { connection, userId });
    try {
        connection.setLocalVolume?.(userId, 0);
        const percent = Math.round(normalizedLevel * 100);
        log(`Peak detected (${percent}%) on ${userId}. Volume muted.`);
        toast(`DecibelLimiter: peak ${percent}% detected, sound muted`, Toasts.Type.MESSAGE);
        scheduleRestore(connection, userId, key);
    }
    catch (error) {
        console.error("[DecibelLimiter] Error hard‑muting:", error);
    }
}
function handleStats(connection, payload) {
    if (!settings.store.enabled)
        return;
    const inboundStats = extractInboundStats(payload);
    if (!inboundStats.length)
        return;
    const currentUser = UserStore.getCurrentUser();
    const currentUserId = currentUser?.id;
    const threshold = settings.store.thresholdPercent / 100;
    for (const stat of inboundStats) {
        const normalizedLevel = normalizeAudioLevel(stat.audioLevel);
        if (normalizedLevel < threshold)
            continue;
        const ssrc = Number(stat.ssrc);
        if (!Number.isFinite(ssrc))
            continue;
        const userId = connection.getUserIdBySsrc?.(ssrc);
        if (!userId || userId === currentUserId)
            continue;
        applyHardMute(connection, userId, normalizedLevel);
    }
}
function detachStats(connectionId) {
    const off = statsUnsubscribers.get(connectionId);
    if (off) {
        off();
        statsUnsubscribers.delete(connectionId);
    }
}
function attachStats(connection) {
    if (connection.context !== "default")
        return;
    const target = connection.emitter ?? connection;
    if (!target?.on)
        return;
    const connectionId = getConnectionId(connection);
    detachStats(connectionId);
    const statsHandler = (...args) => {
        for (const arg of args) {
            handleStats(connection, arg);
        }
    };
    target.on("stats", statsHandler);
    const off = () => {
        if (target.off) {
            target.off("stats", statsHandler);
        }
        else if (target.removeListener) {
            target.removeListener("stats", statsHandler);
        }
    };
    statsUnsubscribers.set(connectionId, off);
    log(`Stats listener attached to connection ${connectionId}`);
}
function attachConnectionListener() {
    mediaEngine = MediaEngineStore?.getMediaEngine?.();
    if (!mediaEngine) {
        console.warn("[DecibelLimiter] MediaEngine unavailable");
        return;
    }
    const existingConnections = Array.from(mediaEngine.connections ?? []);
    for (const connection of existingConnections) {
        attachStats(connection);
    }
    const target = mediaEngine.emitter ?? mediaEngine;
    if (!target?.on)
        return;
    const onConnection = (connection) => {
        attachStats(connection);
    };
    target.on("connection", onConnection);
    removeConnectionListener = () => {
        if (target.off) {
            target.off("connection", onConnection);
        }
        else if (target.removeListener) {
            target.removeListener("connection", onConnection);
        }
    };
}
function cleanup() {
    if (removeConnectionListener) {
        removeConnectionListener();
        removeConnectionListener = null;
    }
    for (const [connectionId, off] of statsUnsubscribers) {
        try {
            off();
        }
        catch (error) {
            console.error(`[DecibelLimiter] Error detaching ${connectionId}:`, error);
        }
    }
    statsUnsubscribers.clear();
    for (const timeout of restoreTimeouts.values()) {
        clearTimeout(timeout);
    }
    restoreTimeouts.clear();
    // Immediately restore volumes that are still muted when the plugin stops.
    for (const [key, remembered] of rememberedVolumes) {
        const target = mutedTargets.get(key);
        if (!target)
            continue;
        try {
            target.connection.setLocalVolume?.(target.userId, remembered);
            log(`Restoration on plugin stop for ${target.userId}: ${remembered}`);
        }
        catch (error) {
            console.error(`[DecibelLimiter] Error restoring stop (${target.userId}):`, error);
        }
    }
    rememberedVolumes.clear();
    mutedTargets.clear();
    lastTriggers.clear();
    mediaEngine = null;
}
export default definePlugin({
    name: "DecibelLimiter",
    description: "Automatically cuts off audio peaks that are too loud in voice calls",
    tags: ["Voice", "Utility"],
    authors: [{
            name: "Bash",
            id: 1327483363518582784n
        }],
    settings,
    start() {
        attachConnectionListener();
        toast("DecibelLimiter active", Toasts.Type.SUCCESS);
    },
    stop() {
        cleanup();
    }
});
