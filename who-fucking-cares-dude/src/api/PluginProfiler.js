/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { RuntimeInterposition, RuntimeInterpositionPriority } from "./RuntimeInterposition";
const logger = new Logger("PluginProfiler", "#3498db");
// Best-effort plugin attribution from the call stack, mirroring the approach
// used by NetworkMonitor. When a plugin calls setInterval / addEventListener
// the synchronous call stack still contains the plugin's own source frame, so
// the folder name is recoverable.
const PLUGIN_PATH_PATTERNS = [
    /testcordplugins[/\\]([^/\\]+?)[/\\]/,
    /equicordplugins[/\\]([^/\\]+?)[/\\]/,
    /userplugins[/\\]([^/\\]+?)[/\\]/,
    /[/\\]plugins[/\\]([^/\\]+?)[/\\]/
];
function guessPluginFromStack() {
    try {
        const stack = new Error().stack ?? "";
        for (const pattern of PLUGIN_PATH_PATTERNS) {
            const match = stack.match(pattern);
            if (match)
                return match[1];
        }
    }
    catch {
        // Stack inspection is best-effort.
    }
    return null;
}
const metricsRegistry = new Map();
const listeners = new Set();
let slowCallThresholdMs = 16; // configurable threshold for slow call spikes
// ─── Auto-instrumentation state ─────────────────────────────
// Set once init() patches the globals, so we can restore them and avoid
// double-patching (e.g. across HMR reloads in dev).
let instrumented = false;
let originalSetInterval = null;
let originalClearInterval = null;
let disposeAddEventListener = null;
let disposeRemoveEventListener = null;
// Maps a live interval id to the plugin it was attributed to, so clearInterval
// can decrement the right plugin without re-walking the (now unrelated) stack.
const intervalOwners = new Map();
function ensureMetrics(pluginName) {
    let metrics = metricsRegistry.get(pluginName);
    if (!metrics) {
        metrics = {
            totalCpuTimeMs: 0,
            callCount: 0,
            maxCallMs: 0,
            slowSpikes: 0,
            asyncTimeMs: 0,
            activeIntervals: new Set(),
            activeListeners: new Set(),
            allocatedHeapBytes: 0,
            lastHeapBytes: 0,
            lastHeapDeltaMB: 0
        };
        metricsRegistry.set(pluginName, metrics);
    }
    return metrics;
}
function notifySubscribers() {
    for (const listener of listeners) {
        try {
            listener();
        }
        catch {
            // Ignore subscriber errors
        }
    }
}
/**
 * Calculates Composite Impact Score from measurable signals only.
 *
 * Impact Score = (CPU_ms * 0.5) + (Slow_Spikes * 25) + (Active_Resources * 5)
 *
 * Per-plugin RAM was previously a term here but has been removed: the browser
 * exposes no per-caller heap attribution, so the old Extra_RAM_MB value was
 * process-wide GC noise. The remaining terms are all real measurements.
 */
export function calculateImpactScore(cpuMs, slowSpikes, activeResources) {
    const score = (cpuMs * 0.5) + (slowSpikes * 25) + (activeResources * 5);
    return Math.round(score * 10) / 10;
}
/**
 * Calculates signal flags and automated lag advisories
 */
