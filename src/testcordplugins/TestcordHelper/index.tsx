/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { PluginHealth } from "@api/PluginHealth";
import { isPluginEnabled, isPluginRequired, plugins as Plugins, pluginStartTimings, startPlugin, stopPlugin } from "@api/PluginManager";
import { RuntimeInterposition, RuntimeInterpositionPriority } from "@api/RuntimeInterposition";
import { definePluginSettings, Settings, SettingsStore, useSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { WarningIcon } from "@components/Icons";
import { AddonCard } from "@components/settings";
import { ExcludedReasons, PluginDependencyList } from "@components/settings/tabs/plugins";
import { PluginCard } from "@components/settings/tabs/plugins/PluginCard";
import { TooltipContainer } from "@components/TooltipContainer";
import { gitHashShort } from "@shared/vencordUserAgent";
import { fetchUserProfile, openUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { sleep, tryOrElse } from "@utils/misc";
import { makeCodeblock, ZWSP } from "@utils/text";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Message, User } from "@vencord/discord-types";
import { wreq } from "@webpack";
import { Avatar, Button, ChannelStore, ColorPicker, Constants, FluxDispatcher, MessageActions, RestAPI, SelectedChannelStore, showToast, TextInput, Toasts, Tooltip, useEffect, useMemo, UserProfileStore, UserStore, useStateFromStores } from "@webpack/common";
import { patches as allPatches, patchTimings } from "@webpack/patcher";
import { JSX } from "react";

import { wrapFluxHandlers } from "../orchestratorAPI";

const NativeHelper = VencordNative.pluginHelpers.TestcordHelper as PluginNative<typeof import("./native")>;

import plugins, { ExcludedPlugins, PluginMeta } from "~plugins";

import { hexToInt, ICON_COLOR_FALLBACK, IconColorSettingKey, IconColorSettings, intToHex, isIconColorInputValid } from "./iconColors";

const logger = new Logger("TestcordHelper");

let prevOnerror: ((...args: any[]) => any) | null = null;
let crashGuardsActive = false;

function crashRejectionHandler(e: PromiseRejectionEvent) {
    e.preventDefault();
    logger.warn("Suppressed unhandled promise rejection:", e.reason);
}

function installCrashGuards() {
    if (crashGuardsActive) return;
    crashGuardsActive = true;
    prevOnerror = window.onerror;
    window.onerror = (_msg, _src, _line, _col, error) => {
        logger.warn("Suppressed unhandled error:", error ?? _msg);
        return true;
    };
    window.addEventListener("unhandledrejection", crashRejectionHandler);
}

function uninstallCrashGuards() {
    if (!crashGuardsActive) return;
    crashGuardsActive = false;
    window.onerror = prevOnerror;
    prevOnerror = null;
    window.removeEventListener("unhandledrejection", crashRejectionHandler);
}

// Harmless Discord-internal errors that spam the console but don't affect functionality.
// Install once on module load so they are suppressed even without preventCrashes enabled.
(function installHarmlessErrorFilters() {
    const isHarmless = (text: string) =>
        (text.includes("EADDRINUSE") && text.includes("6463")) ||
        text.includes("Sentry successfully disabled") ||
        text.includes("NoiseCancellerError") || text.includes("noise-canceller-error") ||
        (text.includes("url parse") && text.includes("libdiscore")) ||
        text.includes("referrals/eligibility") ||
        text.includes("getCurrentUser does not have a value");

    window.addEventListener("error", e => {
        const text = `${e.message} ${String((e as any).error?.message ?? "")} ${String((e as any).error?.stack ?? "")}`;
        if (isHarmless(text)) e.preventDefault();
    }, true);

    window.addEventListener("unhandledrejection", e => {
        const text = String((e.reason as any)?.message ?? e.reason ?? "");
        if (isHarmless(text)) e.preventDefault();
    });

    // Intercept console methods for the same patterns so the Webpack "AVError" etc don't flood.
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const origLog = console.log.bind(console);
    const wrapConsole = (orig: (...a: any[]) => void) => (...args: any[]) => {
        const text = args.map(a => typeof a === "string" ? a : String((a as any)?.message ?? (a as any)?.stack ?? (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ");
        if (isHarmless(text)) return;
        return orig(...args);
    };
    console.error = wrapConsole(origError);
    console.warn = wrapConsole(origWarn);
    console.log = wrapConsole(origLog);

    try {
        const proc = (globalThis as any).process;
        if (proc?.on) {
            const origOn = proc.on.bind(proc);
            // Swallow EADDRINUSE 6463 at process level (Electron main/renderer)
            proc.on("uncaughtException", (err: any) => {
                if (isHarmless(String(err?.message ?? "") + String(err?.stack ?? ""))) return;
                origError(err);
            });
        }
    } catch { }
})();

let origDispatch: ((payload: any) => void) | null = null;
let origSubscribe: ((event: string, handler: (...args: any[]) => void) => void) | null = null;
let disposeDispatch: (() => void) | null = null;
let disposeSubscribe: (() => void) | null = null;
const dispatchStats = new Map<string, { count: number; totalMs: number; maxMs: number; }>();
const pluginDispatchStats = new Map<string, { count: number; totalMs: number; maxMs: number; }>();
let channelSwitchStart = 0;

const SLOW_DISPATCH_MS = 16;
const RECENT_EVENTS_LIMIT = 200;
const recentSlowEvents: Array<{ at: number; type: string; ms: number; plugins: string[]; }> = [];
let pluginFluxMap: Map<string, string[]> | undefined;
const handlerPluginMap = new Map<(...args: any[]) => void, string>();
const handlerWrappers = new Map<(...args: any[]) => void, (...args: any[]) => void>();

function getPluginFluxMap() {
    if (pluginFluxMap) return pluginFluxMap;
    pluginFluxMap = new Map();
    for (const name in plugins) {
        const { flux } = plugins[name];
        if (!flux) continue;
        for (const eventType in flux) {
            const list = pluginFluxMap.get(eventType) ?? [];
            list.push(name);
            pluginFluxMap.set(eventType, list);
        }
    }
    return pluginFluxMap;
}

function getPluginsForEvent(type: string): string[] {
    return getPluginFluxMap().get(type) ?? [];
}

function buildHandlerPluginMap() {
    handlerPluginMap.clear();
    for (const name in plugins) {
        const { flux } = plugins[name];
        if (!flux) continue;
        for (const eventType in flux) {
            const handler = flux[eventType];
            if (typeof handler !== "function") continue;
            handlerPluginMap.set(handler as (...args: any[]) => void, name);
        }
    }
}

/** Per-plugin milliseconds spent inside the dispatch currently on the stack. */
const currentDispatchCost = new Map<string, number>();

function wrapHandlerTiming(handler: (...args: any[]) => void): (...args: any[]) => void {
    const wrapped = function (this: any, ...args: any[]) {
        const t0 = performance.now();
        handler.apply(this, args);
        const dt = performance.now() - t0;
        const plugin = handlerPluginMap.get(handler) ?? "unknown";
        const stat = pluginDispatchStats.get(plugin) ?? { count: 0, totalMs: 0, maxMs: 0 };
        stat.count++;
        stat.totalMs += dt;
        stat.maxMs = Math.max(stat.maxMs, dt);
        pluginDispatchStats.set(plugin, stat);
        currentDispatchCost.set(plugin, (currentDispatchCost.get(plugin) ?? 0) + dt);
    };
    handlerWrappers.set(handler, wrapped);
    return wrapped;
}

/**
 * What a slow dispatch actually cost, per plugin. Listing everything subscribed to the event
 * instead blamed all 36 MESSAGE_CREATE subscribers for time that is mostly Discord's own
 * stores and React, which sent several perf investigations after the wrong plugin.
 */
function describeDispatchBlame(type: string, totalMs: number) {
    if (currentDispatchCost.size === 0) {
        const subscribed = getPluginsForEvent(type);
        return {
            plugins: subscribed,
            text: subscribed.length
                ? ` — no per-plugin timing (enable debugMode); ${subscribed.length} plugins subscribed`
                : ""
        };
    }

    const measured = [...currentDispatchCost.entries()]
        .filter(([, ms]) => ms >= 0.5)
        .sort((a, b) => b[1] - a[1]);
    const pluginMs = [...currentDispatchCost.values()].reduce((a, b) => a + b, 0);
    const top = measured.slice(0, 5).map(([name, ms]) => `${name} ${ms.toFixed(1)}ms`);

    return {
        plugins: measured.map(([name]) => name),
        text: ` — plugins ${pluginMs.toFixed(1)}ms of ${totalMs.toFixed(1)}ms`
            + (top.length ? ` (${top.join(", ")})` : " (none individually significant)")
            + ", rest is Discord"
    };
}

function dumpPatchDiagnostics() {
    const all = PluginHealth.getAll();
    console.group("%c[TestcordHelper] Patch Diagnostics", "color: #ff4f4f; font-weight: bold; font-size: 14px;");
    if (all.size === 0) {
        console.log("%cNo patch failures detected.", "color: #4fff4f;");
    } else {
        let totalFailures = 0;
        for (const [plugin, entry] of all) {
            totalFailures += entry.patchFailures.length;
            console.group(`%c${plugin} (${entry.patchFailures.length} patch failures, ${entry.runtimeErrors.length} runtime errors)`, "color: #ffaa00; font-weight: bold;");
            for (const f of entry.patchFailures) {
                const parts = [`[${f.kind}]`, `find: ${f.find}`];
                if (f.match) parts.push(`match: ${f.match}`);
                if (f.moduleId !== undefined) parts.push(`moduleId: ${String(f.moduleId)}`);
                if (f.error) parts.push(`error: ${f.error}`);
                console.log(parts.join(" | "));
                if (f.sourceContext) console.log(`sourceContext: ${f.sourceContext}`);
            }
            for (const e of entry.runtimeErrors) {
                console.log(`[runtime:${e.source}] ${e.error}`);
            }
            console.groupEnd();
        }
        console.log(`%cTotal: ${all.size} unhealthy plugins, ${totalFailures} patch failures`, "color: #ff4f4f; font-weight: bold;");
    }
    console.log(`Total patches registered: ${allPatches.length}`);
    if (allPatches.length) {
        console.group("Pending patches / missing modules");
        for (const patch of allPatches) {
            console.log(`${patch.plugin} | find: ${String(patch.find)} | replacements: ${(patch.replacement as Array<{ match: string | RegExp; }>).map(r => String(r.match)).join(" ; ")}`);
        }
        console.groupEnd();
    }
    console.groupEnd();
}

function dumpPluginStartTimings() {
    console.group("%cPlugin Startup Timings", "color: #ff4f4f; font-weight: bold;");
    const sorted = [...pluginStartTimings].sort((a, b) => b[1].duration - a[1].duration);
    for (const [plugin, timing] of sorted) {
        console.log(`${plugin}: ${timing.duration.toFixed(2)}ms${timing.success ? "" : " | FAILED"}`);
    }
    console.log(`${sorted.length} plugins | ${sorted.reduce((total, [, timing]) => total + timing.duration, 0).toFixed(2)}ms total`);
    console.groupEnd();
}

function dumpPatchTimings() {
    if (patchTimings.length === 0) {
        console.log("%cNo patch timing data.", "color: #888;");
        return;
    }
    console.group("%cPatch Timings (top 30 slowest)", "color: #ff4f4f; font-weight: bold;");
    const sorted = [...patchTimings].sort((a, b) => b[3] - a[3]).slice(0, 30);
    for (const [plugin, moduleId, match, totalTime] of sorted) {
        console.log(`${plugin} | moduleId ${String(moduleId)} | ${String(match).slice(0, 80)} | ${totalTime.toFixed(2)}ms`);
    }
    console.groupEnd();
}

function dumpDispatchStats() {
    console.warn("%cFlux Dispatch Timings", "color: #ff4f4f; font-weight: bold;");
    if (dispatchStats.size === 0) {
        console.warn("No dispatch data. Enable debug mode and interact with Discord first.");
    } else {
        const sorted = [...dispatchStats.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
        for (const [type, stat] of sorted) {
            const avg = stat.totalMs / stat.count;
            const flag = stat.maxMs > 16 ? " !! SLOW" : "";
            console.warn(`${type}: ${stat.count}x | avg ${avg.toFixed(1)}ms | max ${stat.maxMs.toFixed(1)}ms | total ${stat.totalMs.toFixed(1)}ms${flag}`);
        }
    }
    console.warn("%cPer-Plugin Dispatch Timings", "color: #ff4f4f; font-weight: bold;");
    if (pluginDispatchStats.size === 0) {
        console.warn("No per-plugin dispatch data. Enable debug mode and interact with Discord first.");
    } else {
        const sorted = [...pluginDispatchStats.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
        for (const [plugin, stat] of sorted) {
            const avg = stat.totalMs / stat.count;
            const flag = stat.maxMs > 16 ? " !! SLOW" : "";
            console.warn(`${plugin}: ${stat.count}x | avg ${avg.toFixed(1)}ms | max ${stat.maxMs.toFixed(1)}ms | total ${stat.totalMs.toFixed(1)}ms${flag}`);
        }
    }
}

function dumpFullReport() {
    const health = [...PluginHealth.getAll()].map(([plugin, entry]) => ({
        plugin,
        patchFailures: entry.patchFailures,
        runtimeErrors: entry.runtimeErrors
    }));
    const snapshot = {
        generatedAt: new Date().toISOString(),
        pluginStartTimings: [...pluginStartTimings].map(([plugin, timing]) => ({ plugin, ...timing })),
        dispatchStats: [...dispatchStats].map(([type, stat]) => ({ type, ...stat, averageMs: stat.totalMs / stat.count })),
        patchTimings: patchTimings.map(([plugin, moduleId, match, duration]) => ({ plugin, moduleId: String(moduleId), match: String(match), duration })),
        pendingPatches: allPatches.map(patch => ({
            plugin: patch.plugin,
            find: String(patch.find),
            matches: (patch.replacement as Array<{ match: string | RegExp; }>).map(replacement => String(replacement.match))
        })),
        health,
        memory: getMemoryUsage()
    };
    console.log("[TestcordHelper] DEBUG_SNAPSHOT " + JSON.stringify(snapshot));
    console.group("%c[TestcordHelper] Full Debug Report", "color: #5865f2; font-weight: bold; font-size: 16px;");
    dumpPatchDiagnostics();
    dumpPluginStartTimings();
    console.warn(`[TestcordHelper] === DISPATCH STATS: ${dispatchStats.size} types, ${pluginDispatchStats.size} plugins ===`);
    try {
        dumpDispatchStats();
    } catch (e) {
        console.warn("[TestcordHelper ERROR] dumpDispatchStats threw:", e);
    }
    try {
        dumpPatchTimings();
    } catch (e) {
        console.warn("[TestcordHelper ERROR] dumpPatchTimings threw:", e);
    }
    console.group("%cMemory", "color: #ff4f4f; font-weight: bold;");
    console.log(getMemoryUsage());
    console.groupEnd();
    console.groupEnd();
}

function installDebugInstrumentation() {
    if (origDispatch) return;

    pluginDispatchStats.clear();
    dispatchStats.clear();
    dumpPatchDiagnostics();
    dumpPatchTimings();
    buildHandlerPluginMap();

    if (!FluxDispatcher?.dispatch) return;
    disposeDispatch = RuntimeInterposition.register({
        owner: "TestcordHelper",
        hook: "fluxDispatch",
        priority: RuntimeInterpositionPriority.DIAGNOSTICS,
        wrap: next => {
            origDispatch = next as (payload: any) => void;
            return function (payload: any) {
                currentDispatchCost.clear();
                const t0 = performance.now();
                const result = next.call(FluxDispatcher, payload);
                const dt = performance.now() - t0;

                const stat = dispatchStats.get(payload.type) ?? { count: 0, totalMs: 0, maxMs: 0 };
                stat.count++;
                stat.totalMs += dt;
                stat.maxMs = Math.max(stat.maxMs, dt);
                dispatchStats.set(payload.type, stat);

                if (dt > SLOW_DISPATCH_MS) {
                    const blame = describeDispatchBlame(payload.type, dt);
                    recentSlowEvents.push({ at: Date.now(), type: payload.type, ms: Math.round(dt * 10) / 10, plugins: blame.plugins });
                    if (recentSlowEvents.length > RECENT_EVENTS_LIMIT) recentSlowEvents.shift();
                    console.warn(`%c[TestcordHelper] Slow dispatch: %c${payload.type}%c took ${dt.toFixed(1)}ms${blame.text}`, "color: #ff4f4f;", "color: #ffaa00; font-weight: bold;", "color: inherit;");
                }

                if (payload.type === "CHANNEL_SELECT") {
                    channelSwitchStart = t0;
                } else if (channelSwitchStart && payload.type === "LOAD_MESSAGES_SUCCESS") {
                    // Only LOAD_MESSAGES_SUCCESS means "the messages are here". Stopping the clock on
                    // MESSAGE_CREATE measured how long until somebody happened to send a message,
                    // which reported multi-second channel loads that never happened.
                    const elapsed = t0 - channelSwitchStart;
                    logger.info(`Channel load took ${elapsed.toFixed(1)}ms`);
                    channelSwitchStart = 0;
                }

                return result;
            };
        }
    });

    try {
        disposeSubscribe = RuntimeInterposition.register({
            owner: "TestcordHelper",
            hook: "fluxSubscribe",
            priority: RuntimeInterpositionPriority.DIAGNOSTICS,
            wrap: next => {
                origSubscribe = next as (event: string, handler: (...args: any[]) => void) => void;
                return function (event: any, handler: (...args: any[]) => void) {
                    const name = handlerPluginMap.get(handler);
                    if (name && !handlerWrappers.has(handler)) handler = wrapHandlerTiming(handler);
                    return next.call(FluxDispatcher, event, handler);
                };
            }
        });
    } catch (error) {
        disposeDispatch();
        disposeDispatch = null;
        origDispatch = null;
        logger.error("Failed to install debug instrumentation:", error);
        return;
    }

    let wrappedCount = 0;
    try {
        wrapFluxHandlers(handler => {
            const name = handlerPluginMap.get(handler);
            if (name && !handlerWrappers.has(handler)) {
                const wrapped = wrapHandlerTiming(handler);
                handlerWrappers.set(handler, wrapped);
                wrappedCount++;
                return wrapped;
            }
            return handler;
        });
        logger.info(`Wrapped ${wrappedCount} flux handlers via orchestrator API.`);
    } catch (e) {
        logger.error("Failed to wrap orchestrator flux handlers:", e);
    }

    logger.info("Debug instrumentation installed. Tracking dispatches and patch diagnostics. Use /tdebug to dump the full report.");
    showToast("Debug mode enabled. Check console for diagnostics.", Toasts.Type.MESSAGE);
}

function uninstallDebugInstrumentation() {
    disposeDispatch?.();
    disposeSubscribe?.();
    disposeDispatch = null;
    disposeSubscribe = null;
    origDispatch = null;
    origSubscribe = null;
    dispatchStats.clear();
    pluginDispatchStats.clear();
    handlerPluginMap.clear();
    handlerWrappers.clear();
    channelSwitchStart = 0;
    logger.info("Debug instrumentation removed.");
}

interface ProfileTheme {
    themeColors?: number[] | null;
}

const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;
const RenderEmbeds = getUserSettingLazy<boolean>("textAndImages", "renderEmbeds")!;

const MESSAGE_LIMIT = 1900;
const MB = 1024 * 1024;

const PLUGIN_PATTERN = /(?:testcordplugin|tcp):([^\s,;\n]+)/gi;
const PLUGIN_MATCH_PATTERN = /(?:testcordplugin|tcp):([^\s,;\n]+)/i;
const PLUGIN_LINK_PATTERN = /\[([^\]]+)]\(<?https:\/\/github\.com\/TestcordDev\/Testcord\/tree\/main\/src\/(?:plugins|equicordplugins|testcordplugins)\/[^>)]+>?\)/gi;
const PLUGIN_CARD_MARKER_PATTERN = /(?:testcordplugin|tcp):|github\.com\/TestcordDev\/Testcord\/tree\/main\/src\/(?:plugins|equicordplugins|testcordplugins)\//i;
const PLUGIN_RESOLVE_CACHE_LIMIT = 500;
const pluginResolveCache = new Map<string, string | null>();
const USER_PATTERN = /dcp:([^\s,;\n]+)/gi;
const USER_MATCH_PATTERN = /dcp:([^\s,;\n]+)/i;
const USER_LINK_PATTERN = /\[[^\]]+]\(<?https:\/\/discord\.com\/users\/(\d{17,20})>?\)/gi;
const USER_CARD_MARKER_PATTERN = /dcp:|discord\.com\/users\/\d{17,20}/i;
const USER_MENTION_PATTERN = /^<@!?(\d{17,20})>$/;
const USER_ID_PATTERN = /^\d{17,20}$/;
const USER_RESOLVE_CACHE_LIMIT = 500;
const userResolveCache = new Map<string, string | null>();

function IconColorRow({ settingKey }: { settingKey: IconColorSettingKey; }) {
    const { label, description } = IconColorSettings[settingKey];
    const value = settings.store[settingKey] ?? "";

    return (
        <div style={{ display: "grid", gap: 8 }}>
            <BaseText size="md" weight="medium">{label}</BaseText>
            <BaseText size="sm">{description}</BaseText>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center" }}>
                <TextInput
                    value={value}
                    placeholder="Theme default"
                    onChange={newValue => settings.store[settingKey] = newValue}
                />
                <ColorPicker
                    color={hexToInt(value) ?? hexToInt(ICON_COLOR_FALLBACK) ?? 0xb5bac1}
                    onChange={color => {
                        if (color != null) settings.store[settingKey] = intToHex(color);
                    }}
                    showEyeDropper={true}
                />
            </div>
        </div>
    );
}

function IconColorSettingsComponent() {
    return (
        <div style={{ display: "grid", gap: 16 }}>
            <BaseText size="lg" weight="bold">Default Plugin Icon Colors</BaseText>
            <BaseText size="sm">Leave a field empty to use Discord's theme color.</BaseText>
            {(Object.keys(IconColorSettings) as IconColorSettingKey[]).map(settingKey => (
                <IconColorRow key={settingKey} settingKey={settingKey} />
            ))}
        </div>
    );
}

interface PluginSearchEntry {
    name: string;
    lower: string;
    acronym: string;
    searchTerms?: string[];
    description?: string;
}

let pluginSearchData: PluginSearchEntry[] | undefined;

function round2(n: number) {
    return Math.floor(n * 100) / 100;
}

function getMemoryUsage(): string {
    const mem = (window as any).performance?.memory;
    if (!mem) return "N/A (API blocked)";
    return `${round2(mem.usedJSHeapSize / MB)}MB used / ${round2(mem.totalJSHeapSize / MB)}MB total (limit: ${round2(mem.jsHeapSizeLimit / MB)}MB)`;
}

const settings = definePluginSettings({
    enableCustomBadges: {
        type: OptionType.BOOLEAN,
        description: "Enable custom testcord badges from tbadges GitHub repository",
        default: true,
    },
    pronounsBadge: {
        type: OptionType.BOOLEAN,
        description: "Show the Testcord badge by adding a hidden marker to your pronouns. Turn off to remove it.",
        default: true,
    },
    CarefulNetwork: {
        type: OptionType.BOOLEAN,
        description: "Dedupe and briefly cache repeated Testcord plugin network requests.",
        default: false,
    },
    iconColorSettings: {
        type: OptionType.COMPONENT,
        component: IconColorSettingsComponent
    },
    userAreaButtonIconColor: {
        type: OptionType.STRING,
        description: "Default icon color for buttons next to mute, deafen, and settings.",
        default: "",
        hidden: true,
        isValid: isIconColorInputValid
    },
    chatBoxButtonIconColor: {
        type: OptionType.STRING,
        description: "Default icon color for plugin buttons in the chat input.",
        default: "",
        hidden: true,
        isValid: isIconColorInputValid
    },
    topBarButtonIconColor: {
        type: OptionType.STRING,
        description: "Default icon color for plugin buttons in Discord's top title bar.",
        default: "",
        hidden: true,
        isValid: isIconColorInputValid
    },
    headerBarButtonIconColor: {
        type: OptionType.STRING,
        description: "Default icon color for plugin buttons in channel headers.",
        default: "",
        hidden: true,
        isValid: isIconColorInputValid
    },
    performanceMode: {
        type: OptionType.BOOLEAN,
        description: "Show optional performance features. Nothing here is enabled unless its own toggle is on.",
        default: false,
    },
    performanceCarefulNetwork: {
        type: OptionType.BOOLEAN,
        description: "Use Testcord's request coordinator for supported plugin requests without changing Discord payloads.",
        default: false,
    },
    performanceBoundRequestCache: {
        type: OptionType.BOOLEAN,
        description: "Limit the request coordinator cache and remove expired entries to reduce memory usage.",
        default: false,
    },
    performanceRequestCacheEntries: {
        type: OptionType.SLIDER,
        description: "Maximum request coordinator cache entries when the cache limit is enabled.",
        markers: [50, 100, 250, 500, 1000],
        default: 250,
    },
    performanceDisablePluginCards: {
        type: OptionType.BOOLEAN,
        description: "Do not render Testcord plugin cards under chat messages.",
        default: false,
    },
    disableProfilePopoutEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Do not convert dcp:user shortcuts or render Discord profile cards.",
        default: false,
    },
    useUsernameInProfileLinks: {
        type: OptionType.BOOLEAN,
        description: "Use usernames instead of display names in dcp:user links.",
        default: false,
    },
    performanceCachePluginCards: {
        type: OptionType.BOOLEAN,
        description: "Cache plugin name lookups and skip plugin-card scans for messages that cannot contain plugin links.",
        default: false,
    },
    performanceNetworkOptimizations: {
        type: OptionType.BOOLEAN,
        description: "Reduce network requests across Testcord plugins: share and dedupe repeated message fetches, cache immutable resources, warm up the connection, and parallelize independent requests. No change to what Discord receives.",
        default: false,
    },
    performanceAggressiveNetwork: {
        type: OptionType.BOOLEAN,
        description: "Aggressive network mode for supported plugins (e.g. AutoRedeem skip-precheck and higher concurrency). Faster, but may increase captcha and rate-limit risk. Requires the network optimizations toggle above.",
        default: false,
    },
    orchestrator: {
        type: OptionType.BOOLEAN,
        description: "Enable the performance orchestrator. Coalesces duplicate Flux event subscriptions into a single dispatch and hardens context menu patches so a throwing patch is auto-disabled instead of lagging every right-click. Applies live, no restart needed.",
        default: true,
        onChange(value) {
            const p = Plugins.OrchestratorAPI;
            if (!p) return;
            if (value) {
                Settings.plugins.OrchestratorAPI.enabled = true;
                if (!p.started) startPlugin(p);
            } else {
                if (p.started) stopPlugin(p);
                Settings.plugins.OrchestratorAPI.enabled = false;
            }
        }
    },
    messageCoalesce: {
        type: OptionType.BOOLEAN,
        description: "Batch rapid MESSAGE_CREATE events per-channel: only dispatch the latest message from each channel within a 100ms window. Drastically cuts React re-render storms in busy channels. Applies live, no restart needed.",
        default: true,
        onChange(value) {
            const p = Plugins.OrchestratorAPI;
            if (!p) return;
            if (value) {
                Settings.plugins.OrchestratorAPI.enabled = true;
                Settings.plugins.OrchestratorAPI.messageCoalesce = true;
                if (!p.started) {
                    Settings.plugins.OrchestratorAPI.fluxBus = true;
                    startPlugin(p);
                }
            } else {
                Settings.plugins.OrchestratorAPI.messageCoalesce = false;
            }
        }
    },
    bigChatMode: {
        type: OptionType.BOOLEAN,
        description: "Enable a bundle of aggressive optimizations for large busy servers: freeze member list, force passive scroll listeners, disable unread badge DOM updates, optimize chat input, apply paint containment to message attachments, and skip react-spring animations. Reload recommended.",
        default: false,
        onChange(value) {
            const p = Plugins.TestcordOptimizer;
            const op = Settings.plugins.TestcordOptimizer;
            if (!op) return;
            op.freezeMemberList = value;
            op.forcePassiveListeners = value;
            op.disableUnreadBadges = value;
            op.optimizeChatInput = value;
            op.optimizeLargeAttachments = value;
            op.containAttachmentImages = value;
            op.disableSpringAnimations = value;
            if (value && p && !p.started) {
                Settings.plugins.TestcordOptimizer.enabled = true;
                startPlugin(p);
            }
        }
    },
    preventCrashes: {
        type: OptionType.BOOLEAN,
        description: "Swallow all unhandled errors and promise rejections to keep Discord running no matter what. Errors are logged to console instead of crashing. Applies live, no restart needed.",
        default: false,
        onChange(value) {
            if (value) installCrashGuards();
            else uninstallCrashGuards();
        }
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Log broken patches and slow Flux dispatches. This can reduce performance and should only be enabled temporarily.",
        default: false,
        onChange(value) {
            if (value) installDebugInstrumentation();
            else uninstallDebugInstrumentation();
        }
    },
    liveFix: {
        type: OptionType.BOOLEAN,
        description: "Start a local HTTP server (port 18963) for opencode to search webpack modules, read source code, and test patch patterns in real time.",
        default: false,
        onChange(value) {
            if (value) startLiveFixServer();
            else stopLiveFixServer();
        }
    },
    liveFixRequireToken: {
        type: OptionType.BOOLEAN,
        description: "Require the per-session auth token on LiveFix requests. Leave this on unless your tooling cannot send it.",
        default: true
    }
});

function isPerformanceEnabled() {
    return settings.store.performanceMode === true;
}

function isPluginCardCacheEnabled() {
    return isPerformanceEnabled() && settings.store.performanceCachePluginCards === true;
}

function getPluginSearchData() {
    pluginSearchData ??= Object.keys(plugins).map(name => ({
        name,
        lower: name.toLowerCase(),
        acronym: name.match(/[A-Z]/g)?.join("").toLowerCase() ?? "",
        searchTerms: plugins[name].searchTerms?.map(t => t.toLowerCase()),
        description: plugins[name].description?.toLowerCase(),
    }));

    return pluginSearchData;
}

function getClient() {
    if (IS_DISCORD_DESKTOP) return `Discord Desktop v${DiscordNative.app.getVersion()}`;
    if (IS_VESKTOP) return `Vesktop v${VesktopNative.app.getVersion()}`;
    if (IS_EQUIBOP) {
        const hash = tryOrElse(() => VesktopNative.app.getGitHash?.(), null);
        const dev = tryOrElse(() => VesktopNative.app.isDevBuild?.(), false);
        const spoof = tryOrElse(() => VesktopNative.app.getPlatformSpoofInfo?.(), null);
        return `Equibop v${VesktopNative.app.getVersion()} [${hash?.slice(0, 7) ?? "?"}]${dev ? " DEV" : ""}${spoof?.spoofed ? ` (spoof: ${spoof.originalPlatform})` : ""}`;
    }
    if ("legcord" in window) return `LegCord v${(window as any).legcord.version}`;
    if ("goofcord" in window) return `GoofCord v${(window as any).goofcord.version}`;
    return typeof (window as any).unsafeWindow !== "undefined" ? "UserScript" : "Web";
}

async function buildDebugReport() {
    const { RELEASE_CHANNEL } = (window as any).GLOBAL_ENV;
    const client = getClient();
    const user = UserStore.getCurrentUser();
    const platform = IS_DISCORD_DESKTOP ? "Windows" : IS_WEB ? "Web" : "Unknown";

    const info = {
        Testcord: `v${(globalThis as any).VERSION} • ${gitHashShort} — ${Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format((globalThis as any).BUILD_TIMESTAMP)}`,
        Client: `${RELEASE_CHANNEL} ~ ${client}`,
        Platform: platform,
        "JS Memory": getMemoryUsage(),
    };

    const problematic = ["NoRPC", "NoProfileThemes", "NoMosaic", "NoRoleHeaders", "Ingtoninator", "NeverPausePreviews", "IdleAutoRestart"].filter(isPluginEnabled).sort();

    const flags = {
        "Activity Sharing Disabled": tryOrElse(() => !ShowCurrentGame.getSetting(), false),
        "Link Embeds Disabled": tryOrElse(() => !RenderEmbeds.getSetting(), false),
        "TestCord DevBuild": !IS_STANDALONE,
        "Equibop DevBuild": IS_EQUIBOP && tryOrElse(() => VesktopNative.app.isDevBuild?.(), false),
        "Platform Spoofed": (IS_EQUIBOP && tryOrElse(() => VesktopNative.app.getPlatformSpoofInfo?.(), null)?.spoofed) ?? false,
        ">2 Weeks Outdated": (globalThis as any).BUILD_TIMESTAMP < Date.now() - 12096e5,
    };

    let out = `>>> ${Object.entries(info).map(([k, v]) => `**${k}**: ${v}`).join("\n")}`;
    const activeFlags = Object.entries(flags).filter(([, v]) => v).map(([k]) => `\u26a0\ufe0f ${k}`).join("\n");
    if (activeFlags) out += "\n" + activeFlags;
    if (problematic.length) out += `\n\n**Potentially Problematic Plugins**: ${problematic.join(", ")}\n-# note, those plugins are just common issues and might not be the problem`;
    if (user) out += `\n\n**User**: ${user.username}#${user.discriminator} (\`${user.id}\`)`;

    return out.trim();
}

function chunkByLines(text: string, limit: number): string[] {
    const lines = text.split("\n");
    const chunks: string[] = [];
    let current: string[] = [];
    let currentLen = 0;

    for (const line of lines) {
        const addedLen = currentLen + (current.length ? 1 : 0) + line.length;
        if (addedLen > limit && current.length) {
            chunks.push(current.join("\n"));
            current = [line];
            currentLen = line.length;
        } else {
            current.push(line);
            currentLen = addedLen;
        }
    }
    if (current.length) chunks.push(current.join("\n"));
    return chunks;
}

async function sendMessage(channelId: string, content: string) {
    MessageActions.sendMessage(channelId, { content, invalidEmojis: [] }, undefined, {});
    await sleep(1000);
}

async function sendDebugReport() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) {
        showToast("No channel selected. Open a text channel first.", Toasts.Type.FAILURE);
        return;
    }
    const channel = ChannelStore.getChannel(channelId);
    if (!channel || ![0, 1, 3].includes(channel.type)) {
        showToast("Cannot send messages in this channel type.", Toasts.Type.FAILURE);
        return;
    }

    const report = await buildDebugReport();

    if (report.length > MESSAGE_LIMIT) {
        const chunks = chunkByLines(report, MESSAGE_LIMIT);
        for (let i = 0; i < chunks.length; i++) {
            await sendMessage(channelId, `**Debug Report [${i + 1}/${chunks.length}]**\n${chunks[i]}`);
        }
    } else {
        await sendMessage(channelId, report);
    }

    const isApi = (name: string) => name.endsWith("API") || plugins[name]?.required;
    const enabled = Object.keys(PluginMeta).filter(p => isPluginEnabled(p) && !isApi(p));
    const stock = enabled.filter(p => !PluginMeta[p].userPlugin).sort();
    const user = enabled.filter(p => PluginMeta[p].userPlugin).sort();

    for (const [header, list] of [
        [`**Enabled Stock Plugins (${stock.length}):**`, stock],
        [`**Enabled User Plugins (${user.length}):**`, user],
    ] as const) {
        if (!list.length) continue;
        const max = MESSAGE_LIMIT - header.length - makeCodeblock("").length;
        let batch: string[] = [];
        let batchLen = 0;
        for (const name of list) {
            const piece = name + ", ";
            if (batchLen + piece.length > max && batch.length) {
                await sendMessage(channelId, `${header}\n${makeCodeblock(batch.join(", "))}`);
                batch = [name];
                batchLen = name.length;
            } else {
                batch.push(name);
                batchLen += piece.length;
            }
        }
        if (batch.length) await sendMessage(channelId, `${header}\n${makeCodeblock(batch.join(", "))}`);
    }

    showToast("Debug report sent!", Toasts.Type.SUCCESS);
}

