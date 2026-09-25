/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import type { Plugin } from "@utils/types";

import { type RuntimeHookOwnership, RuntimeInterposition, RuntimeInterpositionPriority } from "./RuntimeInterposition";

const logger = new Logger("PluginProfiler", "#3498db");

export const PROFILE_WINDOW_MS = 60_000;

export interface SurfaceStats {
    calls: number;
    totalMs: number;
    maxMs: number;
    slowCalls: number;
    asyncMs: number;
}

export interface SourceSnippet {
    surface: string;
    label: string;
    code: string;
    fn?: (() => string) | undefined;
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
    pendingTimeouts: number;
    animationFrames: number;
    activeListeners: number;
    activeHookLayers: number;
    hookOwnership: RuntimeHookOwnership[];
    heapBytes: number;
    heapMB: number;
    lastHeapDeltaMB: number;
    extraRAMMB: number;
    sampleWindowMs: number;
    impactScore: number;
    signals: SignalFlag[];
    advisory: string | null;
    surfaces: Record<string, SurfaceStats>;
    hotSurface: string;
    snippets: SourceSnippet[];
}

export type SignalFlag = "Noticeable CPU" | "Slow spike" | "Slow calls" | "Active listeners";

interface ActiveContext {
    pluginName: string;
    surface: string;
}

interface RawPluginMetrics {
    windowStartedAt: number;
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
    /** Slow-call log lines already emitted in the current window, so the budget resets with it. */
    warnedSlowCalls: number;
    surfaces: Record<string, SurfaceStats>;
}

const metricsRegistry = new Map<string, RawPluginMetrics>();
const listeners = new Set<() => void>();
const activeStack: ActiveContext[] = [];
const SLOW_CALL_WARN_LIMIT = 5;
let heapTrackingEnabled = false;

let slowCallThresholdMs = 16; // configurable threshold for slow call spikes

// ─── Auto-instrumentation state ─────────────────────────────
let instrumented = false;
let originalSetInterval: typeof window.setInterval | null = null;
let originalClearInterval: typeof window.clearInterval | null = null;
let disposeAddEventListener: (() => void) | null = null;
let disposeRemoveEventListener: (() => void) | null = null;

const intervalOwners = new Map<number, string>();
const listenerOwners = new WeakMap<EventTarget, Map<string, Map<EventListenerOrEventListenerObject, string>>>();
const listenerCountByPlugin = new Map<string, number>();
const sourceSnippets = new Map<string, SourceSnippet[]>();
const measuredFunctions = new WeakSet<object>();

/**
 * Attribution for a timer or listener created outside an active plugin frame.
 *
 * There is deliberately no stack inspection here. The renderer ships as a single
 * script (`//# sourceURL=file:///VencordRenderer`) and every webpack module gets
 * `file:///WebpackModule<id>`, so no frame in a captured stack ever contains a
 * `testcordplugins/<name>/` style segment. The previous implementation built a full
 * `new Error().stack` and ran four regexes over it on *every* `addEventListener` and
 * `setInterval` call in the whole client, and could only ever return null.
 */
function currentContext(): ActiveContext | undefined {
    return activeStack.length > 0 ? activeStack[activeStack.length - 1] : undefined;
}

function ensureMetrics(pluginName: string): RawPluginMetrics {
    let metrics = metricsRegistry.get(pluginName);
    if (!metrics) {
        metrics = {
            windowStartedAt: performance.now(),
            totalCpuTimeMs: 0,
            callCount: 0,
            maxCallMs: 0,
            slowSpikes: 0,
            asyncTimeMs: 0,
            activeIntervals: new Set(),
            activeListeners: new Set(),
            allocatedHeapBytes: 0,
            lastHeapBytes: 0,
            lastHeapDeltaMB: 0,
            warnedSlowCalls: 0,
            surfaces: {}
        };
        metricsRegistry.set(pluginName, metrics);
    }
    return metrics;
}

function resetPerformanceWindow(metrics: RawPluginMetrics, now: number) {
    metrics.windowStartedAt = now;
    metrics.totalCpuTimeMs = 0;
    metrics.callCount = 0;
    metrics.maxCallMs = 0;
    metrics.slowSpikes = 0;
    metrics.asyncTimeMs = 0;
    metrics.allocatedHeapBytes = 0;
    metrics.lastHeapBytes = 0;
    metrics.lastHeapDeltaMB = 0;
    metrics.warnedSlowCalls = 0;
    metrics.surfaces = {};
}

