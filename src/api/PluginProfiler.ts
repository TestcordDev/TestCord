/*
 * TestCord, a modification for Discord's desktop app
 * Client Health & Diagnostic Suite - Plugin Profiler Engine
 */

import { Logger } from "@utils/Logger";

const logger = new Logger("PluginProfiler", "#3498db");

export interface FluxSurfaceMetric {
    action: string;
    calls: number;
    totalTimeMs: number;
    maxTimeMs: number;
}

export interface PluginProfileData {
    pluginName: string;
    totalCpuTimeMs: number;
    callCount: number;
    maxCallMs: number;
    slowSpikes: number;
    asyncTimeMs: number;
    activeResources: number;
    activeIntervals: number;
    activeListeners: number;
    heapBytes: number;
    heapMB: number;
    lastHeapDeltaMB: number;
    extraRAMMB: number;
    impactScore: number;
    signals: SignalFlag[];
    advisory: string | null;
    fluxSurfaces: FluxSurfaceMetric[];
}

export type SignalFlag = "Noticeable CPU" | "Slow spike" | "Slow calls" | "Growing heap" | "Active listeners";

interface RawPluginMetrics {
    totalCpuTimeMs: number;
    callCount: number;
    maxCallMs: number;
    slowSpikes: number;
    asyncTimeMs: number;
    activeIntervals: Set<number>;
    activeListeners: Set<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject }>;
    allocatedHeapBytes: number;
    lastHeapBytes: number;
    lastHeapDeltaMB: number;
    fluxActions: Map<string, { calls: number; totalTimeMs: number; maxTimeMs: number }>;
}

const metricsRegistry = new Map<string, RawPluginMetrics>();
const listeners = new Set<() => void>();

let slowCallThresholdMs = 16; // configurable threshold for slow call spikes

function ensureMetrics(pluginName: string): RawPluginMetrics {
    let metrics = metricsRegistry.get(pluginName);
    if (!metrics) {
        const initialHeap = getJSHeapSize();
        metrics = {
            totalCpuTimeMs: 0,
            callCount: 0,
            maxCallMs: 0,
            slowSpikes: 0,
            asyncTimeMs: 0,
            activeIntervals: new Set(),
            activeListeners: new Set(),
            allocatedHeapBytes: 0,
            lastHeapBytes: initialHeap,
            lastHeapDeltaMB: 0,
            fluxActions: new Map()
        };
        metricsRegistry.set(pluginName, metrics);
    }
    return metrics;
}

function getJSHeapSize(): number {
    if (typeof window !== "undefined" && (window.performance as any)?.memory?.usedJSHeapSize) {
        return (window.performance as any).memory.usedJSHeapSize;
    }
    return 0;
}

function notifySubscribers() {
    for (const listener of listeners) {
        try {
            listener();
        } catch {
            // Ignore subscriber errors
        }
    }
}

/**
 * Calculates Composite Impact Score:
 * Impact Score = (CPU_ms * 0.4) + (Extra_RAM_MB * 4.0) + (Slow_Spikes * 25) + (Active_Resources * 5)
 */
export function calculateImpactScore(
    cpuMs: number,
    heapMb: number,
    slowSpikes: number,
    activeResources: number
): number {
    const score = (cpuMs * 0.4) + (heapMb * 4.0) + (slowSpikes * 25) + (activeResources * 5);
    return Math.round(score * 10) / 10;
}

/**
 * Calculates signal flags and automated lag advisories
 */
export function computeAdvisoriesAndSignals(
    cpuMs: number,
    heapMb: number,
    slowSpikes: number,
    maxCallMs: number,
    callCount: number,
    activeResources: number
): { signals: SignalFlag[]; advisory: string | null } {
    const signals: SignalFlag[] = [];

    if (cpuMs > 50) signals.push("Noticeable CPU");
    if (slowSpikes > 0) signals.push("Slow spike");
    if (maxCallMs > 30 || callCount > 200) signals.push("Slow calls");
    if (heapMb > 2.0) signals.push("Growing heap");
    if (activeResources > 5) signals.push("Active listeners");

    let advisory: string | null = null;
    if (signals.includes("Slow spike") || cpuMs > 100 || heapMb > 10) {
        advisory = "Temporarily disabling this plugin is recommended to compare client smoothness.";
    } else if (signals.length >= 2) {
        advisory = "Moderate overhead detected; monitor performance during intensive UI actions.";
    } else if (signals.length === 1) {
        advisory = "Minor overhead flag logged; plugin is performing within reasonable margins.";
    }

    return { signals, advisory };
}

