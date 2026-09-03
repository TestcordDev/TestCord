/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
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

/**
 * Lightweight, always-on tracker for plugin runtime health.
 *
 * Populated from the webpack patcher (`patchWebpack.ts`) and from any code
 * path that wants to report a plugin failure. Consumed by the Plugin Health
 * settings tab and the "Report Issue" flow.
 *
 * Also persists a rolling summary of the last N sessions so we can compute
 * a per-plugin stability score across restarts. The stability score is
 * derived from `sessionsBroken / sessionsSeen` over a rolling window.
 *
 * Kept intentionally small — this module runs early during boot, before
 * most of the codebase is initialised. Persistence layer is fully lazy:
 * the module works with an empty history if `DataStore` is unavailable
 * (e.g. during unit tests).
 */

import * as DataStore from "@api/DataStore";

export type PatchFailureKind = "noModule" | "noEffect" | "errored" | "undoingGroup" | "conflict" | "codeChanged";

export interface PatchFailure {
    kind: PatchFailureKind;
    /** The stringified regex or string that the patch was looking for */
    find: string;
    /** The stringified match that failed (only for noEffect / errored / undoingGroup) */
    match?: string;
    /** Serialized module id (for noEffect / errored / undoingGroup) */
    moduleId?: string;
    /** Truncated error message when kind === "errored" */
    error?: string;
    sourceContext?: string;
    /** ms since epoch when the failure was recorded */
    at: number;
}

export interface RuntimeError {
    /** Where the error came from (e.g. "start", "stop", "flux:MESSAGE_CREATE") */
    source: string;
    /** Truncated error message */
    error: string;
    at: number;
}

export interface RuntimeHookEvidence {
    owner: string;
    hook: string;
    priority: number;
}

export interface ResourceDelta {
    timers: number;
    listeners: number;
    observers: number;
    subscriptions: number;
    hookLayers: number;
}

export interface CallbackPercentiles {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
}

interface PluginHealthEntry {
    patchFailures: PatchFailure[];
    runtimeErrors: RuntimeError[];
    runtimeHooks?: RuntimeHookEvidence[];
    resourceDelta?: ResourceDelta;
    callbackPercentiles?: CallbackPercentiles;
}

export type { PluginHealthEntry };

/** A recorded summary of one Testcord session. */
export interface SessionRecord {
    id: string;
    startedAt: number;
    endedAt: number;
    /** Names of plugins that were enabled during the session. */
    enabledPlugins: string[];
    /**
     * Per-plugin counts recorded during the session. Absent plugins in this
     * map are considered "healthy that session".
     */
    plugins: Record<string, {
        patchFailures: number;
        runtimeErrors: number;
        sourceChanges?: number;
    }>;
}

export type StabilityBadge = "stable" | "flaky" | "unstable" | "unknown";

export interface StabilityScore {
    badge: StabilityBadge;
    sessionsSeen: number;
    sessionsBroken: number;
    /** Ratio in [0, 1]; NaN if `sessionsSeen === 0`. */
    ratio: number;
}

const MAX_ENTRIES_PER_PLUGIN = 50;
const MAX_ERROR_STRING_LENGTH = 2000;
/** How many past sessions to keep. */
const HISTORY_WINDOW = 10;
/** Minimum sessions before we consider a plugin's badge trustworthy. */
const MIN_SESSIONS_FOR_BADGE = 3;
/** Ratio above which a plugin is flagged as unstable. */
const UNSTABLE_RATIO = 0.4;
/** Debounce delay before flushing session summary to DataStore. */
const FLUSH_DEBOUNCE_MS = 5_000;

export interface CrashLogEntry {
    timestamp: number;
    pluginName?: string;
    reason: string;
    stack?: string;
}

export interface PluginStateChangeEntry {
    timestamp: number;
    pluginName: string;
    enabled: boolean;
}

const DB_KEY_SAFE_MODE = "TestCord_SafeMode_v1";
const DB_KEY_QUARANTINE = "TestCord_Quarantine_v1";
const DB_KEY_CRASH_LOGS = "TestCord_CrashLogs_v1";
const DB_KEY_PLUGIN_CHANGES = "TestCord_PluginChanges_v1";
const DB_KEY_IGNORE_SOURCE_HEALTH = "PluginHealth_IgnoreSourceHealth_v1";
const DB_KEY_IGNORE_SOURCE_HISTORY = "PluginHealth_IgnoreSourceHistory_v1";