function ChatPluginCard({ pluginName, description }: { pluginName: string; description?: string; }) {
    useSettings([`plugins.${pluginName ?? ""}.enabled`]);

    if (!pluginName) return null;

    const p = plugins[pluginName];
    const excludedPlugin = ExcludedPlugins[pluginName];

    if (excludedPlugin || !p) {
        const toolTipText = excludedPlugin
            ? `${pluginName} is only available on the ${ExcludedReasons[ExcludedPlugins[pluginName]]}`
            : "This plugin is not on this version of Testcord. Try updating!";

        const card = (
            <AddonCard
                name={pluginName}
                description={description || toolTipText}
                enabled={false}
                setEnabled={() => { }}
                disabled={true}
                infoButton={<WarningIcon />}
            />
        );

        return description
            ? <TooltipContainer text={toolTipText}>{card}</TooltipContainer>
            : card;
    }

    const onRestartNeeded = () => showToast("A restart is required for the change to take effect!");

    const depMap = useMemo(() => {
        const o = {} as Record<string, string[]>;
        for (const plugin in plugins) {
            const deps = plugins[plugin].dependencies;
            if (deps) {
                for (const dep of deps) {
                    o[dep] ??= [];
                    o[dep].push(plugin);
                }
            }
        }
        return o;
    }, []);

    const required = isPluginRequired(pluginName);
    const dependents = depMap[p.name]?.filter(d => isPluginEnabled(d));

    if (required) {
        const tooltipText = p.required || !dependents.length
            ? "This plugin is required for Testcord to function."
            : <PluginDependencyList deps={dependents} />;

        return (
            <Tooltip text={tooltipText} key={p.name}>
                {({ onMouseLeave, onMouseEnter }) =>
                    <PluginCard
                        key={p.name}
                        onMouseLeave={onMouseLeave}
                        onMouseEnter={onMouseEnter}
                        onRestartNeeded={onRestartNeeded}
                        plugin={p}
                        disabled
                    />
                }
            </Tooltip>
        );
    }

    return (
        <PluginCard
            key={p.name}
            onRestartNeeded={onRestartNeeded}
            plugin={p}
        />
    );
}