export function computeAdvisoriesAndSignals(cpuMs, slowSpikes, maxCallMs, callCount, activeResources) {
    const signals = [];
    if (cpuMs > 50)
        signals.push("Noticeable CPU");
    if (slowSpikes > 0)
        signals.push("Slow spike");
    if (maxCallMs > 30 || callCount > 200)
        signals.push("Slow calls");
    if (activeResources > 5)
        signals.push("Active listeners");
    let advisory = null;
    if (signals.includes("Slow spike") || cpuMs > 100) {
        advisory = "Temporarily disabling this plugin is recommended to compare client smoothness.";
    }
    else if (signals.length >= 2) {
        advisory = "Moderate overhead detected; monitor performance during intensive UI actions.";
    }
    else if (signals.length === 1) {
        advisory = "Minor overhead flag logged; plugin is performing within reasonable margins.";
    }
    return { signals, advisory };
}
export const PluginProfiler = {
    /**
     * Patch global timer and event-listener APIs so that intervals and
     * listeners created by plugins are attributed automatically. Without this,
     * `activeResources` only reflects the handful of plugins that manually call
     * `registerInterval` / `registerEventListener`, which made the column read
     * as a near-constant 0.
     *
     * Attribution is best-effort via the synchronous call stack at creation
     * time (same technique as NetworkMonitor). Calls from Discord's own code or
     * unattributable frames are left untouched so we never miscount them
     * against a plugin. Idempotent.
     *
     * Gated behind IS_DEV: stack inspection via `new Error().stack` on every
     * addEventListener/setInterval call is too expensive for production — React
     * fires these constantly. Plugins can still manually call registerInterval
     * / registerEventListener for explicit attribution.
     */
    init() {
        if (instrumented || typeof window === "undefined")
            return;
        if (!IS_DEV)
            return;
        instrumented = true;
        originalSetInterval = window.setInterval;
        originalClearInterval = window.clearInterval;
        const setIntervalOrig = originalSetInterval;
        const clearIntervalOrig = originalClearInterval;
        window.setInterval = function (...args) {
            const id = setIntervalOrig.apply(this, args);
            const plugin = guessPluginFromStack();
            if (plugin) {
                intervalOwners.set(id, plugin);
                const metrics = ensureMetrics(plugin);
                metrics.activeIntervals.add(id);
                notifySubscribers();
            }
            return id;
        };
        window.clearInterval = function (id) {
            if (id != null) {
                const plugin = intervalOwners.get(id);
                if (plugin != null) {
                    intervalOwners.delete(id);
                    const metrics = metricsRegistry.get(plugin);
                    if (metrics) {
                        metrics.activeIntervals.delete(id);
                        notifySubscribers();
                    }
                }
            }
            return clearIntervalOrig.call(this, id);
        };
        disposeAddEventListener = RuntimeInterposition.register({
            owner: "PluginProfiler",
            hook: "addEventListener",
            priority: RuntimeInterpositionPriority.DIAGNOSTICS,
            wrap: next => function (type, listener, options) {
                const ret = next.call(this, type, listener, options);
                if (listener) {
                    const plugin = guessPluginFromStack();
                    if (plugin) {
                        const metrics = ensureMetrics(plugin);
                        metrics.activeListeners.add({ target: this, type, listener });
                        notifySubscribers();
                    }
                }
                return ret;
            }
        });
        disposeRemoveEventListener = RuntimeInterposition.register({
            owner: "PluginProfiler",
            hook: "removeEventListener",
            priority: RuntimeInterpositionPriority.DIAGNOSTICS,
            wrap: next => function (type, listener, options) {
                const ret = next.call(this, type, listener, options);
                if (listener) {
                    for (const metrics of metricsRegistry.values()) {
                        for (const item of metrics.activeListeners) {
                            if (item.target === this && item.type === type && item.listener === listener) {
                                metrics.activeListeners.delete(item);
                                notifySubscribers();
                                break;
                            }
                        }
                    }
                }
                return ret;
            }
        });
    },
    /**
     * Restore the original global APIs and stop auto-instrumenting. Mainly for
     * teardown / tests; the tracked sets are left intact so existing profiles
     * remain readable.
     */
    teardown() {
        if (!instrumented || typeof window === "undefined")
            return;
        if (originalSetInterval)
            window.setInterval = originalSetInterval;
        if (originalClearInterval)
            window.clearInterval = originalClearInterval;
        disposeAddEventListener?.();
        disposeRemoveEventListener?.();
        disposeAddEventListener = null;
        disposeRemoveEventListener = null;
        instrumented = false;
    },
    setSlowCallThreshold(ms) {
        slowCallThresholdMs = ms;
    },
    getSlowCallThreshold() {
        return slowCallThresholdMs;
    },
    /**
     * Measure synchronous execution time of a plugin callback (lifecycle, listener, command, etc.)
     */
    profileExecution(pluginName, category, fn) {
        if (!pluginName)
            return fn();
        const start = performance.now();
        let result;
        try {
            result = fn();
        }
        finally {
            const duration = performance.now() - start;
            const metrics = ensureMetrics(pluginName);
            metrics.totalCpuTimeMs += duration;
            metrics.callCount++;
            if (duration > metrics.maxCallMs) {
                metrics.maxCallMs = duration;
            }
            if (duration >= slowCallThresholdMs) {
                metrics.slowSpikes++;
                logger.warn(`[Slow Call Spike] ${pluginName} (${category}): ${duration.toFixed(2)}ms (threshold: ${slowCallThresholdMs}ms)`);
            }
            notifySubscribers();
        }
        return result;
    },
    /**
     * Profile asynchronous execution or promise callbacks
     */
    async profileAsyncExecution(pluginName, category, promiseFn) {
        if (!pluginName)
            return promiseFn();
        const start = performance.now();
        try {
            return await promiseFn();
        }
        finally {
            const duration = performance.now() - start;
            const metrics = ensureMetrics(pluginName);
            metrics.asyncTimeMs += duration;
            notifySubscribers();
        }
    },
    /**
     * Register active setInterval handle for a plugin
     */
    registerInterval(pluginName, intervalId) {
        if (!pluginName)
            return;
        const metrics = ensureMetrics(pluginName);
        metrics.activeIntervals.add(intervalId);
        notifySubscribers();
    },
    /**
     * Unregister setInterval handle
     */
    unregisterInterval(pluginName, intervalId) {
        if (!pluginName)
            return;
        const metrics = metricsRegistry.get(pluginName);
        if (metrics) {
            metrics.activeIntervals.delete(intervalId);
            notifySubscribers();
        }
    },
    /**
     * Register active DOM/window event listener for a plugin
     */
    registerEventListener(pluginName, target, type, listener) {
        if (!pluginName)
            return;
        const metrics = ensureMetrics(pluginName);
        metrics.activeListeners.add({ target, type, listener });
        notifySubscribers();
    },
    /**
     * Unregister active DOM/window event listener
     */
    unregisterEventListener(pluginName, target, type, listener) {
        if (!pluginName)
            return;
        const metrics = metricsRegistry.get(pluginName);
        if (metrics) {
            for (const item of metrics.activeListeners) {
                if (item.target === target && item.type === type && item.listener === listener) {
                    metrics.activeListeners.delete(item);
                    break;
                }
            }
            notifySubscribers();
        }
    },
    /**
     * Get compiled diagnostic profile for a specific plugin
     */
    getProfile(pluginName) {
        const metrics = metricsRegistry.get(pluginName);
        const heapBytes = metrics?.lastHeapBytes ?? 0;
        const heapMB = Math.round((heapBytes / (1024 * 1024)) * 100) / 100;
        // extraRAMMB is retained for backwards compatibility with the export
        // schema but is no longer used for scoring — per-plugin heap cannot be
        // reliably attributed via the process-wide usedJSHeapSize counter.
        const extraRAMMB = 0;
        const cpuMs = Math.round((metrics?.totalCpuTimeMs ?? 0) * 10) / 10;
        const callCount = metrics?.callCount ?? 0;
        const maxCallMs = Math.round((metrics?.maxCallMs ?? 0) * 10) / 10;
        const slowSpikes = metrics?.slowSpikes ?? 0;
        const asyncTimeMs = Math.round((metrics?.asyncTimeMs ?? 0) * 10) / 10;
        const activeIntervals = metrics?.activeIntervals.size ?? 0;
        const activeListeners = metrics?.activeListeners.size ?? 0;
        const hookOwnership = RuntimeInterposition.getActiveHooks(pluginName);
        const activeHookLayers = hookOwnership.length;
        const activeResources = activeIntervals + activeListeners + activeHookLayers;
        const lastHeapDeltaMB = metrics?.lastHeapDeltaMB ?? 0;
        const impactScore = calculateImpactScore(cpuMs, slowSpikes, activeResources);
        const { signals, advisory } = computeAdvisoriesAndSignals(cpuMs, slowSpikes, maxCallMs, callCount, activeResources);
        return {
            pluginName,
            totalCpuTimeMs: cpuMs,
            callCount,
            maxCallMs,
            slowSpikes,
            asyncTimeMs,
            activeResources,
            activeIntervals,
            activeListeners,
            activeHookLayers,
            hookOwnership,
            heapBytes,
            heapMB,
            lastHeapDeltaMB,
            extraRAMMB,
            impactScore,
            signals,
            advisory
        };
    },
    /**
     * Get compiled diagnostic profiles for all monitored plugins
     */
    getAllProfiles() {
        const profiles = [];
        for (const pluginName of metricsRegistry.keys()) {
            profiles.push(this.getProfile(pluginName));
        }
        return profiles;
    },
    /**
     * Reset recorded performance metrics
     */
    resetMetrics() {
        metricsRegistry.clear();
        notifySubscribers();
    },
    /**
     * Reset metrics for a single plugin
     */
    resetPluginMetrics(pluginName) {
        metricsRegistry.delete(pluginName);
        notifySubscribers();
    },
    /**
     * Subscribe to profiler metric updates
     */
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
};
// Global inspection binding
if (typeof globalThis !== "undefined") {
    globalThis.__pluginProfiler = PluginProfiler;
}