let safeModeEnabled = false;
let safeModeLoaded = false;
let quarantinedPlugins: string[] = [];
let quarantineLoaded = false;
let crashHistory: CrashLogEntry[] = [];
let crashLogsLoaded = false;
let pluginStateChanges: PluginStateChangeEntry[] = [];
let pluginChangesLoaded = false;
let ignoreSourceHealth = false;
let ignoreSourceHistory = false;
let sourceSettingsLoaded = false;

const DB_KEY_HISTORY = "PluginHealthHistory_v1";

const registry = new Map<string, PluginHealthEntry>();
const listeners = new Set<() => void>();
let runtimeHookProvider: ((plugin: string) => RuntimeHookEvidence[]) | null = null;

const currentSession: SessionRecord = createSession();
let history: SessionRecord[] = [];
let historyLoaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

function makeSessionId(): string {
    // Small non-cryptographic id. `nanoid` is a dependency but we intentionally
    // avoid importing it here to keep this module dependency-light.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSession(): SessionRecord {
    return {
        id: makeSessionId(),
        startedAt: Date.now(),
        endedAt: Date.now(),
        enabledPlugins: [],
        plugins: {}
    };
}

function truncate(value: string): string {
    if (value.length <= MAX_ERROR_STRING_LENGTH) return value;
    return value.slice(0, MAX_ERROR_STRING_LENGTH) + "\n… (truncated)";
}

function ensureEntry(plugin: string): PluginHealthEntry {
    let entry = registry.get(plugin);
    if (!entry) {
        entry = { patchFailures: [], runtimeErrors: [], runtimeHooks: [] };
        registry.set(plugin, entry);
    }
    return entry;
}

function push<T>(list: T[], value: T) {
    list.push(value);
    if (list.length > MAX_ENTRIES_PER_PLUGIN) list.shift();
}

function bumpSessionCounter(plugin: string, kind: "patchFailures" | "runtimeErrors" | "sourceChanges") {
    if (!plugin || plugin === "Unknown source") return;
    const existing = currentSession.plugins[plugin] ??= { patchFailures: 0, runtimeErrors: 0, sourceChanges: 0 };
    existing[kind] = (existing[kind] ?? 0) + 1;
    currentSession.endedAt = Date.now();
    scheduleFlush();
}

function notify() {
    for (const listener of listeners) {
        try {
            listener();
        } catch {
            // Ignore listener errors; a broken UI subscriber must not break the tracker.
        }
    }
}

async function loadSourceSettings(): Promise<{ ignoreHealth: boolean; ignoreHistory: boolean }> {
    if (!sourceSettingsLoaded) {
        try {
            const [health, hist] = await Promise.all([
                DataStore.get<boolean>(DB_KEY_IGNORE_SOURCE_HEALTH),
                DataStore.get<boolean>(DB_KEY_IGNORE_SOURCE_HISTORY)
            ]);
            if (typeof health === "boolean") ignoreSourceHealth = health;
            if (typeof hist === "boolean") ignoreSourceHistory = hist;
        } catch (err) {
            console.warn("[PluginHealth] Failed to load source change settings:", err);
        }
        sourceSettingsLoaded = true;
    }
    return { ignoreHealth: ignoreSourceHealth, ignoreHistory: ignoreSourceHistory };
}

async function loadHistory() {
    if (historyLoaded) return;
    historyLoaded = true; // set optimistically to avoid re-entrant loads
    void loadSourceSettings();

    try {
        const stored = await DataStore.get<SessionRecord[]>(DB_KEY_HISTORY);
        if (Array.isArray(stored)) {
            // Defensive: filter obviously malformed entries and clamp to window.
            history = stored
                .filter(s => s && typeof s.id === "string" && typeof s.startedAt === "number" && s.plugins)
                .slice(-HISTORY_WINDOW);
            notify();
        }
    } catch (err) {
        // History is best-effort. If IndexedDB is unavailable (e.g. private
        // browsing on the web build), just proceed with an empty history.
        console.warn("[PluginHealth] Failed to load history:", err);
    }
}

