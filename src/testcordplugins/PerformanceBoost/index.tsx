/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Note: Auto-translated

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { HeaderBarButton } from "@api/HeaderBar";
import { popNotice, showNotice } from "@api/Notices";
import { showNotification } from "@api/Notifications";
import { RuntimeInterposition, RuntimeInterpositionPriority } from "@api/RuntimeInterposition";
import { getUserSettingLazy } from "@api/UserSettings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import { t } from "@utils/testcordI18n";
import definePlugin, { PluginNative } from "@utils/types";
import { findAll, findStore } from "@webpack";
import { React, useEffect } from "@webpack/common";

import { settings } from "./settings";

const logger = new Logger("PerformanceBoost");

const Native = IS_DISCORD_DESKTOP
    ? (VencordNative.pluginHelpers.PerformanceBoost as PluginNative<typeof import("./native")>)
    : null;

let active = false;
let ready = false; // Becomes true on CONNECTION_OPEN (or fallback timeout) — ignores startup game reports
let readyFallbackTimer: ReturnType<typeof setTimeout> | null = null; // Fallback timer if CONNECTION_OPEN is not received
let manualOff = false; // User manually disabled it ⇒ overrides auto-detection until manually re-enabled
let notifiedManualOff = false; // User notified once that auto-enable is suspended due to manual toggle
const HW_ACK_KEY = "PerformanceBoost_hwRestartAcknowledged";
const MANUAL_OFF_KEY = "PerformanceBoost_manualOff"; // Persists manual off flag across restarts
const buttonUpdaters = new Set<() => void>();
const refreshButtons = () => buttonUpdaters.forEach(u => u());

// Enables live game detection (idempotent): called from CONNECTION_OPEN or fallback timer.
function markReady() {
    if (ready) return;
    ready = true;
    if (readyFallbackTimer !== null) {
        clearTimeout(readyFallbackTimer);
        readyFallbackTimer = null;
    }
}

// DataStore keys for storing original user setting values
const ORIG_COMPACT_KEY = "PerformanceBoost_originalCompact";
const ORIG_GIF_KEY = "PerformanceBoost_originalGif";

const NOTICE_COLORS = { success: "#3ba55c", warning: "#faa81a", error: "#ed4245", info: "#5865f2" } as const;
function notice(message: string, type: keyof typeof NOTICE_COLORS) {
    showNotification({ title: "PerformanceBoost", body: message, color: NOTICE_COLORS[type], noPersist: true });
}

function applyCss() {
    const root = document.documentElement;
    root.classList.toggle("vc-perfboost-no-anim", settings.store.disableAnimations);
    root.classList.toggle("vc-perfboost-hide-activities", settings.store.hideActivities);
    root.classList.add("vc-perfboost-active"); // Light rendering optimizations while active
}
function removeCss() {
    document.documentElement.classList.remove("vc-perfboost-no-anim", "vc-perfboost-hide-activities", "vc-perfboost-active");
}

// ── Runtime Optimizations (One-shot per activation, no loops/timers) ──
const PASSIVE_EVENTS = ["wheel", "mousewheel", "touchstart", "touchmove", "touchend"];
let disposePassiveListeners: (() => void) | null = null;
let springs: { Globals?: { assign?: (o: Record<string, unknown>) => void; }; }[] = [];

// Clear cache of heavy stores to free memory (optional — re-fetches lazily).
// We only call clearCache (rebuildable cache) and do not touch clear to avoid wiping real user data (e.g. drafts).
const CACHE_STORE_NAMES = [
    "MessageStore", "EmojiStore", "StickersStore", "UserProfileStore", "InviteStore",
    "ApplicationStore", "ExperimentStore", "QuestStore", "SoundboardStore", "SpellCheckStore",
    "RunningGameStore", "ApplicationStreamingStore", "ApplicationStreamPreviewStore",
    "UserAffinitiesStore", "ApplicationCommandIndexStore", "ReadStateStore", "TypingStore"
];

function clearStoreCaches() {
    let n = 0;
    for (const name of CACHE_STORE_NAMES) {
        try {
            const store = findStore(name) as { clearCache?: () => void; } | undefined;
            if (typeof store?.clearCache === "function") { store.clearCache(); n++; }
        } catch (e) { logger.warn(`clearCache ${name} failed`, e); }
    }
    if (typeof (window as any).gc === "function") { try { (window as any).gc(); } catch { /* gc unavailable */ } }
    logger.info(`Cleared ${n} store caches`);
}