function resolvePluginName(search: string) {
    if (isPluginCardCacheEnabled()) {
        const cacheKey = search.toLowerCase();
        if (pluginResolveCache.has(cacheKey)) return pluginResolveCache.get(cacheKey) ?? undefined;

        const pluginName = resolvePluginNameCached(search);
        pluginResolveCache.set(cacheKey, pluginName ?? null);
        if (pluginResolveCache.size > PLUGIN_RESOLVE_CACHE_LIMIT) {
            const oldest = pluginResolveCache.keys().next().value;
            if (oldest !== undefined) pluginResolveCache.delete(oldest);
        }

        return pluginName;
    }

    return resolvePluginNameOriginal(search);
}

function resolvePluginNameOriginal(search: string) {
    const pluginNames = Object.keys(plugins);
    const words = search.trim().replace(/[.!?)]*$/, "").split(/\s+/);

    for (let i = words.length; i > 0; i--) {
        const query = words.slice(0, i).join(" ").toLowerCase();
        const normalizedQuery = query.replace(/\s+/g, "");

        const pluginName = pluginNames.find(name => name.toLowerCase() === normalizedQuery)
            ?? pluginNames.find(name => name.toLowerCase().startsWith(normalizedQuery))
            ?? pluginNames.find(name => name.match(/[A-Z]/g)?.join("").toLowerCase().includes(normalizedQuery))
            ?? pluginNames.find(name => name.toLowerCase().includes(normalizedQuery))
            ?? pluginNames.find(name => plugins[name].searchTerms?.some(t => t.toLowerCase().includes(query)))
            ?? pluginNames.find(name => plugins[name].description?.toLowerCase().includes(query));

        if (pluginName) return pluginName;
    }
}