function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushNow();
    }, FLUSH_DEBOUNCE_MS);
}

async function flushNow() {
    if (flushInFlight) return;
    // Wait until history has loaded so we don't overwrite it with just the
    // current session.
    if (!historyLoaded) {
        await loadHistory();
    }
    flushInFlight = true;
    try {
        const merged = [
            ...history.filter(s => s.id !== currentSession.id),
            currentSession
        ].slice(-HISTORY_WINDOW);
        await DataStore.set(DB_KEY_HISTORY, merged);
        history = merged;
    } catch (err) {
        console.warn("[PluginHealth] Failed to persist history:", err);
    } finally {
        flushInFlight = false;
    }
}

function computeStability(plugin: string, options?: { excludeSourceChanges?: boolean }): StabilityScore {
    let sessionsSeen = 0;
    let sessionsBroken = 0;

    // Include the current session too, but only if the plugin is in
    // enabledPlugins (otherwise "seen" is not meaningful).
    const sessions = [...history.filter(s => s.id !== currentSession.id), currentSession];
    for (const session of sessions) {
        const counts = session.plugins?.[plugin];
        // A plugin counts as "seen" this session if it was registered as
        // enabled OR if it recorded any counts. The latter matters at boot:
        // webpack patch failures fire during patching, before
        // `registerEnabledPlugins` runs, so the plugin may not yet be in
        // `enabledPlugins` even though it clearly ran this session.
        const seen = session.enabledPlugins?.includes(plugin) || counts != null;
        if (!seen) continue;
        sessionsSeen++;
        if (counts) {
            const excludeSource = options?.excludeSourceChanges ?? ignoreSourceHistory;
            const hasPatch = counts.patchFailures > 0;
            const hasRuntime = counts.runtimeErrors > 0;
            const hasSource = !excludeSource && (counts.sourceChanges ?? 0) > 0;
            if (hasPatch || hasRuntime || hasSource) {
                sessionsBroken++;
            }
        }
    }

    const ratio = sessionsSeen === 0 ? NaN : sessionsBroken / sessionsSeen;

    let badge: StabilityBadge;
    if (sessionsSeen < MIN_SESSIONS_FOR_BADGE) {
        badge = "unknown";
    } else if (sessionsBroken === 0) {
        badge = "stable";
    } else if (ratio >= UNSTABLE_RATIO) {
        badge = "unstable";
    } else {
        badge = "flaky";
    }

    return { badge, sessionsSeen, sessionsBroken, ratio };
}

if (typeof window !== "undefined") {
    // Best-effort flush on page unload. Kept in a closure so it can be
    // registered synchronously without waiting for anything to load.
    window.addEventListener("beforeunload", () => {
        // Cancel the debounced timer and fire immediately. We deliberately
        // fire and forget — the browser will kill this frame before the
        // promise resolves, but DataStore/IndexedDB will typically flush
        // its pending transaction to disk.
        if (flushTimer) clearTimeout(flushTimer);
        void flushNow();
    });
}

