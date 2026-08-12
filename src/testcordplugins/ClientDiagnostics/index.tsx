/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { showNotification } from "@api/Notifications";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { CodeBlock } from "@components/CodeBlock";
import ErrorBoundary from "@components/ErrorBoundary";
import { ClockIcon, CopyIcon, MagnifyingGlassIcon, ResetIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { isObject, removeFromArray } from "@utils/misc";
import { useFixedTimer } from "@utils/react";
import definePlugin, { OptionType, type Plugin, StartAt } from "@utils/types";
import { React, SettingsRouter, TabBar, TextInput, useState } from "@webpack/common";

type SortBy = "impact" | "cpu" | "memory" | "calls" | "resources";
type ClientDiagnosticsTab = "diagnostics" | "analysis" | "monitor" | "guide";
type SettingKey = "sortBy" | "showDisabled" | "showApiPlugins" | "refreshMs";
type ResourceKey = "intervals" | "pendingTimeouts" | "animationFrames" | "listeners";
type AnyCallback = (this: unknown, ...args: never[]) => unknown;

interface PerformanceMemory {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
    memory?: PerformanceMemory;
}

interface ActiveContext {
    pluginName: string;
    surface: string;
}

interface SurfaceStats {
    calls: number;
    totalMs: number;
    maxMs: number;
    slowCalls: number;
    asyncMs: number;
}

interface PluginStats {
    name: string;
    calls: number;
    totalMs: number;
    maxMs: number;
    slowCalls: number;
    asyncCalls: number;
    asyncMs: number;
    errors: number;
    heapIncrease: number;
    heapDecrease: number;
    lastHeapDelta: number;
    intervals: number;
    pendingTimeouts: number;
    animationFrames: number;
    listeners: number;
    firstSeen: number;
    lastSeen: number;
    surfaces: Record<string, SurfaceStats>;
}

interface DiagnosticsRow extends PluginStats {
    enabled: boolean;
    api: boolean;
    impact: number;
    hotSurface: string;
    resources: number;
}

interface SourceSnippet {
    surface: string;
    label: string;
    code: string;
    fn?: (() => string) | undefined;
}

interface ImpactReason {
    label: string;
    value: string;
    description: string;
    level: "high" | "medium" | "low";
}

interface ImpactAnalysisItem {
    row: DiagnosticsRow;
    reasons: ImpactReason[];
    recommendation: string;
    shouldDisable: boolean;
    summary: string;
    snippets: SourceSnippet[];
}

const PLUGIN_NAME = "Client diagnostics";
const ENTRY_KEY = "illegalcord_client_diagnostics";
const SETTINGS_KEYS: SettingKey[] = ["sortBy", "showDisabled", "showApiPlugins", "refreshMs"];
const REFRESH_SETTING_KEYS: SettingKey[] = ["refreshMs"];
const LAG_NOTIFICATION_CHECK_MS = 30_000;
const LAG_NOTIFICATION_COOLDOWN_MS = 10 * 60_000;
const LAG_NOTIFICATION_MIN_COLLECTION_MS = 30_000;
const cl = classNameFactory("vc-client-diagnostics-");
const logger = new Logger("ClientDiagnostics");
const GUIDE_ITEMS = [
    {
        label: "Impact",
        description: "An internal score that combines CPU time, slow spikes, slow calls, async time, heap growth, and active resources. The higher it is, the more the plugin deserves attention."
    },
    {
        label: "CPU",
        description: "The total time measured plugin functions spent on the JavaScript thread since collection started or was reset."
    },
    {
        label: "Calls",
        description: "The number of times a measured plugin function was called."
    },
    {
        label: "Slow",
        description: "Counts how many calls passed the slow call threshold configured in the plugin settings."
    },
    {
        label: "Heap +",
        description: "Shows how much extra JavaScript memory was observed during plugin calls. It uses Chromium heap data, so it does not represent the full process RAM."
    },
    {
        label: "Resources",
        description: "Adds up still-active resources created by the plugin, such as intervals, pending timeouts, animation frames, and listeners."
    },
    {
        label: "Listeners",
        description: "Counts event listeners registered while the plugin was running measured code."
    },
    {
        label: "Hot surface",
        description: "Shows the plugin surface that consumed the most total time, such as start, flux, interval, command, or context menu."
    },
    {
        label: "Max",
        description: "The slowest single call observed for that plugin."
    }
] satisfies Array<{ label: string; description: string; }>;

const MONITOR_GUIDE_ITEMS = [
    {
        label: "Extra CPU",
        description: "In the monitor, this compares the plugin CPU time with the time elapsed since reset. It estimates the extra observed work."
    },
    {
        label: "CPU share",
        description: "Shows how much of the measured plugin CPU time belongs to the selected plugin."
    },
    {
        label: "Extra RAM",
        description: "Compares the plugin's observed heap growth with the JavaScript heap currently in use."
    },
    {
        label: "RAM share",
        description: "Shows how much of the measured heap growth belongs to the selected plugin."
    }
] satisfies Array<{ label: string; description: string; }>;

const settings = definePluginSettings({
    sortBy: {
        type: OptionType.SELECT,
        description: "Controls the default sorting in the diagnostics table.",
        options: [
            { label: "Impact", value: "impact", default: true },
            { label: "CPU time", value: "cpu" },
            { label: "Memory delta", value: "memory" },
            { label: "Calls", value: "calls" },
            { label: "Resources", value: "resources" }
        ]
    },
    showDisabled: {
        type: OptionType.BOOLEAN,
        description: "Include disabled plugins in the table.",
        default: false
    },
    showApiPlugins: {
        type: OptionType.BOOLEAN,
        description: "Include internal API plugins in the table.",
        default: false
    },
    refreshMs: {
        type: OptionType.SLIDER,
        description: "How often the diagnostics page refreshes.",
        markers: [500, 1000, 2000, 5000],
        default: 1000
    },
    slowCallThresholdMs: {
        type: OptionType.SLIDER,
        description: "Callback time that counts as a slow call.",
        markers: [8, 16, 33, 50, 100],
        default: 16
    },
    trackMemory: {
        type: OptionType.BOOLEAN,
        description: "Measure Chromium JS heap deltas when available.",
        default: true
    },
    lagNotifications: {
        type: OptionType.BOOLEAN,
        description: "Send a notification when a plugin may make Discord lag.",
        default: true
    }
});

const activeStack: ActiveContext[] = [];
const stats = new Map<string, PluginStats>();
const measuredFunctions = new WeakSet<object>();
const intervalOwners = new Map<number, string>();
const timeoutOwners = new Map<number, string>();
const frameOwners = new Map<number, string>();
const listenerOwners = new WeakMap<EventTarget, Map<string, Map<EventListenerOrEventListenerObject, string>>>();
const listenerCountByPlugin = new Map<string, number>();
const sourceSnippets = new Map<string, SourceSnippet[]>();

let startedAt = Date.now();
let originalSetTimeout: typeof window.setTimeout | undefined;
let originalClearTimeout: typeof window.clearTimeout | undefined;
let originalSetInterval: typeof window.setInterval | undefined;
let originalClearInterval: typeof window.clearInterval | undefined;
let originalRequestAnimationFrame: typeof window.requestAnimationFrame | undefined;
let originalCancelAnimationFrame: typeof window.cancelAnimationFrame | undefined;
let originalAddEventListener: typeof EventTarget.prototype.addEventListener | undefined;
let originalRemoveEventListener: typeof EventTarget.prototype.removeEventListener | undefined;
let lagNotificationInterval: number | undefined;
const lagNotificationTimes = new Map<string, number>();

function getPluginStats(pluginName: string) {
    let stat = stats.get(pluginName);

    if (!stat) {
        const now = Date.now();
        stat = {
            name: pluginName,
            calls: 0,
            totalMs: 0,
            maxMs: 0,
            slowCalls: 0,
            asyncCalls: 0,
            asyncMs: 0,
            errors: 0,
            heapIncrease: 0,
            heapDecrease: 0,
            lastHeapDelta: 0,
            intervals: 0,
            pendingTimeouts: 0,
            animationFrames: 0,
            listeners: 0,
            firstSeen: now,
            lastSeen: now,
            surfaces: {}
        };
        stats.set(pluginName, stat);
    }

    return stat;
}

function getSurfaceStats(stat: PluginStats, surface: string) {
    return stat.surfaces[surface] ??= {
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        slowCalls: 0,
        asyncMs: 0
    };
}

function getHeapUsed() {
    if (!settings.store.trackMemory) return undefined;

    const { memory } = (performance as PerformanceWithMemory);
    return typeof memory?.usedJSHeapSize === "number"
        ? memory.usedJSHeapSize
        : undefined;
}

function recordCall(pluginName: string, surface: string, duration: number, failed: boolean, beforeHeap?: number, afterHeap?: number) {
    const stat = getPluginStats(pluginName);
    const surfaceStat = getSurfaceStats(stat, surface);
    const isSlow = duration >= settings.store.slowCallThresholdMs;

    stat.calls++;
    stat.totalMs += duration;
    stat.maxMs = Math.max(stat.maxMs, duration);
    stat.lastSeen = Date.now();

    surfaceStat.calls++;
    surfaceStat.totalMs += duration;
    surfaceStat.maxMs = Math.max(surfaceStat.maxMs, duration);

    if (isSlow) {
        stat.slowCalls++;
        surfaceStat.slowCalls++;
    }

    if (failed) stat.errors++;

    if (beforeHeap !== undefined && afterHeap !== undefined) {
        const delta = afterHeap - beforeHeap;
        stat.lastHeapDelta = delta;

        if (delta > 0) stat.heapIncrease += delta;
        else stat.heapDecrease -= delta;
    }
}

function recordAsync(pluginName: string, surface: string, duration: number) {
    const stat = getPluginStats(pluginName);
    const surfaceStat = getSurfaceStats(stat, surface);

    stat.asyncCalls++;
    stat.asyncMs += duration;
    stat.lastSeen = Date.now();
    surfaceStat.asyncMs += duration;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    if (value === null) return false;

    const valueType = typeof value;
    if (valueType !== "object" && valueType !== "function") return false;

    const { then } = (value as { then?: unknown; });
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

function rememberSourceSnippet(pluginName: string, surface: string, label: string, source: unknown) {
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

function runMeasured<T>(pluginName: string, surface: string, callback: () => T): T {
    const beforeHeap = getHeapUsed();
    const start = performance.now();
    let failed = true;

    activeStack.push({ pluginName, surface });

    try {
        const result = callback();
        failed = false;

        if (isPromiseLike(result)) {
            const asyncStart = performance.now();
            void Promise.resolve(result).finally(() => recordAsync(pluginName, surface, performance.now() - asyncStart));
        }

        return result;
    } finally {
        activeStack.pop();
        recordCall(pluginName, surface, performance.now() - start, failed, beforeHeap, getHeapUsed());
    }
}

function wrapMeasured<T extends AnyCallback>(pluginName: string, surface: string, original: T): T {
    const wrapped = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
        return runMeasured(pluginName, surface, () => original.apply(this, args)) as ReturnType<T>;
    } as T;

    measuredFunctions.add(wrapped);
    return wrapped;
}

function wrapObjectMethod(owner: Record<PropertyKey, unknown>, key: string, pluginName: string, surface: string) {
    const original = owner[key];

    if (typeof original !== "function" || measuredFunctions.has(original)) return;

    rememberSourceSnippet(pluginName, surface, `${surface} callback`, original);
    owner[key] = wrapMeasured(pluginName, surface, original as AnyCallback);
}

function asRecord(value: unknown) {
    return isObject(value) ? value as Record<PropertyKey, unknown> : null;
}

function rememberPatchSnippets(plugin: Plugin) {
    for (const [patchIndex, patch] of (plugin.patches ?? []).entries()) {
        const replacements = Array.isArray(patch.replacement) ? patch.replacement : [patch.replacement];

        for (const [replacementIndex, replacement] of replacements.entries()) {
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

function instrumentPlugin(plugin: Plugin) {
    if (plugin.name === PLUGIN_NAME) return;

    const pluginRecord = asRecord(plugin);
    if (!pluginRecord) return;

    rememberPatchSnippets(plugin);

    wrapObjectMethod(pluginRecord, "start", plugin.name, "start");
    wrapObjectMethod(pluginRecord, "stop", plugin.name, "stop");
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

    const fluxRecord = asRecord(plugin.flux);
    if (fluxRecord) {
        for (const event of Object.keys(fluxRecord)) {
            wrapObjectMethod(fluxRecord, event, plugin.name, `flux ${event}`);
        }
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
        if (toolboxRecord) for (const label of Object.keys(toolboxRecord)) {
            wrapObjectMethod(toolboxRecord, label, plugin.name, `toolbox ${label}`);
        }
    }
}

function currentContext() {
    const context = activeStack[activeStack.length - 1];
    return context?.pluginName === PLUGIN_NAME ? undefined : context;
}

function changeResource(pluginName: string, key: ResourceKey, delta: 1 | -1) {
    const stat = getPluginStats(pluginName);
    stat[key] = Math.max(0, stat[key] + delta);
    stat.lastSeen = Date.now();
}

function rememberResource(map: Map<number, string>, id: number, pluginName: string, key: ResourceKey) {
    map.set(id, pluginName);
    changeResource(pluginName, key, 1);
}

function forgetResource(map: Map<number, string>, id: number, key: ResourceKey) {
    const pluginName = map.get(id);
    if (!pluginName) return;

    map.delete(id);
    changeResource(pluginName, key, -1);
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

    changeResource(pluginName, "listeners", delta);
}

function rememberListener(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, pluginName: string, options?: boolean | AddEventListenerOptions) {
    const key = getEventKey(type, options);
    let targetListeners = listenerOwners.get(target);

    if (!targetListeners) {
        targetListeners = new Map();
        listenerOwners.set(target, targetListeners);
    }

    let listeners = targetListeners.get(key);
    if (!listeners) {
        listeners = new Map();
        targetListeners.set(key, listeners);
    }

    if (listeners.has(listener)) return;

    listeners.set(listener, pluginName);
    rememberSourceSnippet(pluginName, `event listener ${type}`, `event listener ${type}`, getListenerSource(listener));
    changeListenerCount(pluginName, 1);
}

function forgetListener(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    const targetListeners = listenerOwners.get(target);
    const key = getEventKey(type, options);
    const listeners = targetListeners?.get(key);
    const pluginName = listeners?.get(listener);

    if (!pluginName) return;

    listeners?.delete(listener);
    if (listeners?.size === 0) targetListeners?.delete(key);
    changeListenerCount(pluginName, -1);
}

function installGlobalProbes() {
    if (originalSetTimeout) return;

    originalSetTimeout = window.setTimeout;
    originalClearTimeout = window.clearTimeout;
    originalSetInterval = window.setInterval;
    originalClearInterval = window.clearInterval;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    originalAddEventListener = EventTarget.prototype.addEventListener;
    originalRemoveEventListener = EventTarget.prototype.removeEventListener;

    window.setTimeout = ((handler: string | ((...args: unknown[]) => void), timeout?: number, ...args: unknown[]) => {
        const context = currentContext();

        if (!context || typeof handler !== "function") {
            return originalSetTimeout!(handler, timeout, ...args);
        }

        let id = 0;
        const wrapped = (...callbackArgs: unknown[]) => {
            forgetResource(timeoutOwners, id, "pendingTimeouts");
            return runMeasured(context.pluginName, "timeout", () => handler(...callbackArgs));
        };

        rememberSourceSnippet(context.pluginName, "timeout", "setTimeout callback", handler);
        id = originalSetTimeout!(wrapped, timeout, ...args);
        rememberResource(timeoutOwners, id, context.pluginName, "pendingTimeouts");
        return id;
    }) as typeof window.setTimeout;

    window.clearTimeout = ((id?: number) => {
        if (id !== undefined) forgetResource(timeoutOwners, id, "pendingTimeouts");
        return originalClearTimeout!(id);
    }) as typeof window.clearTimeout;

    window.setInterval = ((handler: string | ((...args: unknown[]) => void), timeout?: number, ...args: unknown[]) => {
        const context = currentContext();

        if (!context || typeof handler !== "function") {
            return originalSetInterval!(handler, timeout, ...args);
        }

        const wrapped = (...callbackArgs: unknown[]) =>
            runMeasured(context.pluginName, "interval", () => handler(...callbackArgs));
        const id = originalSetInterval!(wrapped, timeout, ...args);

        rememberSourceSnippet(context.pluginName, "interval", "setInterval callback", handler);
        rememberResource(intervalOwners, id, context.pluginName, "intervals");
        return id;
    }) as typeof window.setInterval;

    window.clearInterval = ((id?: number) => {
        if (id !== undefined) forgetResource(intervalOwners, id, "intervals");
        return originalClearInterval!(id);
    }) as typeof window.clearInterval;

    window.requestAnimationFrame = callback => {
        const context = currentContext();

        if (!context) return originalRequestAnimationFrame!(callback);

        let id = 0;
        const wrapped = (timestamp: DOMHighResTimeStamp) => {
            forgetResource(frameOwners, id, "animationFrames");
            return runMeasured(context.pluginName, "animation frame", () => callback(timestamp));
        };

        rememberSourceSnippet(context.pluginName, "animation frame", "requestAnimationFrame callback", callback);
        id = originalRequestAnimationFrame!(wrapped);
        rememberResource(frameOwners, id, context.pluginName, "animationFrames");
        return id;
    };

    window.cancelAnimationFrame = id => {
        forgetResource(frameOwners, id, "animationFrames");
        return originalCancelAnimationFrame!(id);
    };

    EventTarget.prototype.addEventListener = function (type, listener, options) {
        const context = currentContext();
        if (context && listener) rememberListener(this, type, listener, context.pluginName, options);
        return originalAddEventListener!.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (listener) forgetListener(this, type, listener, options);
        return originalRemoveEventListener!.call(this, type, listener, options);
    };
}

function restoreGlobalProbes() {
    if (!originalSetTimeout) return;

    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout!;
    window.setInterval = originalSetInterval!;
    window.clearInterval = originalClearInterval!;
    window.requestAnimationFrame = originalRequestAnimationFrame!;
    window.cancelAnimationFrame = originalCancelAnimationFrame!;
    EventTarget.prototype.addEventListener = originalAddEventListener!;
    EventTarget.prototype.removeEventListener = originalRemoveEventListener!;

    originalSetTimeout = undefined;
    originalClearTimeout = undefined;
    originalSetInterval = undefined;
    originalClearInterval = undefined;
    originalRequestAnimationFrame = undefined;
    originalCancelAnimationFrame = undefined;
    originalAddEventListener = undefined;
    originalRemoveEventListener = undefined;
}

function rebuildResourceCounters() {
    for (const stat of stats.values()) {
        stat.intervals = 0;
        stat.pendingTimeouts = 0;
        stat.animationFrames = 0;
        stat.listeners = 0;
    }

    for (const pluginName of intervalOwners.values()) changeResource(pluginName, "intervals", 1);
    for (const pluginName of timeoutOwners.values()) changeResource(pluginName, "pendingTimeouts", 1);
    for (const pluginName of frameOwners.values()) changeResource(pluginName, "animationFrames", 1);
    for (const [pluginName, count] of listenerCountByPlugin) {
        getPluginStats(pluginName).listeners = count;
    }
}

function resetStats() {
    stats.clear();
    lagNotificationTimes.clear();
    startedAt = Date.now();
    rebuildResourceCounters();
}

function getHotSurface(stat: PluginStats) {
    const [surface] = Object.entries(stat.surfaces)
        .sort(([, a], [, b]) => b.totalMs - a.totalMs)[0] ?? [];

    return surface ?? "No samples";
}

function getImpact(row: PluginStats) {
    const resources = row.intervals + row.pendingTimeouts + row.animationFrames + row.listeners;

    return row.totalMs +
        row.maxMs * 2 +
        row.slowCalls * settings.store.slowCallThresholdMs +
        row.asyncMs * 0.05 +
        row.heapIncrease / 65536 +
        row.intervals * 120 +
        row.pendingTimeouts * 2 +
        row.animationFrames * 4 +
        row.listeners * 5 +
        resources;
}

function buildRows(showDisabled: boolean, showApiPlugins: boolean, sortBy: SortBy) {
    const rows = new Map<string, DiagnosticsRow>();

    for (const [name, stat] of stats) {
        const plugin = plugins[name];
        const api = name.endsWith("API");

        if (!showApiPlugins && api) continue;

        rows.set(name, {
            ...stat,
            enabled: plugin ? isPluginEnabled(name) : false,
            api,
            impact: getImpact(stat),
            hotSurface: getHotSurface(stat),
            resources: stat.intervals + stat.pendingTimeouts + stat.animationFrames + stat.listeners
        });
    }

    for (const plugin of Object.values(plugins)) {
        const enabled = isPluginEnabled(plugin.name);
        const api = plugin.name.endsWith("API");

        if (!showDisabled && !enabled) continue;
        if (!showApiPlugins && api) continue;
        if (rows.has(plugin.name)) continue;

        const stat = getPluginStats(plugin.name);
        rows.set(plugin.name, {
            ...stat,
            enabled,
            api,
            impact: 0,
            hotSurface: "No samples",
            resources: 0
        });
    }

    const sorted = Array.from(rows.values());

    sorted.sort((a, b) => {
        switch (sortBy) {
            case "cpu":
                return b.totalMs - a.totalMs;
            case "memory":
                return b.heapIncrease - a.heapIncrease;
            case "calls":
                return b.calls - a.calls;
            case "resources":
                return b.resources - a.resources;
            default:
                return b.impact - a.impact;
        }
    });

    return sorted;
}

function getMemory() {
    return (performance as PerformanceWithMemory).memory;
}

function formatMs(value: number) {
    if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
    return `${value.toFixed(value >= 10 ? 0 : 1)}ms`;
}

function formatBytes(value?: number) {
    if (value === undefined) return "Unavailable";

    const sign = value < 0 ? "-" : "";
    const absValue = Math.abs(value);

    if (absValue >= 1024 * 1024 * 1024) return `${sign}${(absValue / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (absValue >= 1024 * 1024) return `${sign}${(absValue / 1024 / 1024).toFixed(1)} MB`;
    if (absValue >= 1024) return `${sign}${(absValue / 1024).toFixed(1)} KB`;
    return `${sign}${absValue} B`;
}

function formatNumber(value: number) {
    return value.toLocaleString();
}

function getPercent(part: number, total: number) {
    if (part === 0) return 0;
    return total > 0 ? part / total * 100 : undefined;
}

function formatPercent(value?: number) {
    if (value === undefined || !Number.isFinite(value)) return "Unavailable";
    if (value <= 0) return "0%";
    if (value < 0.1) return "<0.1%";
    if (value >= 100) return `${value.toFixed(0)}%`;
    return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function normalizeSearch(value: string) {
    return value.trim().toLowerCase();
}

function matchesPluginSearch(pluginName: string, query: string) {
    return !query || pluginName.toLowerCase().includes(query);
}

function getImpactClass(impact: number) {
    if (impact >= 2000) return "high";
    if (impact >= 500) return "medium";
    if (impact > 0) return "low";
    return "idle";
}

function getImpactReasons(row: DiagnosticsRow): ImpactReason[] {
    const reasons: ImpactReason[] = [];

    if (row.totalMs >= 1000) {
        reasons.push({
            label: "High CPU",
            value: formatMs(row.totalMs),
            description: "Measured callbacks spent a lot of time on the JavaScript thread.",
            level: "high"
        });
    } else if (row.totalMs >= 200) {
        reasons.push({
            label: "Noticeable CPU",
            value: formatMs(row.totalMs),
            description: "This plugin consumed enough callback time to be worth checking.",
            level: "medium"
        });
    }

    if (row.maxMs >= 50) {
        reasons.push({
            label: "Slow spike",
            value: formatMs(row.maxMs),
            description: "A single call was long enough to cause a visible stutter.",
            level: "high"
        });
    } else if (row.maxMs >= settings.store.slowCallThresholdMs) {
        reasons.push({
            label: "Spike over threshold",
            value: formatMs(row.maxMs),
            description: "At least one call exceeded the configured slow call threshold.",
            level: "medium"
        });
    }

    if (row.slowCalls >= 10) {
        reasons.push({
            label: "Many slow calls",
            value: formatNumber(row.slowCalls),
            description: "The issue appears repeatedly, so it can matter during normal use.",
            level: "high"
        });
    } else if (row.slowCalls > 0) {
        reasons.push({
            label: "Slow calls",
            value: formatNumber(row.slowCalls),
            description: "Some calls were slower than the configured threshold.",
            level: "medium"
        });
    }

    if (row.heapIncrease >= 50 * 1024 * 1024) {
        reasons.push({
            label: "Growing heap",
            value: formatBytes(row.heapIncrease),
            description: "This plugin is associated with many observed JavaScript allocations.",
            level: "high"
        });
    } else if (row.heapIncrease >= 10 * 1024 * 1024) {
        reasons.push({
            label: "Noticeable memory",
            value: formatBytes(row.heapIncrease),
            description: "The heap delta is large enough to contribute to memory pressure.",
            level: "medium"
        });
    }

    if (row.intervals > 0) {
        reasons.push({
            label: "Active intervals",
            value: formatNumber(row.intervals),
            description: "Intervals keep running code while the plugin remains active.",
            level: row.intervals >= 3 ? "high" : "medium"
        });
    }

    if (row.listeners >= 20) {
        reasons.push({
            label: "Many listeners",
            value: formatNumber(row.listeners),
            description: "Many listeners can increase work on frequent events.",
            level: "high"
        });
    } else if (row.listeners > 0) {
        reasons.push({
            label: "Active listeners",
            value: formatNumber(row.listeners),
            description: "This plugin still has runtime listeners registered.",
            level: "low"
        });
    }

    if (row.animationFrames > 0) {
        reasons.push({
            label: "Frame callbacks",
            value: formatNumber(row.animationFrames),
            description: "Frame-bound callbacks can directly affect client smoothness.",
            level: "medium"
        });
    }

    if (row.pendingTimeouts >= 10) {
        reasons.push({
            label: "Pending timeouts",
            value: formatNumber(row.pendingTimeouts),
            description: "Many scheduled timeouts can create bursts of work later.",
            level: "medium"
        });
    }

    if (reasons.length === 0 && row.impact > 0) {
        reasons.push({
            label: "Low impact",
            value: row.impact.toFixed(0),
            description: "This plugin has measured samples, but no single signal is very high.",
            level: "low"
        });
    }

    return reasons;
}

function getRecommendation(row: DiagnosticsRow, reasons: ImpactReason[]) {
    const highReasons = reasons.filter(reason => reason.level === "high").length;

    if (row.impact >= 2000 || highReasons >= 2) {
        return {
            shouldDisable: true,
            text: "Temporarily disabling this plugin is recommended so you can compare client smoothness."
        };
    }

    if (row.impact >= 500 || highReasons === 1) {
        return {
            shouldDisable: false,
            text: "Worth watching. Disable it only if you notice lag during related actions."
        };
    }

    return {
        shouldDisable: false,
        text: "Disabling it does not seem necessary right now."
    };
}

function getRelevantSnippets(row: DiagnosticsRow) {
    const snippets = sourceSnippets.get(row.name) ?? [];

    return [...snippets]
        .sort((a, b) => {
            if (a.surface === row.hotSurface) return -1;
            if (b.surface === row.hotSurface) return 1;
            if (a.surface === "patch") return -1;
            if (b.surface === "patch") return 1;
            return a.surface.localeCompare(b.surface);
        })
        .slice(0, 6);
}

function buildImpactAnalysis(rows: DiagnosticsRow[]) {
    return rows
        .filter(row => row.enabled && !row.api && row.impact > 0)
        .map(row => {
            const reasons = getImpactReasons(row);
            const recommendation = getRecommendation(row, reasons);
            const strongestReason = reasons[0]?.description ?? "Runtime samples have been collected for this plugin.";

            return {
                row,
                reasons,
                recommendation: recommendation.text,
                shouldDisable: recommendation.shouldDisable,
                summary: strongestReason,
                snippets: getRelevantSnippets(row)
            };
        })
        .sort((a, b) => b.row.impact - a.row.impact)
        .slice(0, 20);
}

function openClientDiagnosticsSettings() {
    SettingsRouter.openUserSettings(`${ENTRY_KEY}_panel`);
}

function getLagNotificationCandidates() {
    return buildImpactAnalysis(buildRows(false, false, "impact"))
        .filter(item => item.shouldDisable);
}

function maybeSendLagNotification() {
    if (!settings.store.lagNotifications) return;
    if (Date.now() - startedAt < LAG_NOTIFICATION_MIN_COLLECTION_MS) return;

    const now = Date.now();
    const candidate = getLagNotificationCandidates()
        .find(item => now - (lagNotificationTimes.get(item.row.name) ?? 0) >= LAG_NOTIFICATION_COOLDOWN_MS);

    if (!candidate) return;

    const signal = candidate.reasons.find(reason => reason.level === "high") ?? candidate.reasons[0];
    const signalText = signal ? `${signal.label}: ${signal.value}.` : `Impact: ${candidate.row.impact.toFixed(0)}.`;

    lagNotificationTimes.set(candidate.row.name, now);
    void showNotification({
        title: "Client Diagnostics",
        body: `${candidate.row.name} may be making Discord lag. ${signalText} Open Client Diagnostics to review it.`,
        permanent: true,
        onClick: openClientDiagnosticsSettings
    });
}

function startLagNotifications() {
    if (lagNotificationInterval !== undefined) return;

    lagNotificationInterval = window.setInterval(maybeSendLagNotification, LAG_NOTIFICATION_CHECK_MS);
}

function stopLagNotifications() {
    if (lagNotificationInterval === undefined) return;

    window.clearInterval(lagNotificationInterval);
    lagNotificationInterval = undefined;
    lagNotificationTimes.clear();
}

function getReportRows() {
    return buildRows(false, false, "impact").slice(0, 25);
}

function copyReport() {
    const memory = getMemory();
    const lines = [
        "Client diagnostics",
        `Collected for ${formatMs(Date.now() - startedAt)}`,
        `Heap used: ${formatBytes(memory?.usedJSHeapSize)}`,
        "",
        "Plugin | Impact | CPU | Calls | Slow | Heap + | Resources | Hot surface",
        ...getReportRows().map(row => [
            row.name,
            row.impact.toFixed(0),
            formatMs(row.totalMs),
            formatNumber(row.calls),
            formatNumber(row.slowCalls),
            formatBytes(row.heapIncrease),
            formatNumber(row.resources),
            row.hotSurface
        ].join(" | "))
    ];

    copyWithToast(lines.join("\n"));
}

function copyImpactAnalysisReport() {
    const items = buildImpactAnalysis(buildRows(false, false, "impact"));
    const lines = [
        "Impact analysis",
        `Collected for ${formatMs(Date.now() - startedAt)}`,
        "",
        "Plugin | Impact | Recommendation | Signals | Hot surface",
        ...items.map(item => [
            item.row.name,
            item.row.impact.toFixed(0),
            item.recommendation,
            item.reasons.map(reason => `${reason.label}: ${reason.value}`).join(", ") || "No signals",
            item.row.hotSurface
        ].join(" | "))
    ];

    copyWithToast(lines.join("\n"));
}

function copyPluginMonitorReport(selectedRow: DiagnosticsRow, rows: DiagnosticsRow[]) {
    const memory = getMemory();
    const measuredRows = rows.filter(row => row.calls > 0);
    const totalCpu = measuredRows.reduce((sum, row) => sum + row.totalMs, 0);
    const totalHeapIncrease = measuredRows.reduce((sum, row) => sum + row.heapIncrease, 0);
    const elapsedMs = Math.max(1, Date.now() - startedAt);
    const reasons = getImpactReasons(selectedRow);
    const surfaces = Object.entries(selectedRow.surfaces)
        .sort(([, a], [, b]) => b.totalMs - a.totalMs)
        .slice(0, 6);
    const lines = [
        "Plugin monitor",
        `Collected for ${formatMs(Date.now() - startedAt)}`,
        `Plugin: ${selectedRow.name}`,
        `Status: ${selectedRow.enabled ? "Enabled" : "Disabled"}${selectedRow.api ? " API" : ""}`,
        "",
        "Metric | Value",
        `Impact | ${selectedRow.impact.toFixed(0)}`,
        `Extra CPU | ${formatPercent(getPercent(selectedRow.totalMs, elapsedMs))}`,
        `CPU share | ${formatPercent(getPercent(selectedRow.totalMs, totalCpu))}`,
        `Extra RAM | ${formatPercent(memory ? getPercent(selectedRow.heapIncrease, memory.usedJSHeapSize) : undefined)}`,
        `RAM share | ${formatPercent(getPercent(selectedRow.heapIncrease, totalHeapIncrease))}`,
        `Observed heap + | ${formatBytes(selectedRow.heapIncrease)}`,
        `Max call | ${formatMs(selectedRow.maxMs)}`,
        `Slow calls | ${formatNumber(selectedRow.slowCalls)}`,
        `Resources | ${formatNumber(selectedRow.resources)}`,
        "",
        "Signals",
        ...(reasons.length > 0
            ? reasons.map(reason => `${reason.label}: ${reason.value}. ${reason.description}`)
            : ["No risk signal for this plugin yet."]),
        "",
        "Most expensive surfaces",
        ...(surfaces.length > 0
            ? surfaces.map(([surface, stat]) => `${surface} | ${formatMs(stat.totalMs)} | ${formatNumber(stat.calls)} calls | ${formatMs(stat.maxMs)} max`)
            : ["No measured surface yet."]),
        "",
        "Top measured plugins",
        "Plugin | Impact | CPU share",
        ...measuredRows
            .slice(0, 16)
            .map(row => `${row.name} | ${row.impact.toFixed(0)} | ${formatPercent(getPercent(row.totalMs, totalCpu))}`)
    ];

    copyWithToast(lines.join("\n"));
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string; }) {
    return (
        <div className={cl("metric")}>
            <BaseText size="xs" color="text-muted" weight="medium">{label}</BaseText>
            <BaseText size="lg" weight="semibold" tabularNumbers>{value}</BaseText>
            {detail && <BaseText size="xs" color="text-muted" lineClamp={1}>{detail}</BaseText>}
        </div>
    );
}

function SearchControls({ query, onChange, onSearch, disabled }: { query: string; onChange(value: string): void; onSearch(): void; disabled?: boolean; }) {
    return (
        <div className={cl("search-controls")}>
            <div className={cl("search-input")}>
                <TextInput
                    placeholder="Search for a plugin..."
                    value={query}
                    onChange={onChange}
                />
            </div>
            <Button variant="secondary" onClick={onSearch} disabled={disabled}>
                <MagnifyingGlassIcon height={16} width={16} />
                Search
            </Button>
        </div>
    );
}

function PluginRow({ row }: { row: DiagnosticsRow; }) {
    const impactClass = getImpactClass(row.impact);
    const status = row.enabled ? row.calls > 0 ? "Measured" : "Idle" : "Disabled";

    return (
        <div className={cl("row", "body")}>
            <div className={cl("plugin-cell")}>
                <BaseText size="sm" weight="semibold" lineClamp={1}>{row.name}</BaseText>
                <BaseText size="xs" color="text-muted" lineClamp={1}>{status}{row.api ? " API" : ""}</BaseText>
            </div>
            <BaseText className={cl("impact", impactClass)} size="sm" weight="semibold" tabularNumbers>{row.impact.toFixed(0)}</BaseText>
            <BaseText size="sm" tabularNumbers>{formatMs(row.totalMs)}</BaseText>
            <BaseText size="sm" tabularNumbers>{formatNumber(row.calls)}</BaseText>
            <BaseText size="sm" tabularNumbers>{formatNumber(row.slowCalls)}</BaseText>
            <BaseText size="sm" tabularNumbers>{formatBytes(row.heapIncrease)}</BaseText>
            <BaseText size="sm" tabularNumbers>{formatNumber(row.resources)}</BaseText>
            <BaseText size="sm" tabularNumbers>{formatNumber(row.listeners)}</BaseText>
            <BaseText size="sm" lineClamp={1}>{row.hotSurface}</BaseText>
            <BaseText size="sm" tabularNumbers>{formatMs(row.maxMs)}</BaseText>
        </div>
    );
}

function ReasonPill({ reason }: { reason: ImpactReason; }) {
    return (
        <div className={cl("reason", reason.level)}>
            <BaseText size="xs" weight="semibold">{reason.label}</BaseText>
            <BaseText size="xs" tabularNumbers>{reason.value}</BaseText>
        </div>
    );
}

function SurfaceBreakdown({ row }: { row: DiagnosticsRow; }) {
    const surfaces = Object.entries(row.surfaces)
        .sort(([, a], [, b]) => b.totalMs - a.totalMs)
        .slice(0, 6);

    if (surfaces.length === 0) {
        return <BaseText size="sm" color="text-muted">No measured surface yet.</BaseText>;
    }

    return (
        <div className={cl("surface-list")}>
            {surfaces.map(([surface, stat]) => (
                <div className={cl("surface-row")} key={surface}>
                    <BaseText size="sm" weight="medium" lineClamp={1}>{surface}</BaseText>
                    <BaseText size="sm" tabularNumbers>{formatMs(stat.totalMs)}</BaseText>
                    <BaseText size="sm" tabularNumbers>{formatNumber(stat.calls)} calls</BaseText>
                    <BaseText size="sm" tabularNumbers>{formatMs(stat.maxMs)} max</BaseText>
                </div>
            ))}
        </div>
    );
}

function SnippetList({ item }: { item: ImpactAnalysisItem; }) {
    if (item.snippets.length === 0) {
        return (
            <BaseText size="sm" color="text-muted">
                No snippet is available. This happens when the cost comes from code already patched into Discord or from functions that cannot be inspected at runtime.
            </BaseText>
        );
    }

    return (
        <div className={cl("snippet-list")}>
            {item.snippets.map((snippet, index) => (
                <div className={cl("snippet")} key={`${snippet.surface}-${index}`}>
                    <div className={cl("snippet-title")}>
                        <BaseText size="sm" weight="semibold">{snippet.label}</BaseText>
                        <BaseText size="xs" color="text-muted">{snippet.surface}</BaseText>
                    </div>
                    <div className={cl("snippet-code")}>
                        <CodeBlock content={snippet.fn ? snippet.fn() : snippet.code} lang="tsx" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function ImpactDetails({ item }: { item: ImpactAnalysisItem; }) {
    const { row } = item;

    return (
        <div className={cl("details")}>
            <div className={cl("detail-grid")}>
                <Metric label="Impact" value={row.impact.toFixed(0)} detail={getImpactClass(row.impact)} />
                <Metric label="Total CPU" value={formatMs(row.totalMs)} detail={`${formatNumber(row.calls)} calls`} />
                <Metric label="Positive heap" value={formatBytes(row.heapIncrease)} detail={`Last delta ${formatBytes(row.lastHeapDelta)}`} />
                <Metric label="Resources" value={formatNumber(row.resources)} detail={`${row.intervals} intervals, ${row.listeners} listeners`} />
            </div>

            <div className={cl("detail-section")}>
                <BaseText size="md" weight="semibold">Why it matters</BaseText>
                <div className={cl("reason-list")}>
                    {item.reasons.map(reason => (
                        <div className={cl("reason-line")} key={`${reason.label}-${reason.value}`}>
                            <ReasonPill reason={reason} />
                            <BaseText size="sm">{reason.description}</BaseText>
                        </div>
                    ))}
                </div>
            </div>

            <div className={cl("detail-section")}>
                <BaseText size="md" weight="semibold">Most expensive surfaces</BaseText>
                <SurfaceBreakdown row={row} />
            </div>

            <div className={cl("detail-section")}>
                <BaseText size="md" weight="semibold">Related code</BaseText>
                <SnippetList item={item} />
            </div>
        </div>
    );
}

function ImpactAnalysisCard({ item, selected, onSelect }: { item: ImpactAnalysisItem; selected: boolean; onSelect(): void; }) {
    const { row } = item;
    const impactClass = getImpactClass(row.impact);

    return (
        <div className={cl("analysis-card", selected && "selected")}>
            <div className={cl("analysis-card-head")}>
                <div className={cl("analysis-title")}>
                    <BaseText size="md" weight="semibold" lineClamp={1}>{row.name}</BaseText>
                    <BaseText size="sm" color="text-muted" lineClamp={2}>{item.summary}</BaseText>
                </div>
                <div className={cl("analysis-side")}>
                    <BaseText className={cl("impact", impactClass)} size="sm" weight="semibold" tabularNumbers>{row.impact.toFixed(0)}</BaseText>
                    <Button variant={selected ? "primary" : "secondary"} size="small" onClick={onSelect}>
                        {selected ? "Hide" : "Details"}
                    </Button>
                </div>
            </div>

            <div className={cl("analysis-meta")}>
                <BaseText size="sm" color={item.shouldDisable ? "text-feedback-warning" : "text-muted"}>
                    {item.recommendation}
                </BaseText>
                <div className={cl("reason-list", "compact")}>
                    {item.reasons.slice(0, 4).map(reason => <ReasonPill key={`${reason.label}-${reason.value}`} reason={reason} />)}
                </div>
            </div>

            {selected && <ImpactDetails item={item} />}
        </div>
    );
}

function ImpactAnalysisPage() {
    const { refreshMs } = settings.use(REFRESH_SETTING_KEYS);
    const [query, setQuery] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedPlugin, setSelectedPlugin] = useState<string | undefined>();
    const elapsed = useFixedTimer({ interval: refreshMs });
    const items = React.useMemo(
        () => buildImpactAnalysis(buildRows(false, false, "impact")),
        [elapsed]
    );
    const filteredItems = React.useMemo(
        () => items.filter(item => matchesPluginSearch(item.row.name, searchQuery)),
        [items, searchQuery]
    );

    return (
        <div className={cl("page")}>
            <div className={cl("toolbar")}>
                <div>
                    <BaseText tag="h2" size="xl" weight="semibold">Impact analysis</BaseText>
                    <BaseText size="sm" color="text-muted">
                        This page interprets the metrics and flags plugins that may make Illegalcord lag.
                    </BaseText>
                </div>
                <div className={cl("actions")}>
                    <Button variant="secondary" onClick={copyImpactAnalysisReport} disabled={items.length === 0}>
                        <CopyIcon height={16} width={16} />
                        Copy report
                    </Button>
                </div>
            </div>

            <SearchControls
                query={query}
                onChange={setQuery}
                onSearch={() => setSearchQuery(normalizeSearch(query))}
                disabled={items.length === 0}
            />

            {items.length === 0 ? (
                <div className={cl("empty")}>
                    <BaseText size="md" weight="semibold">No suspicious plugins yet.</BaseText>
                    <BaseText size="sm" color="text-muted">Use the client for a few minutes, then come back here to see collected samples.</BaseText>
                </div>
            ) : filteredItems.length === 0 ? (
                <div className={cl("empty")}>
                    <BaseText size="md" weight="semibold">No plugin matches that search.</BaseText>
                    <BaseText size="sm" color="text-muted">Try another plugin name or clear the search field.</BaseText>
                </div>
            ) : (
                <div className={cl("analysis-list")}>
                    {filteredItems.map(item => (
                        <ImpactAnalysisCard
                            key={item.row.name}
                            item={item}
                            selected={selectedPlugin === item.row.name}
                            onSelect={() => setSelectedPlugin(selectedPlugin === item.row.name ? undefined : item.row.name)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function PluginMonitorPage() {
    const { showDisabled, showApiPlugins, refreshMs } = settings.use(SETTINGS_KEYS);
    const [query, setQuery] = useState("");
    const [selectedPlugin, setSelectedPlugin] = useState<string | undefined>();
    const elapsed = useFixedTimer({ interval: refreshMs });
    const memory = getMemory();
    const rows = React.useMemo(
        () => buildRows(showDisabled, showApiPlugins, "impact"),
        [elapsed, showDisabled, showApiPlugins]
    );
    const normalizedQuery = query.trim().toLowerCase();
    const filteredRows = React.useMemo(
        () => (normalizedQuery
            ? rows.filter(row => row.name.toLowerCase().includes(normalizedQuery))
            : rows).slice(0, 16),
        [normalizedQuery, rows]
    );
    const measuredRows = rows.filter(row => row.calls > 0);
    const selectedRow = rows.find(row => row.name === selectedPlugin) ?? filteredRows[0];
    const totalCpu = measuredRows.reduce((sum, row) => sum + row.totalMs, 0);
    const totalHeapIncrease = measuredRows.reduce((sum, row) => sum + row.heapIncrease, 0);
    const elapsedMs = Math.max(1, Date.now() - startedAt);
    const reasons = selectedRow ? getImpactReasons(selectedRow) : [];

    function selectSearchResult() {
        const exactMatch = normalizedQuery
            ? filteredRows.find(row => row.name.toLowerCase() === normalizedQuery)
                ?? filteredRows.find(row => row.name.toLowerCase().startsWith(normalizedQuery))
            : undefined;
        const match = exactMatch ?? filteredRows[0];

        if (match) setSelectedPlugin(match.name);
    }

    return (
        <div className={cl("page")}>
            <div className={cl("toolbar")}>
                <div>
                    <BaseText tag="h2" size="xl" weight="semibold">Plugin monitor</BaseText>
                    <BaseText size="sm" color="text-muted">
                        Search a plugin and compare its measured CPU and RAM contribution.
                    </BaseText>
                </div>
                <div className={cl("actions")}>
                    <Button variant="secondary" onClick={() => selectedRow && copyPluginMonitorReport(selectedRow, rows)} disabled={!selectedRow}>
                        <CopyIcon height={16} width={16} />
                        Copy report
                    </Button>
                </div>
            </div>

            <SearchControls
                query={query}
                onChange={setQuery}
                onSearch={selectSearchResult}
                disabled={filteredRows.length === 0}
            />

            <div className={cl("monitor-layout")}>
                <div className={cl("monitor-results")}>
                    {filteredRows.length === 0 ? (
                        <BaseText size="sm" color="text-muted">No plugin matches that search.</BaseText>
                    ) : filteredRows.map(row => (
                        <div className={cl("monitor-result", selectedRow?.name === row.name && "selected")} key={row.name}>
                            <div className={cl("plugin-cell")}>
                                <BaseText size="sm" weight="semibold" lineClamp={1}>{row.name}</BaseText>
                                <BaseText size="xs" color="text-muted" lineClamp={1}>{row.enabled ? "Enabled" : "Disabled"}{row.api ? " API" : ""}</BaseText>
                            </div>
                            <BaseText size="sm" tabularNumbers>{formatPercent(getPercent(row.totalMs, totalCpu))}</BaseText>
                            <Button variant={selectedRow?.name === row.name ? "primary" : "secondary"} size="small" onClick={() => setSelectedPlugin(row.name)}>
                                View
                            </Button>
                        </div>
                    ))}
                </div>

                {selectedRow ? (
                    <div className={cl("monitor-panel")}>
                        <div className={cl("monitor-panel-head")}>
                            <div className={cl("analysis-title")}>
                                <BaseText size="lg" weight="semibold" lineClamp={1}>{selectedRow.name}</BaseText>
                                <BaseText size="sm" color="text-muted" lineClamp={2}>
                                    {selectedRow.calls > 0 ? `Measured through ${formatNumber(selectedRow.calls)} callbacks.` : "No measured callbacks yet."}
                                </BaseText>
                            </div>
                            <BaseText className={cl("impact", getImpactClass(selectedRow.impact))} size="sm" weight="semibold" tabularNumbers>{selectedRow.impact.toFixed(0)}</BaseText>
                        </div>

                        <div className={cl("metrics")}>
                            <Metric label="Extra CPU" value={formatPercent(getPercent(selectedRow.totalMs, elapsedMs))} detail={`${formatMs(selectedRow.totalMs)} since reset`} />
                            <Metric label="CPU share" value={formatPercent(getPercent(selectedRow.totalMs, totalCpu))} detail="Of measured plugin CPU" />
                            <Metric label="Extra RAM" value={formatPercent(memory ? getPercent(selectedRow.heapIncrease, memory.usedJSHeapSize) : undefined)} detail={`${formatBytes(selectedRow.heapIncrease)} observed heap +`} />
                            <Metric label="RAM share" value={formatPercent(getPercent(selectedRow.heapIncrease, totalHeapIncrease))} detail="Of measured heap increase" />
                        </div>

                        <div className={cl("detail-grid")}>
                            <Metric label="Max call" value={formatMs(selectedRow.maxMs)} detail={`${formatNumber(selectedRow.slowCalls)} slow calls`} />
                            <Metric label="Resources" value={formatNumber(selectedRow.resources)} detail={`${selectedRow.intervals} intervals, ${selectedRow.listeners} listeners`} />
                            <Metric label="Async time" value={formatMs(selectedRow.asyncMs)} detail={`${formatNumber(selectedRow.asyncCalls)} async calls`} />
                            <Metric label="Last heap delta" value={formatBytes(selectedRow.lastHeapDelta)} detail={memory ? "Chromium heap sample" : "Chromium heap unavailable"} />
                        </div>

                        <div className={cl("detail-section")}>
                            <BaseText size="md" weight="semibold">Signals</BaseText>
                            {reasons.length === 0 ? (
                                <BaseText size="sm" color="text-muted">No risk signal for this plugin yet.</BaseText>
                            ) : (
                                <div className={cl("reason-list")}>
                                    {reasons.map(reason => (
                                        <div className={cl("reason-line")} key={`${reason.label}-${reason.value}`}>
                                            <ReasonPill reason={reason} />
                                            <BaseText size="sm">{reason.description}</BaseText>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className={cl("detail-section")}>
                            <BaseText size="md" weight="semibold">Most expensive surfaces</BaseText>
                            <SurfaceBreakdown row={selectedRow} />
                        </div>
                    </div>
                ) : (
                    <div className={cl("empty")}>
                        <BaseText size="md" weight="semibold">No plugin selected.</BaseText>
                        <BaseText size="sm" color="text-muted">Search for a plugin name, then pick one from the results.</BaseText>
                    </div>
                )}
            </div>
        </div>
    );
}

function DiagnosticsPage() {
    const { sortBy, showDisabled, showApiPlugins, refreshMs } = settings.use(SETTINGS_KEYS);
    const [query, setQuery] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const elapsed = useFixedTimer({ interval: refreshMs });
    const memory = getMemory();
    const rows = React.useMemo(
        () => buildRows(showDisabled, showApiPlugins, sortBy as SortBy),
        [elapsed, showDisabled, showApiPlugins, sortBy]
    );
    const filteredRows = React.useMemo(
        () => rows.filter(row => matchesPluginSearch(row.name, searchQuery)),
        [rows, searchQuery]
    );
    const measuredRows = filteredRows.filter(row => row.calls > 0);
    const totalCpu = measuredRows.reduce((sum, row) => sum + row.totalMs, 0);
    const activeResources = measuredRows.reduce((sum, row) => sum + row.resources, 0);

    return (
        <div className={cl("page")}>
            <div className={cl("toolbar")}>
                <div>
                    <BaseText tag="h2" size="xl" weight="semibold">Client diagnostics</BaseText>
                    <BaseText size="sm" color="text-muted">
                        CPU is measured as JavaScript callback time. Memory uses Chromium heap deltas when available.
                    </BaseText>
                </div>
                <div className={cl("actions")}>
                    <Button variant="secondary" onClick={copyReport}>
                        <CopyIcon height={16} width={16} />
                        Copy report
                    </Button>
                    <Button variant="secondary" onClick={resetStats}>
                        <ResetIcon height={16} width={16} />
                        Reset
                    </Button>
                </div>
            </div>

            <div className={cl("metrics")}>
                <Metric label="Heap used" value={formatBytes(memory?.usedJSHeapSize)} detail={memory ? `${formatBytes(memory.totalJSHeapSize)} allocated` : "Chromium did not expose heap data"} />
                <Metric label="Measured plugins" value={formatNumber(measuredRows.length)} detail={`${formatNumber(filteredRows.length)} visible`} />
                <Metric label="Callback time" value={formatMs(totalCpu)} detail={`Collected for ${formatMs(Date.now() - startedAt)}`} />
                <Metric label="Active resources" value={formatNumber(activeResources)} detail="Timers, frames, and listeners" />
            </div>

            <SearchControls
                query={query}
                onChange={setQuery}
                onSearch={() => setSearchQuery(normalizeSearch(query))}
                disabled={rows.length === 0}
            />

            <div className={cl("table")}>
                <div className={cl("row", "head")}>
                    <BaseText size="xs" weight="semibold">Plugin</BaseText>
                    <BaseText size="xs" weight="semibold">Impact</BaseText>
                    <BaseText size="xs" weight="semibold">CPU</BaseText>
                    <BaseText size="xs" weight="semibold">Calls</BaseText>
                    <BaseText size="xs" weight="semibold">Slow</BaseText>
                    <BaseText size="xs" weight="semibold">Heap +</BaseText>
                    <BaseText size="xs" weight="semibold">Resources</BaseText>
                    <BaseText size="xs" weight="semibold">Listeners</BaseText>
                    <BaseText size="xs" weight="semibold">Hot surface</BaseText>
                    <BaseText size="xs" weight="semibold">Max</BaseText>
                </div>
                {filteredRows.map(row => <PluginRow key={row.name} row={row} />)}
            </div>
            {filteredRows.length === 0 && (
                <div className={cl("empty")}>
                    <BaseText size="md" weight="semibold">No plugin matches that search.</BaseText>
                    <BaseText size="sm" color="text-muted">Try another plugin name or clear the search field.</BaseText>
                </div>
            )}
        </div>
    );
}

function GuidePage() {
    return (
        <div className={cl("page")}>
            <div className={cl("toolbar")}>
                <div>
                    <BaseText tag="h2" size="xl" weight="semibold">Guide</BaseText>
                    <BaseText size="sm" color="text-muted">
                        This page explains what Client Diagnostics measures and how to read the numbers without knowing the code.
                    </BaseText>
                </div>
            </div>

            <div className={cl("guide-section")}>
                <BaseText size="md" weight="semibold">What it is for</BaseText>
                <BaseText size="sm" color="text-muted">
                    Client Diagnostics helps find plugins that may cause lag, freezes, or extra memory usage. It measures time spent inside plugin functions, JavaScript memory growth, and resources that remain active.
                </BaseText>
                <BaseText size="sm" color="text-muted">
                    The numbers are samples collected while you use Illegalcord. If a plugin is not used during collection, it may look light even if it does more work in other situations.
                </BaseText>
            </div>

            <div className={cl("guide-section")}>
                <BaseText size="md" weight="semibold">What the columns mean</BaseText>
                <div className={cl("guide-grid")}>
                    {GUIDE_ITEMS.map(item => (
                        <div className={cl("guide-item")} key={item.label}>
                            <BaseText size="sm" weight="semibold">{item.label}</BaseText>
                            <BaseText size="sm" color="text-muted">{item.description}</BaseText>
                        </div>
                    ))}
                </div>
            </div>

            <div className={cl("guide-section")}>
                <BaseText size="md" weight="semibold">Monitor percentages</BaseText>
                <div className={cl("guide-grid")}>
                    {MONITOR_GUIDE_ITEMS.map(item => (
                        <div className={cl("guide-item")} key={item.label}>
                            <BaseText size="sm" weight="semibold">{item.label}</BaseText>
                            <BaseText size="sm" color="text-muted">{item.description}</BaseText>
                        </div>
                    ))}
                </div>
            </div>

            <div className={cl("guide-section")}>
                <BaseText size="md" weight="semibold">Measurement limits</BaseText>
                <BaseText size="sm" color="text-muted">
                    CPU and RAM are not per-plugin values read directly from the operating system. The plugin estimates cost by observing JavaScript work, Chromium heap data, and resources created during plugin callbacks.
                </BaseText>
            </div>
        </div>
    );
}

function ClientDiagnosticsPage() {
    const [tab, setTab] = useState<ClientDiagnosticsTab>("diagnostics");

    return (
        <div className={cl("root")}>
            <TabBar
                type="top"
                look="brand"
                selectedItem={tab}
                onItemSelect={setTab}
                className={cl("tabs")}
            >
                <TabBar.Item id="diagnostics">Client Diagnostics</TabBar.Item>
                <TabBar.Item id="analysis">Impact analysis</TabBar.Item>
                <TabBar.Item id="monitor">Plugin monitor</TabBar.Item>
                <TabBar.Item id="guide">Guide</TabBar.Item>
            </TabBar>

            {tab === "diagnostics" && <DiagnosticsPage />}
            {tab === "analysis" && <ImpactAnalysisPage />}
            {tab === "monitor" && <PluginMonitorPage />}
            {tab === "guide" && <GuidePage />}
        </div>
    );
}

const DiagnosticsPageWrapped = ErrorBoundary.wrap(ClientDiagnosticsPage, { noop: true });

export default definePlugin({
    name: "Client diagnostics",
    description: "Profiles plugin callback time, heap deltas, and active resources to find laggy plugins.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Developers", "Utility"],
    searchTerms: ["lag", "cpu", "ram", "memory", "performance", "profiler"],
    enabledByDefault: false,
    startAt: StartAt.Init,
    requiresRestart: true,
    settings,

    start() {
        try {
            startedAt = Date.now();
            installGlobalProbes();
            for (const plugin of Object.values(plugins)) instrumentPlugin(plugin);
            startLagNotifications();
            SettingsPlugin.customEntries.push({
                key: ENTRY_KEY,
                title: "Client diagnostics",
                Component: DiagnosticsPageWrapped,
                Icon: ClockIcon
            });
        } catch (error) {
            logger.error("Failed to start client diagnostics.", error);
        }
    },

    stop() {
        try {
            stopLagNotifications();
            restoreGlobalProbes();
            removeFromArray(SettingsPlugin.customEntries, entry => entry.key === ENTRY_KEY);
        } catch (error) {
            logger.error("Failed to stop client diagnostics.", error);
        }
    }
});