function applyRuntimeOpts() {
    // Skip Spring animations (revertible)
    if (settings.store.skipSpringAnimations && springs.length === 0) {
        springs = findAll(m => typeof (m as any)?.Globals === "object" && typeof (m as any)?.Springs === "object") as typeof springs;
        for (const s of springs) s.Globals?.assign?.({ skipAnimation: true });
    }
    // Make scroll/touch listeners passive — smoother scrolling (revertible)
    if (settings.store.passiveListeners && !disposePassiveListeners) {
        disposePassiveListeners = RuntimeInterposition.register({
            owner: "PerformanceBoost",
            hook: "addEventListener",
            priority: RuntimeInterpositionPriority.BEHAVIOR,
            wrap: next => function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
                if (PASSIVE_EVENTS.includes(type) && listener != null) {
                    if (typeof options === "boolean" || options === undefined) options = { capture: !!options, passive: true };
                    else if (options.passive === undefined) options = { ...options, passive: true };
                }
                return next.call(this, type, listener, options);
            }
        });
    }
    // Lazy images + async decoding (one-shot). Skip chat images:
    // loading=lazy/decoding=async on chat images breaks auto-scroll to bottom.
    if (settings.store.lazyImages) {
        const isChatImage = (img: HTMLImageElement) =>
            img.closest('[class*="scrollerInner_"], [class*="messageListItem_"]') !== null;
        document.querySelectorAll<HTMLImageElement>("img").forEach(img => {
            if (isChatImage(img)) return;
            if (!img.loading) img.loading = "lazy";
            if (!img.decoding) img.decoding = "async";
        });
    }
    if (settings.store.clearStoreCaches) clearStoreCaches();
}

// Revert runtime opts — prevents addEventListener patch leaks.
function removeRuntimeOpts() {
    for (const s of springs) s.Globals?.assign?.({ skipAnimation: false });
    springs = [];
    disposePassiveListeners?.();
    disposePassiveListeners = null;
}

// ── Apply & Restore User Settings (Compact + GIF) ──
async function applyUserSettings() {
    try {
        const compactSetting = getUserSettingLazy("textAndImages", "messageDisplayCompact");
        if (compactSetting?.updateSetting && typeof compactSetting.getSetting === "function") {
            const original = compactSetting.getSetting();
            if (original !== undefined && (await DataStore.get(ORIG_COMPACT_KEY)) === undefined) {
                await DataStore.set(ORIG_COMPACT_KEY, original);
            }
            if (settings.store.compactMode) compactSetting.updateSetting(true);
        }
    } catch (e) { logger.warn("Failed to set compact mode", e); }

    try {
        const gifSetting = getUserSettingLazy("textAndImages", "gifAutoPlay");
        if (gifSetting?.updateSetting && typeof gifSetting.getSetting === "function") {
            const original = gifSetting.getSetting();
            if (original !== undefined && (await DataStore.get(ORIG_GIF_KEY)) === undefined) {
                await DataStore.set(ORIG_GIF_KEY, original);
            }
            if (settings.store.disableGifAutoplay) gifSetting.updateSetting(false);
        }
    } catch (e) { logger.warn("Failed to set GIF autoplay", e); }
}

async function revertUserSettings() {
    try {
        const originalCompact = await DataStore.get<boolean>(ORIG_COMPACT_KEY);
        if (originalCompact !== undefined) {
            const compactSetting = getUserSettingLazy("textAndImages", "messageDisplayCompact");
            if (compactSetting?.updateSetting) await compactSetting.updateSetting(originalCompact);
            await DataStore.del(ORIG_COMPACT_KEY);
        }
    } catch (e) { logger.warn("Failed to revert compact mode", e); }

    try {
        const originalGif = await DataStore.get<boolean>(ORIG_GIF_KEY);
        if (originalGif !== undefined) {
            const gifSetting = getUserSettingLazy("textAndImages", "gifAutoPlay");
            if (gifSetting?.updateSetting) await gifSetting.updateSetting(originalGif);
            await DataStore.del(ORIG_GIF_KEY);
        }
    } catch (e) { logger.warn("Failed to revert GIF autoplay", e); }
}