function resolvePluginNameCached(search: string) {
    const pluginSearchData = getPluginSearchData();
    const words = search.trim().replace(/[.!?)]*$/, "").split(/\s+/);

    for (let i = words.length; i > 0; i--) {
        const query = words.slice(0, i).join(" ").toLowerCase();
        const normalizedQuery = query.replace(/\s+/g, "");

        const pluginName = pluginSearchData.find(p => p.lower === normalizedQuery)?.name
            ?? pluginSearchData.find(p => p.lower.startsWith(normalizedQuery))?.name
            ?? pluginSearchData.find(p => p.acronym.includes(normalizedQuery))?.name
            ?? pluginSearchData.find(p => p.lower.includes(normalizedQuery))?.name
            ?? pluginSearchData.find(p => p.searchTerms?.some(t => t.includes(query)))?.name
            ?? pluginSearchData.find(p => p.description?.includes(query))?.name;

        if (pluginName) return pluginName;
    }
}

function getPluginLink(pluginName: string) {
    return `https://github.com/TestcordDev/Testcord/tree/main/${PluginMeta[pluginName].folderName}`;
}

function getDisplayName(user: User) {
    return settings.store.useUsernameInProfileLinks ? user.username : user.globalName || user.username;
}

function getUserSubtitle(user: User) {
    return user.discriminator === "0" ? `@${user.username}` : user.tag;
}

