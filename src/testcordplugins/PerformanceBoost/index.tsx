/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { HeaderBarButton } from "@api/HeaderBar";
import { popNotice, showNotice } from "@api/Notices";
import { showNotification } from "@api/Notifications";
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
let ready = false; // يصبح true عند CONNECTION_OPEN (أو مهلة احتياطية) — لتجاهل بلاغ الألعاب عند الإقلاع
let readyFallbackTimer: ReturnType<typeof setTimeout> | null = null; // مهلة احتياطية إن لم يصل CONNECTION_OPEN
let manualOff = false; // المستخدم أوقفه يدوياً ⇒ يطغى على الكشف التلقائي حتى يُفعّله بنفسه
let notifiedManualOff = false; // أُعلِم المستخدم مرة واحدة فقط أن التفعيل التلقائي مُعطَّل بسبب الإيقاف اليدوي
const HW_ACK_KEY = "PerformanceBoost_hwRestartAcknowledged";
const MANUAL_OFF_KEY = "PerformanceBoost_manualOff"; // يُحفَظ علَم الإيقاف اليدوي عبر إعادة التشغيل
const buttonUpdaters = new Set<() => void>();
const refreshButtons = () => buttonUpdaters.forEach(u => u());

// يفتح الكشف الحيّ عن الألعاب (idempotent): يُستدعى من CONNECTION_OPEN أو من المهلة الاحتياطية.
function markReady() {
    if (ready) return;
    ready = true;
    if (readyFallbackTimer !== null) {
        clearTimeout(readyFallbackTimer);
        readyFallbackTimer = null;
    }
}

// مفاتيح DataStore لحفظ القيم الأصلية
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
    root.classList.add("vc-perfboost-active"); // تحسينات عرض خفيفة أثناء تفعيل الوضع
}
function removeCss() {
    document.documentElement.classList.remove("vc-perfboost-no-anim", "vc-perfboost-hide-activities", "vc-perfboost-active");
}

// ── تحسينات وقت التشغيل (كلها لمرة واحدة عند التفعيل — بلا حلقات/مؤقّتات، فلا تُثقل ولا تُسرّب) ──
const PASSIVE_EVENTS = ["wheel", "mousewheel", "touchstart", "touchmove", "touchend"];
let originalAddEventListener: typeof EventTarget.prototype.addEventListener | null = null;
let springs: { Globals?: { assign?: (o: Record<string, unknown>) => void; }; }[] = [];

// تفريغ كاش عدد كبير من الـStores الثقيلة لتحرير الذاكرة (اختياري — قد يُعيد الجلب لاحقاً).
// نستدعي clearCache فقط (كاش قابل لإعادة البناء) ولا نلمس clear لأنها قد تمسح بيانات حقيقية (كالمسوّدات).
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
    if (typeof (window as any).gc === "function") { try { (window as any).gc(); } catch { /* gc غير متاح */ } }
    logger.info(`Cleared ${n} store caches`);
}

function applyRuntimeOpts() {
    // تخطّي حركات Spring (قابل للعكس)
    if (settings.store.skipSpringAnimations && springs.length === 0) {
        springs = findAll(m => typeof (m as any)?.Globals === "object" && typeof (m as any)?.Springs === "object") as typeof springs;
        for (const s of springs) s.Globals?.assign?.({ skipAnimation: true });
    }
    // جعل مستمعي التمرير/اللمس passive — تمرير أنعم (قابل للعكس)
    if (settings.store.passiveListeners && !originalAddEventListener) {
        originalAddEventListener = EventTarget.prototype.addEventListener;
        const orig = originalAddEventListener;
        EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: any, options?: any) {
            if (PASSIVE_EVENTS.includes(type) && listener != null) {
                if (typeof options === "boolean" || options === undefined) options = { capture: !!options, passive: true };
                else if (options.passive === undefined) options = { ...options, passive: true };
            }
            return orig.call(this, type, listener, options);
        } as typeof EventTarget.prototype.addEventListener;
    }
    // صور كسولة + فكّ ترميز غير متزامن (لمرة واحدة، غير مؤذٍ). نتخطّى صور الدردشة:
    // loading=lazy/decoding=async عليها يكسران التمرير التلقائي لأسفل المحادثة.
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

// عكس كل ما هو قابل للعكس — يمنع تسريب الرقعة على addEventListener.
function removeRuntimeOpts() {
    for (const s of springs) s.Globals?.assign?.({ skipAnimation: false });
    springs = [];
    if (originalAddEventListener) {
        EventTarget.prototype.addEventListener = originalAddEventListener;
        originalAddEventListener = null;
    }
}

// ── تطبيق واستعادة الإعدادات التلقائية (Compact + GIF) ──
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