// ── Process Priority & Cache ──
async function setPriority(level: "belowNormal" | "normal") {
    if (!Native) { notice(t("تغيير الأولوية يتطلب نسخة سطح المكتب.", "Changing priority requires the desktop app."), "warning"); return; }
    try {
        const res = await Native.setProcessPriority(level);
        if (res.ok && level === "belowNormal") notice(t(`تم خفض أولوية ${res.changed} عملية`, `Lowered priority for ${res.changed} process(es)`), "success");
        else if (!res.ok) notice(t("تغيير الأولوية غير متاح: " + res.reason, "Priority change unavailable: " + res.reason), "warning");
    } catch (e) { logger.error("setPriority failed", e); }
}

async function cleanCache() {
    if (!Native) { notice(t("تنظيف الكاش يتطلب نسخة سطح المكتب.", "Cache cleaning requires the desktop app."), "warning"); return; }
    try {
        const res = await Native.cleanCache();
        notice(res.ok ? t(`تم تنظيف الكاش (${res.cleared}).`, `Cache cleaned (${res.cleared}).`) : t("تعذّر تنظيف الكاش", "Could not clean cache"), res.ok ? "success" : "warning");
    } catch (e) { logger.error("cleanCache failed", e); }
}

// ── Restart for Hardware Acceleration ──
let restarting = false;
async function doRestart() {
    if (restarting) return;
    restarting = true;
    notice(t("جاري إعادة التشغيل...", "Restarting..."), "success");
    popNotice();
    try {
        if (!Native) { location.reload(); return; }
        await Native.relaunchApp();
    } catch (e) {
        logger.error("restart failed", e);
        restarting = false;
        location.reload();
    }
}

async function promptHardwareRestart() {
    if (await DataStore.get(HW_ACK_KEY)) return;
    await DataStore.set(HW_ACK_KEY, true);
    showNotice(
        t("لتطبيق تعطيل تسريع العتاد: عطّله يدوياً من إعدادات Discord ← متقدّم، ثم أعد التشغيل.", "To disable hardware acceleration: turn it off manually in Discord Settings → Advanced, then restart."),
        t("أعد التشغيل الآن", "Restart now"),
        doRestart
    );
}

// ── Optional Load Monitor (autoHighLoad — disabled by default) ──
// Samples total CPU usage every 30s via getAppMetrics (no external processes). 2 consecutive samples
// over threshold -> auto-enable; 2 consecutive samples under 60% of threshold -> auto-disable (only if enabled by load monitor).
let loadTimer: ReturnType<typeof setInterval> | null = null;
let highStreak = 0, lowStreak = 0;
let autoByLoad = false; // True if last activation was triggered by high load

async function sampleLoad() {
    if (!Native || !settings.store.autoHighLoad) return;
    try {
        const cpu = await Native.getTotalCpu();
        const threshold = settings.store.cpuThreshold ?? 160;
        if (cpu >= threshold) { highStreak++; lowStreak = 0; }
        else if (cpu < threshold * 0.6) { lowStreak++; highStreak = 0; }
        else { highStreak = 0; lowStreak = 0; }

        if (!active && !manualOff && highStreak >= 2) {
            highStreak = 0;
            autoByLoad = true;
            await applyMode();
            notice(t(`استهلاك المعالج مرتفع (${Math.round(cpu)}%) — فُعّل وضع الأداء تلقائياً.`, `High CPU usage (${Math.round(cpu)}%) — performance mode enabled automatically.`), "info");
        } else if (active && autoByLoad && lowStreak >= 2) {
            lowStreak = 0;
            autoByLoad = false;
            await revertMode();
        }
    } catch (e) { logger.warn("load sample failed", e); }
}

// Timer runs while plugin is active on desktop; sampleLoad exits immediately if option disabled.
function startLoadMonitor() {
    if (loadTimer !== null || !Native) return;
    highStreak = 0; lowStreak = 0;
    loadTimer = setInterval(sampleLoad, 30_000);
}

function stopLoadMonitor() {
    if (loadTimer !== null) { clearInterval(loadTimer); loadTimer = null; }
    highStreak = 0; lowStreak = 0;
    autoByLoad = false;
}