function escapeLinkLabel(label: string) {
    return label.replaceAll("\\", "\\\\").replaceAll("]", "\\]").replaceAll("[", "\\[");
}

function getCachedUsers() {
    const users = (UserStore as typeof UserStore & { getUsers?: () => Record<string, User>; }).getUsers?.();

    return users ? Object.values(users) : [];
}

function resolveUser(search: string) {
    const query = search.trim().replace(/[.!?)]*$/, "");
    if (!query) return;

    const mentionId = USER_MENTION_PATTERN.exec(query)?.[1];
    const userId = mentionId ?? (USER_ID_PATTERN.test(query) ? query : undefined);

    if (userId) return UserStore.getUser(userId) ?? undefined;

    const cacheKey = query.toLowerCase();
    if (userResolveCache.has(cacheKey)) {
        const cachedId = userResolveCache.get(cacheKey);
        return cachedId ? UserStore.getUser(cachedId) ?? undefined : undefined;
    }

    const users = getCachedUsers();
    const user = users.find(user => user.username.toLowerCase() === cacheKey || user.globalName?.toLowerCase() === cacheKey || user.tag.toLowerCase() === cacheKey)
        ?? users.find(user => user.username.toLowerCase().startsWith(cacheKey) || user.globalName?.toLowerCase().startsWith(cacheKey) || user.tag.toLowerCase().startsWith(cacheKey))
        ?? users.find(user => user.username.toLowerCase().includes(cacheKey) || user.globalName?.toLowerCase().includes(cacheKey) || user.tag.toLowerCase().includes(cacheKey));

    if (!user) return;

    userResolveCache.set(cacheKey, user.id);
    if (userResolveCache.size > USER_RESOLVE_CACHE_LIMIT) {
        const oldest = userResolveCache.keys().next().value;
        if (oldest !== undefined) userResolveCache.delete(oldest);
    }

    return user;
}

function getUserLink(user: User) {
    return `https://discord.com/users/${user.id}`;
}

function colorToHex(color: number) {
    return `#${color.toString(16).padStart(6, "0")}`;
}

