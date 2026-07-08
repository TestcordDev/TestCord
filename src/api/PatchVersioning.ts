/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Tracks the source-code hash of each successfully patched webpack module
 * so we can warn the user when Discord updates the underlying code — even
 * if the patch still works.
 *
 * The hash is a cheap djb2 of the original (pre-patch) factory source.
 * It's not cryptographic — we only need to detect "did the code change".
 *
 * Storage is in DataStore under `PatchVersioning_v1` as:
 *   Record<string, { hash: number; buildNumber: number; at: number }>
 * keyed by `${plugin}:${find}`.
 *
 * On boot we load the map into memory. When `patchFactory` successfully
 * applies a patch, it calls `PatchVersioning.checkAndStore()` with the
 * plugin name, find string, original source, and build number. If the
 * stored hash differs from the current one, we record a `codeChanged`
 * entry in PluginHealth.
 */

import * as DataStore from "@api/DataStore";
import { PluginHealth } from "@api/PluginHealth";

const DB_KEY = "PatchVersioning_v1";

interface StoredEntry {
    hash: number;
    buildNumber: number;
    at: number;
}

let stored: Record<string, StoredEntry> = {};
let loaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const pendingUpdates: Record<string, StoredEntry> = {};

/** Synchronous djb2 hash — fast, good enough for change detection. */
function djb2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash &= 0xffffffff;
    }
    return hash >>> 0;
}

async function load() {
    if (loaded) return;
    loaded = true;
    try {
        const data = await DataStore.get<Record<string, StoredEntry>>(DB_KEY);
        if (data && typeof data === "object") {
            stored = data;
        }
    } catch (err) {
        console.warn("[PatchVersioning] Failed to load:", err);
    }
}

function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
        flushTimer = null;
        try {
            // Merge pending updates into stored
            Object.assign(stored, pendingUpdates);
            await DataStore.set(DB_KEY, stored);
            // Clear pending since they're now in `stored`
            for (const key of Object.keys(pendingUpdates)) {
                delete pendingUpdates[key];
            }
        } catch (err) {
            console.warn("[PatchVersioning] Failed to flush:", err);
        }
    }, 10_000);
}

export const PatchVersioning = {
    /** Load stored hashes from disk. Called early during boot. */
    async init() {
        await load();
    },

    /**
     * Check whether the original factory source for a patch has changed
     * since the last session. If it has, record a `codeChanged` entry in
     * PluginHealth. Then store the new hash.
     *
     * Called from `patchFactory` after a patch is successfully applied.
     */
    checkAndStore(plugin: string, find: string, originalSource: string, buildNumber: number) {
        const key = `${plugin}:${find}`;
        const currentHash = djb2(originalSource);

        // Load lazily if not yet loaded — the check will just skip
        // gracefully if data isn't available yet on the very first run.
        if (!loaded) {
            // Store anyway so future sessions can compare.
            pendingUpdates[key] = { hash: currentHash, buildNumber, at: Date.now() };
            scheduleFlush();
            return;
        }

        const prev = stored[key];
        if (prev) {
            if (prev.hash !== currentHash) {
                // The Discord code underlying this patch changed between
                // sessions. Record a health entry — this is an early
                // warning even if the patch still works.
                PluginHealth.recordPatchFailure(plugin, {
                    kind: "codeChanged",
                    find,
                    moduleId: undefined,
                    error: `Source hash changed from ${prev.hash} to ${currentHash} (build ${prev.buildNumber} → ${buildNumber})`
                });
            }
        }

        pendingUpdates[key] = { hash: currentHash, buildNumber, at: Date.now() };
        scheduleFlush();
    },

    /** Clear all stored hashes. */
    async clear() {
        stored = {};
        for (const key of Object.keys(pendingUpdates)) {
            delete pendingUpdates[key];
        }
        try {
            await DataStore.set(DB_KEY, {});
        } catch (err) {
            console.warn("[PatchVersioning] Failed to clear:", err);
        }
    }
};