function rollPerformanceWindow(metrics: RawPluginMetrics, now: number) {
    if (now - metrics.windowStartedAt >= PROFILE_WINDOW_MS) {
        resetPerformanceWindow(metrics, now);
    }
}

function ensureSurface(metrics: RawPluginMetrics, surface: string): SurfaceStats {
    return metrics.surfaces[surface] ??= {
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        slowCalls: 0,
        asyncMs: 0
    };
}

let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifySubscribers(immediate = false) {
    if (immediate) {
        if (notifyTimer) {
            clearTimeout(notifyTimer);
            notifyTimer = null;
        }
        for (const listener of listeners) {
            try {
                listener();
            } catch {
                // Ignore subscriber errors
            }
        }
        return;
    }

    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
        notifyTimer = null;
        for (const listener of listeners) {
            try {
                listener();
            } catch {
                // Ignore subscriber errors
            }
        }
    }, 500);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    if (value === null) return false;
    const valueType = typeof value;
    if (valueType !== "object" && valueType !== "function") return false;
    const { then } = (value as { then?: unknown });
    return typeof then === "function";
}

function normalizeCodeSnippet(code: string) {
    return code.trim().replace(/\n{3,}/g, "\n\n").slice(0, 6000);
}

function stringifyCodePart(value: unknown) {
    if (typeof value === "function") return normalizeCodeSnippet(value.toString());
    if (value instanceof RegExp) return value.toString();
    if (typeof value === "string") return value;
    return String(value);
}

export function rememberSourceSnippet(pluginName: string, surface: string, label: string, source: unknown) {
    if (typeof source !== "function") {
        const code = normalizeCodeSnippet(stringifyCodePart(source));
        if (!code) return;
        const snippets = sourceSnippets.get(pluginName) ?? [];
        if (snippets.some(s => s.surface === surface && s.label === label)) return;
        snippets.push({ surface, label, code });
        if (snippets.length > 30) snippets.shift();
        sourceSnippets.set(pluginName, snippets);
        return;
    }

    const snippets = sourceSnippets.get(pluginName) ?? [];
    if (snippets.some(s => s.surface === surface && s.fn === source)) return;

    const snippet: SourceSnippet = { surface, label, code: "", fn: source as () => string };
    snippets.push(snippet);
    if (snippets.length > 30) snippets.shift();
    sourceSnippets.set(pluginName, snippets);
}

function rememberPatchSnippets(plugin: Plugin) {
    if (!plugin?.patches) return;
    for (const [patchIndex, patch] of plugin.patches.entries()) {
        if (!patch?.replacement) continue;
        const replacements = Array.isArray(patch.replacement) ? patch.replacement : [patch.replacement];

        for (const [replacementIndex, replacement] of replacements.entries()) {
            if (!replacement) continue;
            rememberSourceSnippet(
                plugin.name,
                "patch",
                `patch ${patchIndex + 1}.${replacementIndex + 1}`,
                [
                    `find: ${stringifyCodePart(patch.find)}`,
                    `match: ${stringifyCodePart(replacement.match)}`,
                    `replace: ${stringifyCodePart(replacement.replace)}`
                ].join("\n")
            );
        }
    }
}

function asRecord(value: unknown) {
    return value && typeof value === "object" ? value as Record<PropertyKey, unknown> : null;
}

function wrapObjectMethod(owner: Record<PropertyKey, unknown>, key: string, pluginName: string, surface: string) {
    try {
        const original = owner[key];
        if (typeof original !== "function" || measuredFunctions.has(original)) return;

        rememberSourceSnippet(pluginName, surface, `${surface} callback`, original);
        const wrapped = function (this: unknown, ...args: unknown[]) {
            return PluginProfiler.profileExecution(pluginName, surface, () => (original as Function).apply(this, args));
        };
        measuredFunctions.add(wrapped);
        owner[key] = wrapped;
    } catch {
        // Ignore non-configurable or frozen properties
    }
}

function getListenerSource(listener: EventListenerOrEventListenerObject) {
    if (typeof listener === "function") return listener;
    const record = asRecord(listener);
    const handleEvent = record?.handleEvent;
    return typeof handleEvent === "function" ? handleEvent : undefined;
}