function getColorBrightness(color: number) {
    const red = (color >> 16) & 0xff;
    const green = (color >> 8) & 0xff;
    const blue = color & 0xff;

    return (red * 299 + green * 587 + blue * 114) / 1000;
}

function darkenColor(color: number) {
    const red = Math.round(((color >> 16) & 0xff) * 0.65);
    const green = Math.round(((color >> 8) & 0xff) * 0.65);
    const blue = Math.round((color & 0xff) * 0.65);

    return colorToHex((red << 16) | (green << 8) | blue);
}

function getProfileCardTheme(profile: ProfileTheme | undefined) {
    const colors = profile?.themeColors?.filter(color => Number.isFinite(color)) ?? [];

    if (colors.length >= 2) {
        const averageBrightness = colors.reduce((total, color) => total + getColorBrightness(color), 0) / colors.length;
        const darkText = averageBrightness >= 160;

        return {
            background: `linear-gradient(135deg, ${colorToHex(colors[0])}, ${colorToHex(colors[1])})`,
            border: darkenColor(colors[0]),
            text: darkText ? "#111214" : "#fff",
            muted: darkText ? "rgba(17, 18, 20, 0.72)" : "rgba(255, 255, 255, 0.78)",
            shadow: darkText ? "none" : "0 1px 2px rgb(0 0 0 / 45%)",
        };
    }

    return {
        background: "var(--background-secondary)",
        border: "var(--background-modifier-accent)",
        text: "var(--text-default)",
        muted: "var(--text-muted)",
        shadow: "none",
    };
}

function ChatProfileCard({ user }: { user: User; }) {
    const profile = useStateFromStores([UserProfileStore], () => UserProfileStore.getUserProfile(user.id) as ProfileTheme | undefined, [user.id]);
    const displayName = user.globalName || user.username;
    const cardTheme = getProfileCardTheme(profile);

    useEffect(() => {
        if (!profile && !user.bot) void fetchUserProfile(user.id).catch(() => { });
    }, [profile, user.bot, user.id]);

    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 12,
            borderRadius: 8,
            background: cardTheme.background,
            border: `1px solid ${cardTheme.border}`,
            minWidth: 280,
            maxWidth: 420,
            boxShadow: "0 2px 8px rgb(0 0 0 / 18%)",
        }}>
            <Avatar
                src={user.getAvatarURL(null, 80, true)}
                size="SIZE_56"
            />
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, color: cardTheme.text, textShadow: cardTheme.shadow, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {displayName}
                </div>
                <div style={{ color: cardTheme.muted, textShadow: cardTheme.shadow, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {getUserSubtitle(user)}
                </div>
                <div style={{ color: cardTheme.muted, textShadow: cardTheme.shadow, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.id}
                </div>
            </div>
            <Button
                size={Button.Sizes.SMALL}
                onClick={() => openUserProfile(user.id)}
            >
                Profile
            </Button>
        </div>
    );
}

function replacePluginAliases(content: string) {
    return content.replace(PLUGIN_PATTERN, match => {
        const [, query] = PLUGIN_MATCH_PATTERN.exec(match) ?? [];
        const pluginName = query ? resolvePluginName(query) : undefined;

        if (!pluginName) return match;

        return `[${pluginName}](<${getPluginLink(pluginName)}>)${query?.match(/[.!?)]*$/)?.[0] ?? ""}`;
    });
}

function replaceUserAliases(content: string) {
    if (settings.store.disableProfilePopoutEmbeds) return content;

    return content.replace(USER_PATTERN, match => {
        const [, query] = USER_MATCH_PATTERN.exec(match) ?? [];
        const user = query ? resolveUser(query) : undefined;

        if (!user) return match;

        return `[${escapeLinkLabel(getDisplayName(user))}](<${getUserLink(user)}>)${query?.match(/[.!?)]*$/)?.[0] ?? ""}`;
    });
}

function replaceAliases(content: string) {
    return replaceUserAliases(replacePluginAliases(content));
}

const PluginCards = ErrorBoundary.wrap(function PluginCards({ message }: { message: Message; }) {
    if (isPerformanceEnabled() && settings.store.performanceDisablePluginCards) return null;
    if (!PLUGIN_CARD_MARKER_PATTERN.test(message.content)) return null;

    const seenPlugins = new Set<string>();
    const pluginCards: JSX.Element[] = [];

    PLUGIN_PATTERN.lastIndex = 0;

    let match;
    while ((match = PLUGIN_PATTERN.exec(message.content)) !== null) {
        const pluginNameFromMessage = match[1]?.trim();
        const actualPluginName = pluginNameFromMessage ? resolvePluginName(pluginNameFromMessage) : undefined;
        const pluginName = actualPluginName || pluginNameFromMessage;

        if (!pluginName || seenPlugins.has(pluginName)) continue;
        seenPlugins.add(pluginName);

        pluginCards.push(
            <ChatPluginCard
                key={pluginName}
                pluginName={pluginName}
            />
        );
    }

    PLUGIN_LINK_PATTERN.lastIndex = 0;

    while ((match = PLUGIN_LINK_PATTERN.exec(message.content)) !== null) {
        const pluginNameFromMessage = match[1]?.trim();
        const actualPluginName = pluginNameFromMessage ? resolvePluginName(pluginNameFromMessage) : undefined;
        const pluginName = actualPluginName || pluginNameFromMessage;

        if (!pluginName || seenPlugins.has(pluginName)) continue;
        seenPlugins.add(pluginName);

        pluginCards.push(
            <ChatPluginCard
                key={pluginName}
                pluginName={pluginName}
            />
        );
    }

    if (pluginCards.length === 0) return null;

    return (
        <div className="vc-plugins-management-cards vc-plugins-grid" style={{ marginTop: "0px" }}>
            {pluginCards}
        </div>
    );
}, { noop: true });

const ProfileCards = ErrorBoundary.wrap(function ProfileCards({ message }: { message: Message; }) {
    if (settings.store.disableProfilePopoutEmbeds) return null;
    if (!USER_CARD_MARKER_PATTERN.test(message.content)) return null;

    const seenUsers = new Set<string>();
    const profileCards: JSX.Element[] = [];

    USER_PATTERN.lastIndex = 0;

    let match;
    while ((match = USER_PATTERN.exec(message.content)) !== null) {
        const user = match[1] ? resolveUser(match[1].trim()) : undefined;

        if (!user || seenUsers.has(user.id)) continue;
        seenUsers.add(user.id);

        profileCards.push(
            <ChatProfileCard
                key={user.id}
                user={user}
            />
        );
    }

    USER_LINK_PATTERN.lastIndex = 0;

    while ((match = USER_LINK_PATTERN.exec(message.content)) !== null) {
        const user = match[1] ? UserStore.getUser(match[1]) : undefined;

        if (!user || seenUsers.has(user.id)) continue;
        seenUsers.add(user.id);

        profileCards.push(
            <ChatProfileCard
                key={user.id}
                user={user}
            />
        );
    }

    if (profileCards.length === 0) return null;

    return (
        <div style={{ display: "grid", gap: 8, marginTop: 0 }}>
            {profileCards}
        </div>
    );
}, { noop: true });

let liveFixInterval: ReturnType<typeof setInterval> | null = null;

interface LiveFixRequest {
    id: string;
    action: "search" | "readModule" | "eval" | "testPattern" | "listPending" | "patchHealth"
    | "dispatchStats" | "slowEvents" | "pluginTimings" | "patchTimings" | "memory" | "profile" | "reset"
    | "consoleDump" | "loaf" | "hoverProbe";
    query?: string;
    moduleId?: number;
    code?: string;
    pattern?: string;
    flags?: string;
    limit?: number;
    pluginLimit?: number;
}

// Circular console buffer — last 500 entries, each with level, text, and timestamp
const CONSOLE_BUF_MAX = 500;
const consoleBuf: Array<{ level: string; msg: string; time: number; }> = [];
let origConsole: Record<string, (...args: any[]) => void> = {};
let consoleOverridesInstalled = false;

interface LoafScript {
    dur: number;
    invoker: string;
    src: string;
    fn: string;
}

interface LoafFrame {
    dur: number;
    blocking: number;
    scripts: LoafScript[];
}

const LOAF_BUF_MAX = 40;
const loafBuf: LoafFrame[] = [];
let loafObserverInstalled = false;

function installLoafRecorder() {
    if (loafObserverInstalled || typeof PerformanceObserver === "undefined") return;
    interface LoafEntry extends PerformanceEntry {
        scripts?: Array<{
            duration: number;
            invokerType?: string;
            invoker?: string;
            sourceURL?: string;
            sourceFunctionName?: string;
        }>;
        blockingDuration?: number;
    }
    try {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries() as LoafEntry[]) {
                const scripts = (entry.scripts ?? [])
                    .map(s => ({
                        dur: Math.round(s.duration),
                        invoker: s.invokerType && s.invoker ? `${s.invokerType}:${String(s.invoker).slice(0, 80)}` : "",
                        src: (s.sourceURL || "").split("/").pop() + ":" + (s.sourceFunctionName || ""),
                        fn: ""
                    }))
                    .sort((a, b) => b.dur - a.dur)
                    .slice(0, 6);
                loafBuf.push({
                    dur: Math.round(entry.duration),
                    blocking: Math.round(entry.blockingDuration ?? 0),
                    scripts
                });
                if (loafBuf.length > LOAF_BUF_MAX) loafBuf.shift();
            }
        });
        observer.observe({ type: "long-animation-frame", durationThreshold: 50 } as PerformanceObserverInit);
        loafObserverInstalled = true;
    } catch {
        // Long Animation Frames API unavailable on this Chromium
    }
}