// ── أولوية العمليات والكاش ──
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

// ── إعادة التشغيل لتسريع العتاد (مرة واحدة فقط) ──
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

// ── مراقب الحمل الاختياري (autoHighLoad — مُطفأ افتراضياً) ──
// عيّنة CPU إجمالية كل 30 ثانية عبر getAppMetrics (بلا عمليات خارجية). عيّنتان متتاليتان
// فوق الحدّ → تفعيل تلقائي؛ وعيّنتان متتاليتان دون 60% من الحدّ → إيقاف تلقائي، لكن فقط
// إن كان التفعيل الأخير بسبب الحمل (لا نلمس ما فعّله المستخدم/كشف الألعاب).
let loadTimer: ReturnType<typeof setInterval> | null = null;
let highStreak = 0, lowStreak = 0;
let autoByLoad = false; // آخر تفعيل كان بسبب الحمل ⇒ يجوز لنا وحدنا عكسه تلقائياً

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

// المؤقّت يعمل طوال تفعيل الإضافة على سطح المكتب؛ sampleLoad يخرج فوراً (فحص boolean
// واحد، بلا أي نداء native) ما دام الخيار مُطفأً — فيستجيب التبديل حيّاً بلا إعادة تشغيل.
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

// ── التفعيل والإيقاف (كل شيء تلقائي) ──
async function applyMode() {
    if (active) return;
    active = true;
    notifiedManualOff = false; // أُعيد التفعيل ⇒ نسمح بإعلامٍ جديد لاحقاً إن أُوقف يدوياً مرة أخرى
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
    autoByLoad = false; // تدخّل يدوي ⇒ مراقب الحمل لا يملك عكس هذه الحالة تلقائياً
    if (active) {
        revertMode();
        manualOff = true; // إيقاف يدوي ⇒ يطغى على الكشف التلقائي حتى تُفعّله بنفسك
    } else {
        applyMode();
        manualOff = false; // تفعيل يدوي ⇒ يُمحى العلَم ويستأنف الكشف التلقائي بعدها
    }
    settings.store.gameMode = active;
    DataStore.set(MANUAL_OFF_KEY, manualOff);
}

// ── أيقونة البرق (تتغير ألوانها) ──
function BoltIcon({ active: isActive }: { active: boolean; }) {
    const color = isActive ? "#3ba55c" : "#ed4245"; // أخضر عند التفعيل، أحمر عند الإيقاف
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
            // اكتمل الاتصال ⇒ نفتح الكشف الحيّ عن الألعاب (نكون قد تجاوزنا دفعة بلاغات الإقلاع).
            markReady();
        },
        RUNNING_GAMES_CHANGE({ games }: { games: { id: string; }[]; }) {
            // !ready ⇒ نتجاهل بلاغ الألعاب عند الإقلاع.
            if (!settings.store.autoDetectGames || !ready) return;

            // manualOff ⇒ المستخدم أوقفه يدوياً فنحترم قراره ولا نُعيد التفعيل، لكن نُعلمه مرة واحدة.
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
        // نحترم اختيار المستخدم: نُحمِّل علَم الإيقاف اليدوي، ونستعيد حالته اليدوية المحفوظة فقط (gameMode)،
        // ولا نُفعّل تلقائياً من كشف الألعاب عند الإقلاع. الكشف الحيّ يبقى عبر RUNNING_GAMES_CHANGE أثناء الجلسة.
        manualOff = (await DataStore.get<boolean>(MANUAL_OFF_KEY)) ?? false;
        if (settings.store.gameMode) await applyMode();
        else await revertUserSettings(); // مُعطَّل يبقى مُعطَّلاً + تنظيف أي إعداد عالق من جلسة سابقة
        // نفتح الكشف الحيّ عند CONNECTION_OPEN (انظر flux أعلاه)، مع مهلة احتياطية 15ث إن لم يصل الحدث —
        // فلا يُفعَّل الوضع تلقائياً عند فتح Discord ولعبة شغّالة.
        readyFallbackTimer = setTimeout(markReady, 15000);
        startLoadMonitor(); // مراقب الحمل الاختياري (لا يفعل شيئاً ما دام autoHighLoad مُطفأً)
    },
    stop() {
        stopLoadMonitor();
        revertMode();
        removeRuntimeOpts(); // ضمان عكس رقعة addEventListener حتى لو لم يكن الوضع مفعّلاً (بلا تسريب)
        // ننظّف المهلة الاحتياطية ونُعيد ضبط الحالة لإعادة تفعيل نظيفة لاحقاً.
        if (readyFallbackTimer !== null) {
            clearTimeout(readyFallbackTimer);
            readyFallbackTimer = null;
        }
        ready = false;
        notifiedManualOff = false;
    }
});