export const PluginHealth = {
    /**
     * Record a webpack patch failure for a plugin.
     *
     * Called from `patchWebpack.ts`. Safe to call as often as needed — entries
     * are capped per plugin and duplicates are collapsed by `find`+`match`+`kind`.
     */
    recordPatchFailure(plugin: string, failure: Omit<PatchFailure, "at">) {
        if (!plugin) return;
        const entry = ensureEntry(plugin);

        // Collapse duplicate failures: patches can fail across many modules and
        // we do not want to blow up the ring buffer with the same message.
        // For conflicts, collapse by find+moduleId+kind (ignore match/error
        // since multiple replacements on the same module produce redundant entries).
        const duplicate = entry.patchFailures.find(f =>
            f.kind === failure.kind
            && f.find === failure.find
            && f.match === failure.match
        );
        if (duplicate) {
            duplicate.at = Date.now();
            if (failure.moduleId && duplicate.moduleId !== failure.moduleId) {
                // Track the most recent module id we saw the failure on.
                duplicate.moduleId = failure.moduleId;
            }
            notify();
            return;
        }

        push(entry.patchFailures, {
            ...failure,
            error: failure.error ? truncate(failure.error) : undefined,
            at: Date.now()
        });
        bumpSessionCounter(plugin, failure.kind === "codeChanged" ? "sourceChanges" : "patchFailures");
        notify();
    },

    /**
     * Record a runtime error thrown from a plugin's lifecycle or event handlers.
     */
    recordRuntimeError(plugin: string, source: string, error: unknown) {
        if (!plugin) return;
        const entry = ensureEntry(plugin);
        const message = error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
            : String(error);
        push(entry.runtimeErrors, {
            source,
            error: truncate(message),
            at: Date.now()
        });
        bumpSessionCounter(plugin, "runtimeErrors");
        notify();
    },

    /**
     * Register the set of plugins currently enabled in this session. This
     * lets us compute "sessions seen" for the stability score — a plugin
     * that was disabled during a session cannot have "broken" that session.
     *
     * Called by `PluginManager.startAllPlugins` once startup is complete.
     */
    registerEnabledPlugins(plugins: readonly string[]) {
        currentSession.enabledPlugins = Array.from(new Set(plugins));
        currentSession.endedAt = Date.now();
        scheduleFlush();
        // No notify() needed — this doesn't change the visible failure list.
    },

    /** Get a snapshot of a plugin's health entry, or `undefined` if the plugin is healthy. */
    get(plugin: string): PluginHealthEntry | undefined {
        const entry = registry.get(plugin);
        const runtimeHooks = runtimeHookProvider?.(plugin) ?? [];
        if (!entry && !runtimeHooks.length) return undefined;
        return {
            patchFailures: [...(entry?.patchFailures ?? [])],
            runtimeErrors: [...(entry?.runtimeErrors ?? [])],
            runtimeHooks,
            resourceDelta: entry?.resourceDelta,
            callbackPercentiles: entry?.callbackPercentiles
        };
    },

    /** Get a snapshot of every plugin that has recorded a failure. */
    getAll(): ReadonlyMap<string, PluginHealthEntry> {
        const snapshot = new Map<string, PluginHealthEntry>();
        for (const [name, entry] of registry) {
            if (entry.patchFailures.length || entry.runtimeErrors.length) {
                snapshot.set(name, {
                    patchFailures: [...entry.patchFailures],
                    runtimeErrors: [...entry.runtimeErrors],
                    runtimeHooks: runtimeHookProvider?.(name) ?? [],
                    resourceDelta: entry.resourceDelta,
                    callbackPercentiles: entry.callbackPercentiles
                });
            }
        }
        return snapshot;
    },

    /** Whether the given plugin has any recorded issues. */
    hasIssues(plugin: string, options?: { excludeSourceChanges?: boolean }): boolean {
        const entry = registry.get(plugin);
        if (!entry) return false;
        const excludeSource = options?.excludeSourceChanges ?? ignoreSourceHealth;
        const patchFailures = excludeSource
            ? entry.patchFailures.filter(f => f.kind !== "codeChanged")
            : entry.patchFailures;
        return patchFailures.length > 0 || entry.runtimeErrors.length > 0;
    },

    /** Total number of plugins with recorded issues. */
    totalUnhealthyPlugins(options?: { excludeSourceChanges?: boolean }): number {
        const excludeSource = options?.excludeSourceChanges ?? ignoreSourceHealth;
        let count = 0;
        for (const entry of registry.values()) {
            const patchFailures = excludeSource
                ? entry.patchFailures.filter(f => f.kind !== "codeChanged")
                : entry.patchFailures;
            if (patchFailures.length || entry.runtimeErrors.length) count++;
        }
        return count;
    },

    /** Clear all recorded failures for a plugin. Useful after a restart / re-patch. */
    clear(plugin: string) {
        if (registry.delete(plugin)) notify();
    },

    /**
     * Remove patch failures for a plugin that match the given predicate.
     * Used to clear false positives (e.g. a module flagged as "noModule"
     * that was actually lazy-loaded later).
     */
    clearPatchFailures(plugin: string, predicate: (f: PatchFailure) => boolean) {
        const entry = registry.get(plugin);
        if (!entry) return;
        const before = entry.patchFailures.length;
        entry.patchFailures = entry.patchFailures.filter(f => !predicate(f));
        if (entry.patchFailures.length === before) return;
        if (!entry.patchFailures.length && !entry.runtimeErrors.length) {
            registry.delete(plugin);
        }
        notify();
    },

    /** Clear recorded runtime errors for a plugin, dropping the entry if nothing is left. */
    clearRuntimeErrors(plugin: string) {
        const entry = registry.get(plugin);
        if (!entry) return;
        if (entry.runtimeErrors.length === 0) return;
        entry.runtimeErrors = [];
        if (!entry.patchFailures.length) {
            registry.delete(plugin);
        }
        notify();
    },

    /**
     * Clear everything in memory. Does NOT wipe persisted history — call
     * `clearHistory()` for that.
     */
    clearAll() {
        if (registry.size === 0) return;
        registry.clear();
        notify();
    },

    /**
     * Compute the stability score for a plugin across the rolling session
     * window (including the current session).
     */
    getStability(plugin: string, options?: { excludeSourceChanges?: boolean }): StabilityScore {
        return computeStability(plugin, options);
    },

    /** Snapshot of the recorded session history (oldest first). */
    getHistory(): readonly SessionRecord[] {
        return [...history];
    },

    /** Snapshot of the current (in-progress) session. */
    getCurrentSession(): SessionRecord {
        return {
            ...currentSession,
            enabledPlugins: [...currentSession.enabledPlugins],
            plugins: { ...currentSession.plugins }
        };
    },

    /** Wipe persisted session history. Preserves the current session. */
    async clearHistory() {
        history = [];
        try {
            await DataStore.set(DB_KEY_HISTORY, []);
        } catch (err) {
            console.warn("[PluginHealth] Failed to wipe history:", err);
        }
        notify();
    },

    /**
     * Ensure historical data has been loaded from disk. Automatically invoked
     * on first flush; the settings UI calls this eagerly on mount so the
     * stability badges have real data before the user looks at them.
     */
    async loadHistory() {
        await loadHistory();
    },

    /** Subscribe to changes. Returns an unsubscribe function. */
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    setRuntimeHookProvider(provider: ((plugin: string) => RuntimeHookEvidence[]) | null) {
        runtimeHookProvider = provider;
        notify();
    },

    // ─── Source Change Settings ─────────────────────────────

    async loadSourceSettings(): Promise<{ ignoreHealth: boolean; ignoreHistory: boolean; }> {
        return loadSourceSettings();
    },

    isIgnoreSourceHealth(): boolean {
        return ignoreSourceHealth;
    },

    async setIgnoreSourceHealth(ignore: boolean): Promise<void> {
        ignoreSourceHealth = ignore;
        sourceSettingsLoaded = true;
        try {
            await DataStore.set(DB_KEY_IGNORE_SOURCE_HEALTH, ignore);
        } catch (err) {
            console.warn("[PluginHealth] Failed to persist ignoreSourceHealth state:", err);
        }
        notify();
    },

    isIgnoreSourceHistory(): boolean {
        return ignoreSourceHistory;
    },

    async setIgnoreSourceHistory(ignore: boolean): Promise<void> {
        ignoreSourceHistory = ignore;
        sourceSettingsLoaded = true;
        try {
            await DataStore.set(DB_KEY_IGNORE_SOURCE_HISTORY, ignore);
        } catch (err) {
            console.warn("[PluginHealth] Failed to persist ignoreSourceHistory state:", err);
        }
        notify();
    },

    // ─── Safe Mode & Crash Recovery ─────────────────────────

    async loadSafeMode(): Promise<boolean> {
        if (!safeModeLoaded) {
            try {
                safeModeEnabled = (await DataStore.get<boolean>(DB_KEY_SAFE_MODE)) ?? false;
            } catch {
                safeModeEnabled = false;
            }
            safeModeLoaded = true;
        }
        return safeModeEnabled;
    },

    isSafeModeEnabled(): boolean {
        return safeModeEnabled;
    },

    async setSafeMode(enabled: boolean): Promise<void> {
        safeModeEnabled = enabled;
        safeModeLoaded = true;
        try {
            await DataStore.set(DB_KEY_SAFE_MODE, enabled);
        } catch (err) {
            console.warn("[PluginHealth] Failed to persist safe mode state:", err);
        }
        notify();
    },

    // ─── Plugin Quarantine ──────────────────────────────────

    async loadQuarantine(): Promise<string[]> {
        if (!quarantineLoaded) {
            try {
                const stored = await DataStore.get<string[]>(DB_KEY_QUARANTINE);
                if (Array.isArray(stored)) quarantinedPlugins = stored;
            } catch {
                quarantinedPlugins = [];
            }
            quarantineLoaded = true;
        }
        return [...quarantinedPlugins];
    },

    getQuarantinedPlugins(): string[] {
        return [...quarantinedPlugins];
    },

    isQuarantined(pluginName: string): boolean {
        return quarantinedPlugins.includes(pluginName);
    },

    async quarantinePlugin(pluginName: string): Promise<void> {
        if (!quarantinedPlugins.includes(pluginName)) {
            quarantinedPlugins.push(pluginName);
            quarantineLoaded = true;
            try {
                await DataStore.set(DB_KEY_QUARANTINE, quarantinedPlugins);
            } catch (err) {
                console.warn("[PluginHealth] Failed to persist quarantine state:", err);
            }
            notify();
        }
    },

    async unquarantinePlugin(pluginName: string): Promise<void> {
        if (quarantinedPlugins.includes(pluginName)) {
            quarantinedPlugins = quarantinedPlugins.filter(p => p !== pluginName);
            quarantineLoaded = true;
            try {
                await DataStore.set(DB_KEY_QUARANTINE, quarantinedPlugins);
            } catch (err) {
                console.warn("[PluginHealth] Failed to persist quarantine state:", err);
            }
            notify();
        }
    },

    // ─── Crash History Log ──────────────────────────────────

    async loadCrashHistory(): Promise<CrashLogEntry[]> {
        if (!crashLogsLoaded) {
            try {
                const stored = await DataStore.get<CrashLogEntry[]>(DB_KEY_CRASH_LOGS);
                if (Array.isArray(stored)) crashHistory = stored;
            } catch {
                crashHistory = [];
            }
            crashLogsLoaded = true;
        }
        return [...crashHistory];
    },

    getCrashHistory(): CrashLogEntry[] {
        return [...crashHistory];
    },

    async recordCrash(entry: Omit<CrashLogEntry, "timestamp">): Promise<void> {
        const fullEntry: CrashLogEntry = {
            ...entry,
            timestamp: Date.now()
        };
        crashHistory.unshift(fullEntry);
        if (crashHistory.length > 50) crashHistory.pop();
        crashLogsLoaded = true;
        try {
            await DataStore.set(DB_KEY_CRASH_LOGS, crashHistory);
        } catch (err) {
            console.warn("[PluginHealth] Failed to persist crash log:", err);
        }
        notify();

        // Auto-quarantine: a plugin that crashed three or more times within
        // the last 24 hours is isolated so the next boot starts without it.
        // The user can restore it from the Crash Recovery card.
        if (entry.pluginName && !quarantinedPlugins.includes(entry.pluginName)) {
            const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
            const recentCrashes = crashHistory.filter(
                c => c.pluginName === entry.pluginName && c.timestamp >= dayAgo
            ).length;
            if (recentCrashes >= 3) {
                await this.quarantinePlugin(entry.pluginName);
            }
        }
    },

    async clearCrashHistory(): Promise<void> {
        crashHistory = [];
        try {
            await DataStore.set(DB_KEY_CRASH_LOGS, []);
        } catch (err) {
            console.warn("[PluginHealth] Failed to clear crash history:", err);
        }
        notify();
    },

    // ─── Plugin State Change Log ────────────────────────────

    async loadPluginChanges(): Promise<PluginStateChangeEntry[]> {
        if (!pluginChangesLoaded) {
            try {
                const stored = await DataStore.get<PluginStateChangeEntry[]>(DB_KEY_PLUGIN_CHANGES);
                if (Array.isArray(stored)) pluginStateChanges = stored;
            } catch {
                pluginStateChanges = [];
            }
            pluginChangesLoaded = true;
        }
        return [...pluginStateChanges];
    },

    getRecentPluginChanges(): PluginStateChangeEntry[] {
        return [...pluginStateChanges];
    },

    async recordPluginChange(pluginName: string, enabled: boolean): Promise<void> {
        const entry: PluginStateChangeEntry = {
            timestamp: Date.now(),
            pluginName,
            enabled
        };
        pluginStateChanges.unshift(entry);
        if (pluginStateChanges.length > 50) pluginStateChanges.pop();
        pluginChangesLoaded = true;

        // Keep the current session's enabled list truthful for tools that
        // diff "what changed since the last healthy session".
        const set = new Set(currentSession.enabledPlugins);
        if (enabled) set.add(pluginName);
        else set.delete(pluginName);
        currentSession.enabledPlugins = Array.from(set);

        try {
            await DataStore.set(DB_KEY_PLUGIN_CHANGES, pluginStateChanges);
        } catch (err) {
            console.warn("[PluginHealth] Failed to persist plugin change log:", err);
        }
        notify();
    },

    async clearPluginChanges(): Promise<void> {
        pluginStateChanges = [];
        try {
            await DataStore.set(DB_KEY_PLUGIN_CHANGES, []);
        } catch (err) {
            console.warn("[PluginHealth] Failed to clear plugin change log:", err);
        }
        notify();
    }
};