function getEventKey(type: string, options?: boolean | AddEventListenerOptions) {
    const capture = typeof options === "boolean" ? options : options?.capture === true;
    return `${type}:${capture}`;
}

function changeListenerCount(pluginName: string, delta: 1 | -1) {
    const count = Math.max(0, (listenerCountByPlugin.get(pluginName) ?? 0) + delta);
    if (count === 0) listenerCountByPlugin.delete(pluginName);
    else listenerCountByPlugin.set(pluginName, count);
}

function rememberListener(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, pluginName: string, options?: boolean | AddEventListenerOptions) {
    const key = getEventKey(type, options);
    let targetListeners = listenerOwners.get(target);

    if (!targetListeners) {
        targetListeners = new Map();
        listenerOwners.set(target, targetListeners);
    }

    let listenersForType = targetListeners.get(key);
    if (!listenersForType) {
        listenersForType = new Map();
        targetListeners.set(key, listenersForType);
    }

    if (listenersForType.has(listener)) return;

    listenersForType.set(listener, pluginName);
    rememberSourceSnippet(pluginName, `event listener ${type}`, `event listener ${type}`, getListenerSource(listener));
    changeListenerCount(pluginName, 1);

    const metrics = ensureMetrics(pluginName);
    metrics.activeListeners.add({ target, type, listener });
    notifySubscribers();
}

function forgetListener(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    const targetListeners = listenerOwners.get(target);
    const key = getEventKey(type, options);
    const listenersForType = targetListeners?.get(key);
    const pluginName = listenersForType?.get(listener);

    if (!pluginName) return;

    listenersForType?.delete(listener);
    if (listenersForType?.size === 0) targetListeners?.delete(key);
    changeListenerCount(pluginName, -1);

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
}

/**
 * Calculates Composite Impact Score from measurable signals.
 *
 * Impact Score = (CPU_ms * 0.5) + (Slow_Spikes * 25) + (Active_Resources * 5)
 */
export function calculateImpactScore(
    cpuMs: number,
    slowSpikes: number,
    activeResources: number
): number {
    const score = (cpuMs * 0.5) + (slowSpikes * 25) + (activeResources * 5);
    return Math.round(score * 10) / 10;
}

/**
 * Calculates signal flags and automated lag advisories
 */
export function computeAdvisoriesAndSignals(
    cpuMs: number,
    slowSpikes: number,
    maxCallMs: number,
    callCount: number,
    activeResources: number
): { signals: SignalFlag[]; advisory: string | null } {
    const signals: SignalFlag[] = [];

    if (cpuMs > 50) signals.push("Noticeable CPU");
    if (slowSpikes > 0) signals.push("Slow spike");
    if (maxCallMs > 30 || callCount > 200) signals.push("Slow calls");
    if (activeResources > 5) signals.push("Active listeners");

    let advisory: string | null = null;
    if (signals.includes("Slow spike") || cpuMs > 100) {
        advisory = "Temporarily disabling this plugin is recommended to compare client smoothness.";
    } else if (signals.length >= 2) {
        advisory = "Moderate overhead detected; monitor performance during intensive UI actions.";
    } else if (signals.length === 1) {
        advisory = "Minor overhead flag logged; plugin is performing within reasonable margins.";
    }

    return { signals, advisory };
}