function installConsoleCapture() {
    if (consoleOverridesInstalled) return;
    consoleOverridesInstalled = true;

    const levels = ["log", "warn", "error", "info", "debug"];
    for (const level of levels) {
        origConsole[level] = (console as any)[level].bind(console);
        (console as any)[level] = function (...args: any[]) {
            const msg = args.map(a => typeof a === "object" ? safeStringify(a) : String(a)).join(" ");
            consoleBuf.push({ level, msg, time: Date.now() });
            if (consoleBuf.length > CONSOLE_BUF_MAX) consoleBuf.shift();
            return origConsole[level](...args);
        };
    }
}

function uninstallConsoleCapture() {
    if (!consoleOverridesInstalled) return;
    consoleOverridesInstalled = false;
    for (const level of Object.keys(origConsole)) {
        (console as any)[level] = origConsole[level];
    }
    origConsole = {};
}

function safeStringify(obj: any): string {
    try { return JSON.stringify(obj); } catch { return String(obj); }
}

function handleLiveFixRequest(req: LiveFixRequest): any {
    const { id, action } = req;

    try {
        switch (action) {
            case "search": {
                if (!req.query) return { id, error: "Missing query" };
                const factories = wreq?.m;
                if (!factories) return { id, error: "Webpack factories not available" };

                const results: Array<{ id: number; snippet: string; }> = [];
                const query = req.query.toLowerCase();

                for (const moduleId in factories) {
                    const src = String(factories[moduleId]);
                    const at = src.toLowerCase().indexOf(query);
                    if (at === -1) continue;

                    results.push({ id: Number(moduleId), snippet: src.slice(Math.max(0, at - 100), at + 200) });
                    if (results.length >= 20) break;
                }
                return { id, results, truncated: results.length >= 20 };
            }

            case "readModule": {
                if (req.moduleId === undefined) return { id, error: "Missing moduleId" };
                const factory = wreq?.m?.[req.moduleId];
                if (!factory) return { id, error: `Module ${req.moduleId} not found` };
                return { id, source: String(factory) };
            }

            case "eval": {
                if (!req.code) return { id, error: "Missing code" };
                const result = (0, eval)(req.code);
                return { id, result: typeof result === "object" ? JSON.stringify(result, null, 2) : String(result) };
            }

            case "testPattern": {
                if (!req.pattern || !req.code) return { id, error: "Missing pattern or code" };
                const flags = req.flags ?? "";
                const regex = new RegExp(req.pattern, flags);
                const match = regex.exec(req.code);
                if (match) {
                    return {
                        id,
                        matched: true,
                        match: match[0],
                        groups: match.slice(1),
                        index: match.index,
                        input: match.input?.slice(Math.max(0, match.index - 50), match.index + match[0].length + 50)
                    };
                }
                return { id, matched: false };
            }

            case "listPending": {
                const pending = allPatches.map(patch => ({
                    plugin: patch.plugin,
                    find: String(patch.find),
                    matches: (patch.replacement as Array<{ match: string | RegExp; }>).map(r => String(r.match))
                }));
                return { id, pending };
            }

            case "patchHealth": {
                const health = [...PluginHealth.getAll()].map(([plugin, entry]) => ({
                    plugin,
                    patchFailures: entry.patchFailures,
                    runtimeErrors: entry.runtimeErrors
                }));
                return { id, health };
            }

            case "dispatchStats": {
                if (!origDispatch) return { id, error: "Dispatch profiling is off. Send {action:'profile'} first, then interact with the client." };
                const stats = [...dispatchStats.entries()]
                    .map(([type, s]) => ({
                        type,
                        count: s.count,
                        avgMs: +(s.totalMs / s.count).toFixed(2),
                        maxMs: +s.maxMs.toFixed(2),
                        totalMs: +s.totalMs.toFixed(2),
                        plugins: getPluginsForEvent(type)
                    }))
                    .sort((a, b) => b.totalMs - a.totalMs)
                    .slice(0, req.limit ?? 50);
                const pluginStats = [...pluginDispatchStats.entries()]
                    .map(([plugin, s]) => ({
                        plugin,
                        count: s.count,
                        avgMs: +(s.totalMs / s.count).toFixed(2),
                        maxMs: +s.maxMs.toFixed(2),
                        totalMs: +s.totalMs.toFixed(2),
                    }))
                    .sort((a, b) => b.totalMs - a.totalMs)
                    .slice(0, req.pluginLimit ?? 50);
                return { id, profiling: true, stats, pluginStats };
            }

            case "slowEvents": {
                if (!origDispatch) return { id, error: "Dispatch profiling is off. Send {action:'profile'} first." };
                const events = recentSlowEvents.slice(-(req.limit ?? 50)).reverse();
                const pluginStats = [...pluginDispatchStats.entries()]
                    .map(([plugin, s]) => ({
                        plugin,
                        count: s.count,
                        avgMs: +(s.totalMs / s.count).toFixed(2),
                        maxMs: +s.maxMs.toFixed(2),
                        totalMs: +s.totalMs.toFixed(2),
                    }))
                    .sort((a, b) => b.totalMs - a.totalMs)
                    .slice(0, req.pluginLimit ?? 50);
                return { id, profiling: true, slowThresholdMs: SLOW_DISPATCH_MS, events, pluginStats };
            }

            case "pluginTimings": {
                const timings = [...pluginStartTimings]
                    .map(([plugin, t]) => ({ plugin, durationMs: +t.duration.toFixed(2), success: t.success }))
                    .sort((a, b) => b.durationMs - a.durationMs)
                    .slice(0, req.limit ?? 100);
                const totalMs = +timings.reduce((sum, t) => sum + t.durationMs, 0).toFixed(2);
                return { id, timings, totalMs };
            }

            case "patchTimings": {
                const timings = patchTimings
                    .map(([plugin, moduleId, match, duration]) => ({
                        plugin,
                        moduleId: String(moduleId),
                        match: String(match).slice(0, 120),
                        durationMs: +duration.toFixed(2)
                    }))
                    .sort((a, b) => b.durationMs - a.durationMs)
                    .slice(0, req.limit ?? 50);
                return { id, timings };
            }

            case "memory": {
                const mem = (window as any).performance?.memory;
                if (!mem) return { id, memory: null, note: "performance.memory unavailable" };
                return {
                    id,
                    memory: {
                        usedMB: round2(mem.usedJSHeapSize / MB),
                        totalMB: round2(mem.totalJSHeapSize / MB),
                        limitMB: round2(mem.jsHeapSizeLimit / MB)
                    }
                };
            }

            case "profile": {
                if (origDispatch) return { id, profiling: true, note: "Already profiling." };
                installDebugInstrumentation();
                return { id, profiling: true, note: "Dispatch profiling started. Interact with the client, then query dispatchStats/slowEvents." };
            }

            case "consoleDump": {
                const count = req.limit ?? consoleBuf.length;
                return { id, entries: consoleBuf.slice(-count) };
            }

            case "loaf": {
                const frames = loafBuf.slice();
                const totalMs = frames.reduce((a, f) => a + f.dur, 0);
                const byInvoker: Record<string, number> = {};
                for (const f of frames) {
                    for (const s of f.scripts) {
                        if (!s.invoker) continue;
                        byInvoker[s.invoker] = (byInvoker[s.invoker] ?? 0) + s.dur;
                    }
                }
                const top = Object.entries(byInvoker)
                    .map(([invoker, ms]) => ({ invoker, ms }))
                    .sort((a, b) => b.ms - a.ms)
                    .slice(0, 15);
                return { id, frameCount: frames.length, totalMs, topInvokers: top, frames: frames.slice(-10) };
            }

            case "hoverProbe": {
                const buttons = Array.from(
                    document.querySelectorAll<HTMLElement>("[class*=listItem] [class*=avatar], [class*=sidebar] button")
                ).slice(0, 14);
                if (buttons.length < 4) return { id, error: "Not enough sidebar buttons visible for probe." };
                const run = () => {
                    const t0 = performance.now();
                    for (const b of buttons) {
                        b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
                        b.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
                    }
                    return Math.round((performance.now() - t0) * 10) / 10;
                };
                run();
                const runs: number[] = [];
                for (let i = 0; i < 7; i++) runs.push(run());
                runs.sort((a, b) => a - b);
                return {
                    id,
                    medianMs: runs[3],
                    runs,
                    healthyBelowMs: 20,
                    note: "Median hover cost over 14 buttons. High values mean style recalc or handler lag; pair with loaf to attribute."
                };
            }

            case "reset": {
                dispatchStats.clear();
                recentSlowEvents.length = 0;
                channelSwitchStart = 0;
                return { id, ok: true };
            }

            default:
                return { id, error: `Unknown action: ${action}` };
        }
    } catch (e) {
        return { id, error: String(e) };
    }
}