// Expose on the global Vencord object so it can be inspected from the console
// and consumed by external tools like the reporter without a static import cycle.
if (typeof globalThis !== "undefined") {
    (globalThis as any).__pluginHealth = PluginHealth;
}

// ─── Global error capture ────────────────────────────────────────────────
// Catches errors that none of the explicit wrappers (start/stop/flux) see:
// async callbacks, event handlers, timers. Attribution is best-effort from
// the stack, mirroring NetworkMonitor. Patterns are defined locally to keep
// this module dependency-light (it runs early during boot).
const GLOBAL_ERROR_PLUGIN_PATTERNS = [
    /testcordplugins[/\\]([^/\\]+?)[/\\]/,
    /equicordplugins[/\\]([^/\\]+?)[/\\]/,
    /userplugins[/\\]([^/\\]+?)[/\\]/
];
let lastUnknownErrorAt = 0;

const IGNORED_GLOBAL_ERROR_PATTERNS = [
    /ResizeObserver loop completed with undelivered notifications/i,
    /ResizeObserver loop limit exceeded/i,
    /The play\(\) request was interrupted/i,
    /AbortError/i,
    /^Script error\.?$/i,
    /HTTPResponseError:.*\[429\]/i,
    /Failed to fetch/i,
    /NetworkError/i,
    /Load failed/i,
    /Sentry successfully disabled/i
];