// ── Apply / Revert Performance Mode ──
async function applyMode() {
    if (active) return;
    active = true;
    notifiedManualOff = false; // Reset notification flag
    applyCss();
    applyRuntimeOpts();
    await applyUserSettings();
    if (settings.store.changeProcessPriority) await setPriority("belowNormal");
    if (settings.store.cleanCacheOnStart) await cleanCache();
    if (settings.store.reduceHardwareAcceleration) await promptHardwareRestart();
    refreshButtons();
    notice(t("تم تفعيل وضع الأداء ⚡", "Performance mode enabled ⚡"), "success");
}

async function revertMode() {
    if (!active) return;
    active = false;
    removeCss();
    removeRuntimeOpts();
    await revertUserSettings();
    if (settings.store.changeProcessPriority) await setPriority("normal");
    refreshButtons();
    notice(t("تم إيقاف وضع الأداء", "Performance mode disabled"), "success");
}

function toggle() {
    autoByLoad = false; // Manual toggle overrides load monitor
    if (active) {
        revertMode();
        manualOff = true; // Manual off overrides auto-detection
    } else {
        applyMode();
        manualOff = false; // Clear manual off flag
    }
    settings.store.gameMode = active;
    DataStore.set(MANUAL_OFF_KEY, manualOff);
}

// ── Bolt Icon ──
function BoltIcon({ active: isActive }: { active: boolean; }) {
    const color = isActive ? "#3ba55c" : "#ed4245"; // Green when enabled, red when disabled
    return (
        <svg width={20} height={20} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1">
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
    );
}

function PerfHeaderButton() {
    const forceUpdate = useForceUpdater();
    useEffect(() => {
        buttonUpdaters.add(forceUpdate);
        return () => void buttonUpdaters.delete(forceUpdate);
    }, []);
    return (
        <HeaderBarButton
            icon={() => <BoltIcon active={active} />}
            tooltip={active ? t("إيقاف وضع الأداء", "Disable performance mode") : t("تفعيل وضع الأداء", "Enable performance mode")}
            onClick={toggle}
        />
    );
}

export default definePlugin({
    name: "PerformanceBoost",
    description: "Game/performance mode: reduces animations, compacts messages, stops GIFs, lowers process priority, cleans cache, and applies runtime speedups (spring skip, passive listeners, lazy images, memory-freeing) — all revertible. (Hardware acceleration requires one-time manual toggle + restart.)",
    authors: [TestcordDevs.LOSTSTR],
    tags: ["Utility"],
    dependencies: ["HeaderBarAPI"],
    settings,
    headerBarButton: { icon: () => <BoltIcon active={active} />, render: PerfHeaderButton },
    flux: {
        CONNECTION_OPEN() {
            // Connection complete ⇒ enable live game detection
            markReady();
        },
        RUNNING_GAMES_CHANGE({ games }: { games: { id: string; }[]; }) {
            // !ready ⇒ ignore startup game reports
            if (!settings.store.autoDetectGames || !ready) return;

            // manualOff ⇒ user manually turned off mode, respect decision
            if (manualOff) {
                if (games?.length && !notifiedManualOff) {
                    notice(t("تم تعطيل التفعيل التلقائي لأنك أوقفت وضع الأداء يدوياً. أعد تفعيله من الزر أو الإعدادات.", "Auto-enable is disabled because you turned off Performance mode manually. Re-enable it from the button or settings."), "info");
                    notifiedManualOff = true;
                }
                return;
            }

            if (games?.length) { if (!active) applyMode(); }
            else if (active) revertMode();
        }
    },
    async start() {
        // Load manual off flag and restore saved state if gameMode was enabled.
        manualOff = (await DataStore.get<boolean>(MANUAL_OFF_KEY)) ?? false;
        if (settings.store.gameMode) await applyMode();
        else await revertUserSettings(); // Ensure settings revert if disabled
        // Enable live detection on CONNECTION_OPEN with 15s fallback timer.
        readyFallbackTimer = setTimeout(markReady, 15000);
        startLoadMonitor();
    },
    stop() {
        stopLoadMonitor();
        revertMode();
        removeRuntimeOpts(); // Ensure addEventListener patch is reverted
        // Clean up timers and reset state
        if (readyFallbackTimer !== null) {
            clearTimeout(readyFallbackTimer);
            readyFallbackTimer = null;
        }
        ready = false;
        notifiedManualOff = false;
    }
});