export const PluginProfiler = {
    /**
     * Patch global timer and event-listener APIs so that intervals, timeouts,
     * animation frames, and event listeners created by plugins are attributed automatically.
     * Uses zero-overhead activeStack context tracking, working in both Dev and Production.
     */
    init() {
        if (instrumented || typeof window === "undefined") return;
        instrumented = true;

        originalSetInterval = window.setInterval;
        originalClearInterval = window.clearInterval;

        const setIntervalOrig = originalSetInterval;
        const clearIntervalOrig = originalClearInterval;

        window.setInterval = ((handler: string | ((...args: unknown[]) => void), timeout?: number, ...args: unknown[]) => {
            const context = currentContext();
            if (!context || typeof handler !== "function") {
                return setIntervalOrig(handler as any, timeout, ...args);
            }

            let id = 0;
            const wrapped = (...callbackArgs: unknown[]) =>
                PluginProfiler.profileExecution(context.pluginName, "interval", () => handler(...callbackArgs));

            rememberSourceSnippet(context.pluginName, "interval", "setInterval callback", handler);
            id = setIntervalOrig(wrapped, timeout, ...args);
            intervalOwners.set(id, context.pluginName);
            const metrics = ensureMetrics(context.pluginName);
            metrics.activeIntervals.add(id);
            notifySubscribers();
            return id;
        }) as typeof window.setInterval;

        window.clearInterval = ((id?: number) => {
            if (id !== undefined) {
                const pluginName = intervalOwners.get(id);
                if (pluginName) {
                    intervalOwners.delete(id);
                    const metrics = metricsRegistry.get(pluginName);
                    if (metrics) {
                        metrics.activeIntervals.delete(id);
                        notifySubscribers();
                    }
                }
            }
            return clearIntervalOrig(id);
        }) as typeof window.clearInterval;

        disposeAddEventListener = RuntimeInterposition.register({
            owner: "PluginProfiler",
            hook: "addEventListener",
            priority: RuntimeInterpositionPriority.DIAGNOSTICS,
            wrap: next => function (
                this: EventTarget,
                type: string,
                listener: EventListenerOrEventListenerObject | null,
                options?: boolean | AddEventListenerOptions
            ) {
                const context = currentContext();
                if (context && listener) {
                    rememberListener(this, type, listener, context.pluginName, options);
                }
                return next.call(this, type, listener, options);
            }
        });

        disposeRemoveEventListener = RuntimeInterposition.register({
            owner: "PluginProfiler",
            hook: "removeEventListener",
            priority: RuntimeInterpositionPriority.DIAGNOSTICS,
            wrap: next => function (
                this: EventTarget,
                type: string,
                listener: EventListenerOrEventListenerObject | null,
                options?: boolean | EventListenerOptions
            ) {
                if (listener) {
                    forgetListener(this, type, listener, options);
                }
                return next.call(this, type, listener, options);
            }
        });
    },

    /**
     * Restore the original global APIs and stop auto-instrumenting.
     */
    teardown() {
        if (!instrumented || typeof window === "undefined") return;
        if (originalSetInterval) window.setInterval = originalSetInterval;
        if (originalClearInterval) window.clearInterval = originalClearInterval;
        disposeAddEventListener?.();
        disposeRemoveEventListener?.();
        disposeAddEventListener = null;
        disposeRemoveEventListener = null;
        instrumented = false;
    },

    setSlowCallThreshold(ms: number) {
        slowCallThresholdMs = ms;
    },

    getSlowCallThreshold(): number {
        return slowCallThresholdMs;
    },

    /**
     * Instruments all surfaces of a plugin (message hooks, renders, commands, menus)
     * so execution times, spikes, and active resources are attributed accurately.
     */
    instrumentPlugin(plugin: Plugin) {
        try {
            if (!plugin || !plugin.name) return;
            const pluginRecord = asRecord(plugin);
            if (!pluginRecord) return;

            rememberPatchSnippets(plugin);

            wrapObjectMethod(pluginRecord, "onBeforeMessageSend", plugin.name, "message send");
            wrapObjectMethod(pluginRecord, "onBeforeMessageEdit", plugin.name, "message edit");
            wrapObjectMethod(pluginRecord, "onMessageClick", plugin.name, "message click");
            wrapObjectMethod(pluginRecord, "renderMessageAccessory", plugin.name, "message accessory");
            wrapObjectMethod(pluginRecord, "renderMessageDecoration", plugin.name, "message decoration");
            wrapObjectMethod(pluginRecord, "renderMemberListDecorator", plugin.name, "member list decorator");
            wrapObjectMethod(pluginRecord, "renderNicknameIcon", plugin.name, "nickname icon");

            for (const command of plugin.commands ?? []) {
                const commandRecord = asRecord(command);
                if (commandRecord) wrapObjectMethod(commandRecord, "execute", plugin.name, "command");
            }

            const contextMenuRecord = asRecord(plugin.contextMenus);
            if (contextMenuRecord) {
                for (const menu of Object.keys(contextMenuRecord)) {
                    wrapObjectMethod(contextMenuRecord, menu, plugin.name, `context menu ${menu}`);
                }
            }

            const renderFields = [
                ["chatBarButton", "render", "chat bar button"],
                ["chatBarButtonWrapper", "wrapper", "chat bar wrapper"],
                ["messagePopoverButton", "render", "message popover"],
                ["headerBarButton", "render", "header bar button"],
                ["userAreaButton", "render", "user area button"],
                ["renderProfileCollection", "render", "profile collection"],
                ["renderProfileSection", "render", "profile section"]
            ] as const;

            for (const [field, key, surface] of renderFields) {
                const owner = asRecord(pluginRecord[field]);
                if (owner) wrapObjectMethod(owner, key, plugin.name, surface);
            }

            wrapObjectMethod(pluginRecord, "audioProcessor", plugin.name, "audio processor");

            if (typeof plugin.toolboxActions === "function") {
                wrapObjectMethod(pluginRecord, "toolboxActions", plugin.name, "toolbox actions");
            } else {
                const toolboxRecord = asRecord(plugin.toolboxActions);
                if (toolboxRecord) {
                    for (const label of Object.keys(toolboxRecord)) {
                        wrapObjectMethod(toolboxRecord, label, plugin.name, `toolbox ${label}`);
                    }
                }
            }
        } catch {
            // Profiler auto-instrumentation must never block plugin execution
        }
    },

    /**
     * Measure synchronous execution time of a plugin callback (lifecycle, listener, command, surface)
     */
    profileExecution<T>(pluginName: string, category: string, fn: () => T): T {
        if (!pluginName) return fn();

        // `performance.memory.usedJSHeapSize` is not a plain field read in Chromium; it
        // materialises heap statistics. This wrapper runs for every flux handler, every
        // message accessory and every lifecycle call, so the two reads per invocation
        // are skipped until something has actually asked to see them. Sticky rather than
        // "currently subscribed", so closing the Health tab does not silently blank the
        // heap columns for the rest of the session.
        const trackHeap = heapTrackingEnabled;
        const beforeHeap = trackHeap ? (performance as any)?.memory?.usedJSHeapSize : undefined;
        const start = performance.now();
        const metrics = ensureMetrics(pluginName);
        rollPerformanceWindow(metrics, start);
        activeStack.push({ pluginName, surface: category });

        try {
            const result = fn();

            if (isPromiseLike(result)) {
                const asyncStart = performance.now();
                void Promise.resolve(result).finally(() => {
                    const duration = performance.now() - asyncStart;
                    rollPerformanceWindow(metrics, asyncStart);
                    metrics.asyncTimeMs += duration;
                    const surf = ensureSurface(metrics, category);
                    surf.asyncMs += duration;
                    notifySubscribers();
                });
            }

            return result;
        } finally {
            activeStack.pop();
            const duration = performance.now() - start;

            metrics.totalCpuTimeMs += duration;
            metrics.callCount++;
            if (duration > metrics.maxCallMs) {
                metrics.maxCallMs = duration;
            }

            const isSlow = duration >= slowCallThresholdMs;
            if (isSlow) {
                metrics.slowSpikes++;
                // The counter stays exact; only the log line is thinned. A surface that is
                // permanently over the threshold used to emit one warn per call, and each
                // of those went back out through the console wrappers. The budget lives on
                // the metrics so it resets with the performance window.
                if (metrics.warnedSlowCalls < SLOW_CALL_WARN_LIMIT) {
                    const last = metrics.warnedSlowCalls === SLOW_CALL_WARN_LIMIT - 1;
                    metrics.warnedSlowCalls++;
                    logger.warn(last
                        ? `[Slow Call Spike] ${pluginName} (${category}): further spikes this window suppressed (still counted).`
                        : `[Slow Call Spike] ${pluginName} (${category}): ${duration.toFixed(2)}ms (threshold: ${slowCallThresholdMs}ms)`);
                }
            }

            const surfaceStat = ensureSurface(metrics, category);
            surfaceStat.calls++;
            surfaceStat.totalMs += duration;
            surfaceStat.maxMs = Math.max(surfaceStat.maxMs, duration);
            if (isSlow) {
                surfaceStat.slowCalls++;
            }

            const afterHeap = trackHeap ? (performance as any)?.memory?.usedJSHeapSize : undefined;
            if (typeof beforeHeap === "number" && typeof afterHeap === "number") {
                const delta = afterHeap - beforeHeap;
                metrics.lastHeapBytes = afterHeap;
                metrics.lastHeapDeltaMB = Math.round((delta / (1024 * 1024)) * 100) / 100;
                if (delta > 0) metrics.allocatedHeapBytes = Math.max(metrics.allocatedHeapBytes, delta);
            }

            notifySubscribers();
        }
    },

    /**
     * Profile asynchronous execution or promise callbacks
     */
    async profileAsyncExecution<T>(pluginName: string, category: string, promiseFn: () => Promise<T>): Promise<T> {
        if (!pluginName) return promiseFn();

        const start = performance.now();
        const metrics = ensureMetrics(pluginName);
        rollPerformanceWindow(metrics, start);
        try {
            return await promiseFn();
        } finally {
            const duration = performance.now() - start;
            metrics.asyncTimeMs += duration;
            const surf = ensureSurface(metrics, category);
            surf.asyncMs += duration;
            notifySubscribers();
        }
    },

    registerInterval(pluginName: string, intervalId: number) {
        if (!pluginName) return;
        intervalOwners.set(intervalId, pluginName);
        const metrics = ensureMetrics(pluginName);
        metrics.activeIntervals.add(intervalId);
        notifySubscribers();
    },

    registerPlugin(pluginName: string) {
        if (!pluginName) return;
        ensureMetrics(pluginName);
        notifySubscribers();
    },

    unregisterInterval(pluginName: string, intervalId: number) {
        if (!pluginName) return;
        intervalOwners.delete(intervalId);
        const metrics = metricsRegistry.get(pluginName);
        if (metrics) {
            metrics.activeIntervals.delete(intervalId);
            notifySubscribers();
        }
    },

    registerEventListener(pluginName: string, target: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
        if (!pluginName) return;
        rememberListener(target, type, listener, pluginName);
    },

    unregisterEventListener(pluginName: string, target: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
        if (!pluginName) return;
        forgetListener(target, type, listener);
    },

    getSourceSnippets(pluginName: string): SourceSnippet[] {
        return sourceSnippets.get(pluginName) ?? [];
    },

    /**
     * Get compiled diagnostic profile for a specific plugin
     */
    getProfile(pluginName: string): PluginProfileData {
        const metrics = metricsRegistry.get(pluginName);
        const now = performance.now();
        if (metrics) rollPerformanceWindow(metrics, now);

        const heapBytes = metrics?.lastHeapBytes ?? 0;
        const heapMB = Math.round((heapBytes / (1024 * 1024)) * 100) / 100;
        const extraRAMMB = Math.round(((metrics?.allocatedHeapBytes ?? 0) / (1024 * 1024)) * 100) / 100;

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
        const { signals, advisory } = computeAdvisoriesAndSignals(
            cpuMs, slowSpikes, maxCallMs, callCount, activeResources
        );

        const surfaces = metrics?.surfaces ?? {};
        const [hotSurface] = Object.entries(surfaces)
            .sort(([, a], [, b]) => b.totalMs - a.totalMs)[0] ?? [];

        return {
            pluginName,
            totalCpuTimeMs: cpuMs,
            callCount,
            maxCallMs,
            slowSpikes,
            asyncTimeMs,
            activeResources,
            activeIntervals,
            pendingTimeouts: 0,
            animationFrames: 0,
            activeListeners,
            activeHookLayers,
            hookOwnership,
            heapBytes,
            heapMB,
            lastHeapDeltaMB,
            extraRAMMB,
            sampleWindowMs: metrics
                ? Math.min(PROFILE_WINDOW_MS, Math.round(now - metrics.windowStartedAt))
                : 0,
            impactScore,
            signals,
            advisory,
            surfaces,
            hotSurface: hotSurface ?? "No samples",
            snippets: sourceSnippets.get(pluginName) ?? []
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
        const now = performance.now();
        for (const metrics of metricsRegistry.values()) {
            resetPerformanceWindow(metrics, now);
        }
        notifySubscribers(true);
    },

    /**
     * Reset metrics for a single plugin
     */
    resetPluginMetrics(pluginName: string) {
        const metrics = metricsRegistry.get(pluginName);
        if (!metrics) return;
        resetPerformanceWindow(metrics, performance.now());
        notifySubscribers(true);
    },

    /**
     * Subscribe to profiler metric updates
     */
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        heapTrackingEnabled = true;
        return () => listeners.delete(listener);
    }
};

// Global inspection binding
if (typeof globalThis !== "undefined") {
    (globalThis as any).__pluginProfiler = PluginProfiler;
}