export const PluginProfiler = {
    setSlowCallThreshold(ms: number) {
        slowCallThresholdMs = ms;
    },

    getSlowCallThreshold(): number {
        return slowCallThresholdMs;
    },

    /**
     * Get actual JS process heap size currently used by Discord in MB
     */
    getClientTotalHeapMB(): number {
        const bytes = getJSHeapSize();
        return Math.round((bytes / (1024 * 1024)) * 10) / 10;
    },

    /**
     * Measure synchronous execution time of a plugin callback (lifecycle, listener, command, etc.)
     */
    profileExecution<T>(pluginName: string, category: string, fn: () => T): T {
        if (!pluginName) return fn();

        const startHeap = getJSHeapSize();
        const start = performance.now();
        let result: T;
        try {
            result = fn();
        } finally {
            const duration = performance.now() - start;
            const endHeap = getJSHeapSize();
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

            if (endHeap > 0 && startHeap > 0) {
                const heapDeltaBytes = endHeap - startHeap;
                if (heapDeltaBytes > 0) {
                    metrics.allocatedHeapBytes += heapDeltaBytes;
                    metrics.lastHeapDeltaMB = Math.round((heapDeltaBytes / (1024 * 1024)) * 100) / 100;
                }
                metrics.lastHeapBytes = endHeap;
            }

            notifySubscribers();
        }
        return result;
    },

    /**
     * Profile asynchronous execution or promise callbacks
     */
    async profileAsyncExecution<T>(pluginName: string, category: string, promiseFn: () => Promise<T>): Promise<T> {
        if (!pluginName) return promiseFn();

        const start = performance.now();
        try {
            return await promiseFn();
        } finally {
            const duration = performance.now() - start;
            const metrics = ensureMetrics(pluginName);
            metrics.asyncTimeMs += duration;
            notifySubscribers();
        }
    },

    /**
     * Intercept and profile Flux dispatcher calls for specific actions
     */
    profileFluxAction(pluginName: string, actionName: string, durationMs: number) {
        if (!pluginName || !actionName) return;

        const metrics = ensureMetrics(pluginName);
        metrics.totalCpuTimeMs += durationMs;
        metrics.callCount++;
        if (durationMs > metrics.maxCallMs) {
            metrics.maxCallMs = durationMs;
        }

        if (durationMs >= slowCallThresholdMs) {
            metrics.slowSpikes++;
        }

        let actionStat = metrics.fluxActions.get(actionName);
        if (!actionStat) {
            actionStat = { calls: 0, totalTimeMs: 0, maxTimeMs: 0 };
            metrics.fluxActions.set(actionName, actionStat);
        }
        actionStat.calls++;
        actionStat.totalTimeMs += durationMs;
        if (durationMs > actionStat.maxTimeMs) {
            actionStat.maxTimeMs = durationMs;
        }

        notifySubscribers();
    },

    /**
     * Register active setInterval handle for a plugin
     */
    registerInterval(pluginName: string, intervalId: number) {
        if (!pluginName) return;
        const metrics = ensureMetrics(pluginName);
        metrics.activeIntervals.add(intervalId);
        notifySubscribers();
    },

    /**
     * Unregister setInterval handle
     */
    unregisterInterval(pluginName: string, intervalId: number) {
        if (!pluginName) return;
        const metrics = metricsRegistry.get(pluginName);
        if (metrics) {
            metrics.activeIntervals.delete(intervalId);
            notifySubscribers();
        }
    },

    /**
     * Register active DOM/window event listener for a plugin
     */
    registerEventListener(pluginName: string, target: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
        if (!pluginName) return;
        const metrics = ensureMetrics(pluginName);
        metrics.activeListeners.add({ target, type, listener });
        notifySubscribers();
    },

    /**
     * Unregister active DOM/window event listener
     */
    unregisterEventListener(pluginName: string, target: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
        if (!pluginName) return;
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
    getProfile(pluginName: string): PluginProfileData {
        const metrics = metricsRegistry.get(pluginName);
        const allocatedBytes = metrics?.allocatedHeapBytes ?? 0;
        const extraRAMMB = Math.round((allocatedBytes / (1024 * 1024)) * 100) / 100;
        const heapBytes = metrics?.lastHeapBytes ?? 0;
        const heapMB = extraRAMMB;

        const cpuMs = Math.round((metrics?.totalCpuTimeMs ?? 0) * 10) / 10;
        const callCount = metrics?.callCount ?? 0;
        const maxCallMs = Math.round((metrics?.maxCallMs ?? 0) * 10) / 10;
        const slowSpikes = metrics?.slowSpikes ?? 0;
        const asyncTimeMs = Math.round((metrics?.asyncTimeMs ?? 0) * 10) / 10;
        const activeIntervals = metrics?.activeIntervals.size ?? 0;
        const activeListeners = metrics?.activeListeners.size ?? 0;
        const activeResources = activeIntervals + activeListeners;
        const lastHeapDeltaMB = metrics?.lastHeapDeltaMB ?? 0;

        const impactScore = calculateImpactScore(cpuMs, extraRAMMB, slowSpikes, activeResources);
        const { signals, advisory } = computeAdvisoriesAndSignals(
            cpuMs, extraRAMMB, slowSpikes, maxCallMs, callCount, activeResources
        );

        const fluxSurfaces: FluxSurfaceMetric[] = [];
        if (metrics?.fluxActions) {
            for (const [action, stat] of metrics.fluxActions.entries()) {
                fluxSurfaces.push({
                    action,
                    calls: stat.calls,
                    totalTimeMs: Math.round(stat.totalTimeMs * 10) / 10,
                    maxTimeMs: Math.round(stat.maxTimeMs * 10) / 10
                });
            }
            fluxSurfaces.sort((a, b) => b.totalTimeMs - a.totalTimeMs);
        }

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
            heapBytes,
            heapMB,
            lastHeapDeltaMB,
            extraRAMMB,
            impactScore,
            signals,
            advisory,
            fluxSurfaces
        };
    },

    /**
     * Get compiled diagnostic profiles for all monitored plugins
     */
    getAllProfiles(): PluginProfileData[] {
        const profiles: PluginProfileData[] = [];
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
    resetPluginMetrics(pluginName: string) {
        metricsRegistry.delete(pluginName);
        notifySubscribers();
    },

    /**
     * Subscribe to profiler metric updates
     */
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
};

// Global inspection binding
if (typeof globalThis !== "undefined") {
    (globalThis as any).__pluginProfiler = PluginProfiler;
}