async function startLiveFixServer() {
    if (liveFixInterval) return;

    try {
        const token = await NativeHelper.startLiveFixServer();
        installLoafRecorder();

        liveFixInterval = setInterval(async () => {
            let cmd: string | null = null;
            let reqId = "unknown";
            try {
                cmd = await NativeHelper.getCommand();
                if (!cmd) return;

                const req: LiveFixRequest = JSON.parse(cmd);
                reqId = req.id;
                const response = handleLiveFixRequest(req);
                await NativeHelper.writeResponse(JSON.stringify(response));
            } catch (e) {
                logger.error("LiveFix loop failed:", e);
                try {
                    await NativeHelper.writeResponse(JSON.stringify({ id: reqId, error: String(e) }));
                } catch { /* ignore */ }
            }
        }, 500);

        const requireToken = settings.store.liveFixRequireToken !== false;
        logger.info(requireToken
            ? `LiveFix integration started — HTTP server on port 18963, auth token: ${token}`
            : "LiveFix integration started — HTTP server on port 18963, auth token disabled");
        showToast(requireToken
            ? `LiveFix started on port 18963 (token ${token.slice(0, 8)}…, full token in console)`
            : "LiveFix started on port 18963 — auth token disabled", Toasts.Type.SUCCESS);
    } catch (e) {
        logger.error("Failed to start LiveFix server:", e);
        showToast(`LiveFix failed: ${e}`, Toasts.Type.FAILURE);
    }
}

async function stopLiveFixServer() {
    if (liveFixInterval) {
        clearInterval(liveFixInterval);
        liveFixInterval = null;
    }

    try {
        await NativeHelper.stopLiveFixServer();
        logger.info("LiveFix integration stopped");
    } catch {
        // ignore
    }
}

let hotkeyHandler: ((e: KeyboardEvent) => void) | null = null;

export default definePlugin({
    name: "TestcordHelper",
    description: "Helper plugin for Testcord features, including custom badge management, debug reporting, and plugin info cards.",
    tags: ["Utility", "Developers"],
    authors: [{ name: "x2b", id: 996137713432530976n }],
    required: true,
    settings,
    patches: [
        {
            find: "AUDIO_RESET:function(){",
            predicate: () => Settings.plugins.TestcordOptimizer?.preventAudioResetReload !== false,
            noWarn: true,
            replacement: {
                match: /(?<=AUDIO_RESET:function\(\).{0,300}?)location\.reload\(\)/,
                replace: "$self.onAudioReset()"
            }
        },
    ],
    dependencies: ["MessageAccessoriesAPI", "MessageEventsAPI"],

    commands: [{
        name: "tdebug",
        description: "Dump complete performance and patch diagnostics to the browser console.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_, ctx) {
            dumpFullReport();
            const dSize = dispatchStats.size;
            const pSize = pluginDispatchStats.size;
            const toastMsg = `Debug report → console. Dispatch events tracked: ${dSize} types, per-plugin: ${pSize} plugins${dSize === 0 ? " ⚠️ Enable Debug Mode in settings first!" : ""}`;
            showToast(toastMsg, Toasts.Type.SUCCESS);
            sendBotMessage(ctx.channel.id, { content: `Debug report dumped to console (F12). ${dSize} dispatch types, ${pSize} plugins tracked.` });
        }
    }],

    onBeforeMessageSend(_, msg) {
        msg.content = replaceAliases(msg.content);
    },

    onBeforeMessageEdit(_, __, msg) {
        msg.content = replaceAliases(msg.content);
    },

    onAudioReset() {
        logger.warn("Audio engine reset, skipped Discord's auto reload");
        showToast("Audio engine reset, skipped reload", Toasts.Type.MESSAGE);
    },

    renderMessageAccessory(props) {
        const { content } = props.message;
        if (content.length < 12) return null;
        const showPluginCards = !(isPerformanceEnabled() && settings.store.performanceDisablePluginCards) && PLUGIN_CARD_MARKER_PATTERN.test(content);
        const showProfileCards = !settings.store.disableProfilePopoutEmbeds && USER_CARD_MARKER_PATTERN.test(content);

        if (!showPluginCards && !showProfileCards) return null;

        return (
            <>
                {showPluginCards ? <PluginCards message={props.message} /> : null}
                {showProfileCards ? <ProfileCards message={props.message} /> : null}
            </>
        );
    },

    async syncPronounsBadge() {
        const selfId = UserStore.getCurrentUser()?.id;
        if (!selfId) return;

        // The profile store is empty right after boot, so fetch it before
        // deciding whether to write: writing blind would re-apply the marker
        // (and refetch the profile) on every startup even when it already
        // exists server-side.
        const profile = UserProfileStore.getUserProfile(selfId)
            ?? await fetchUserProfile(selfId, {}, false).catch(() => undefined);
        if (!profile) return;

        const current: string | undefined = profile.pronouns;
        const hasMarker = current?.includes(ZWSP) ?? false;
        const wantMarker = settings.store.pronounsBadge;

        if (hasMarker === wantMarker) return;

        const next = wantMarker
            ? `${current ?? ""}${ZWSP}`
            : current?.replaceAll(ZWSP, "");

        RestAPI.patch({
            url: Constants.Endpoints.USER_PROFILE("@me"),
            body: { pronouns: next }
        }).then(() => fetchUserProfile(selfId, {}, false)).catch(() => undefined);
    },

    start() {
        if (settings.store.preventCrashes) installCrashGuards();
        if (settings.store.liveFix) {
            installConsoleCapture();
            startLiveFixServer();
        }
        if (settings.store.debugMode) settings.store.debugMode = false;
        this.syncPronounsBadge();
        if (settings.store.orchestrator || settings.store.messageCoalesce) {
            const p = Plugins.OrchestratorAPI;
            if (p && !p.started) {
                Settings.plugins.OrchestratorAPI.enabled = true;
                if (settings.store.messageCoalesce) {
                    Settings.plugins.OrchestratorAPI.messageCoalesce = true;
                }
                startPlugin(p);
            }
        }
        if (settings.store.bigChatMode) {
            const p = Plugins.TestcordOptimizer;
            if (p && !p.started) {
                Settings.plugins.TestcordOptimizer.enabled = true;
                Settings.plugins.TestcordOptimizer.freezeMemberList = true;
                Settings.plugins.TestcordOptimizer.forcePassiveListeners = true;
                Settings.plugins.TestcordOptimizer.disableUnreadBadges = true;
                Settings.plugins.TestcordOptimizer.optimizeChatInput = true;
                Settings.plugins.TestcordOptimizer.optimizeLargeAttachments = true;
                Settings.plugins.TestcordOptimizer.containAttachmentImages = true;
                Settings.plugins.TestcordOptimizer.disableSpringAnimations = true;
                startPlugin(p);
            }
        }
        hotkeyHandler = (e: KeyboardEvent) => {
            // Capture-phase listener on document: bail before touching e.key so
            // ordinary typing pays two boolean reads, not string work.
            if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "h") return;
            e.preventDefault();
            e.stopPropagation();
            showToast("Sending debug report to channel...", Toasts.Type.MESSAGE);
            sendDebugReport().catch(err => {
                logger.error("Failed to send debug report:", err);
                showToast(`Failed to send debug report: ${err.message}`, Toasts.Type.FAILURE);
            });
        };
        document.addEventListener("keydown", hotkeyHandler, true);

        this.pronounsBadgeListener = () => this.syncPronounsBadge();
        SettingsStore.addChangeListener("plugins.TestcordHelper.pronounsBadge", this.pronounsBadgeListener);
    },

    stop() {
        uninstallCrashGuards();
        uninstallDebugInstrumentation();
        uninstallConsoleCapture();
        stopLiveFixServer();
        if (hotkeyHandler) {
            document.removeEventListener("keydown", hotkeyHandler, true);
            hotkeyHandler = null;
        }
        if (this.pronounsBadgeListener) {
            SettingsStore.removeChangeListener("plugins.TestcordHelper.pronounsBadge", this.pronounsBadgeListener);
            this.pronounsBadgeListener = null;
        }
    }
});