function isIgnoredGlobalError(message: string, stack: string): boolean {
    const combined = `${message}\n${stack}`;
    return IGNORED_GLOBAL_ERROR_PATTERNS.some(pattern => pattern.test(combined));
}

function attributeGlobalError(source: string, error: unknown) {
    try {
        const message = error instanceof Error ? error.message : String(error ?? "");
        const stack = error instanceof Error ? (error.stack ?? "") : String(error ?? "");

        if (isIgnoredGlobalError(message, stack)) return;

        let plugin = "Unknown source";
        for (const pattern of GLOBAL_ERROR_PLUGIN_PATTERNS) {
            const match = stack.match(pattern);
            if (match) {
                plugin = match[1];
                break;
            }
        }
        if (plugin === "Unknown source") {
            // Discord's own code is noisy; keep unattributed errors but
            // throttle them so they cannot flood the buffer.
            const now = Date.now();
            if (now - lastUnknownErrorAt < 5_000) return;
            lastUnknownErrorAt = now;
        }
        PluginHealth.recordRuntimeError(plugin, source, error ?? new Error(source));
    } catch {
        // The capture hook itself must never throw.
    }
}

if (typeof window !== "undefined") {
    window.addEventListener("error", e => attributeGlobalError("window.onerror", e.error ?? e.message));
    window.addEventListener("unhandledrejection", e => attributeGlobalError("unhandledrejection", e.reason));
}
