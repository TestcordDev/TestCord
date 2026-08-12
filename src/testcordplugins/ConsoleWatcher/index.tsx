/*
 * ConsoleWatcher — أداة مطوّر لمراقبة أحداث الكونسول وجمعها للصيانة
 * Copyright (c) 2026 LOSTSTR
 *
 * مبنية على Equicord المرخّصة GPL-3.0-or-later وتخضع لنفس الرخصة. تعترض دوال
 * الكونسول أثناء التسجيل النشط فقط، ثم تستعيد الأصل بالكامل عند الإيقاف — بلا
 * تسريب ذاكرة ولا تأثير على عملية main (تعمل في طرف العرض فقط).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { isPluginEnabled } from "@api/PluginManager";
import ErrorBoundary from "@components/ErrorBoundary";
import { gitHashShort } from "@shared/vencordUserAgent";
import { EquicordDevs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { t } from "@utils/testcordI18n";
import definePlugin from "@utils/types";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { Button, FluxDispatcher, Modal, openModal, useEffect, useState } from "@webpack/common";
import { getBuildNumber } from "@webpack/patcher";

import Plugins from "~plugins";

import { settings } from "./settings";
import type { ConsoleEvent, ConsoleEventType, ErrorGroup } from "./types";
import {
    attributeProbablePlugin, buildAttributionIndex, cleanConsoleArgs,
    clearAttributionIndex, detectSource, groupErrors, redactSecrets, safeSerializeArg
} from "./utilities";

const BUTTON_ID = "ConsoleWatcher";

const HOOKED_METHODS = [
    "log", "warn", "error", "info", "debug", "trace",
    "table", "group", "groupCollapsed", "groupEnd",
    "time", "timeEnd", "clear"
] as const;
type HookedMethod = typeof HOOKED_METHODS[number];

const events: ConsoleEvent[] = [];
const original: Partial<Record<HookedMethod, (...a: any[]) => void>> = {};

let recording = false;
let hooked = false;
let capturing = false; // حارس إعادة الدخول — يمنع التكرار اللانهائي
let errorCount = 0;    // عدّاد أخطاء حيّ — يظهر في تلميح الزر أثناء التسجيل

// ── فُتات Flux (breadcrumbs) — سياق «ماذا كان يحدث قبل الخطأ مباشرة» ─────────
// أثناء التسجيل فقط: نغلّف FluxDispatcher.dispatch لنحفظ أنواع آخر الأحداث في
// حلقة صغيرة (النوع فقط — لا حمولة، خصوصية وذاكرة). فكّ آمن بعلَم dead: إن غلّف
// طرف آخر بعدنا فلا نكسر السلسلة — يبقى غلافنا خاملاً تماماً.
const CRUMB_RING = 30;
const crumbs: string[] = [];
// كل غلاف يحمل أصله وعلَمه داخل إغلاقه الخاص — فلا يتكسّر حتى لو بقي في سلسلة أغلفة
// أطراف أخرى بعد فكّنا (يصبح ممرّاً شفافاً خاملاً فقط).
let activeUnwrap: (() => void) | null = null;

function wrapDispatch() {
    if (activeUnwrap) return;
    try {
        const fd = FluxDispatcher as any;
        const orig = fd.dispatch as (...a: any[]) => any;
        const state = { dead: false };
        const wrapper = function (this: any, ...args: any[]) {
            if (!state.dead) {
                try {
                    const type = args[0]?.type;
                    if (typeof type === "string") {
                        crumbs.push(type);
                        if (crumbs.length > CRUMB_RING) crumbs.shift();
                    }
                } catch { /* الفتات لا تؤذي أبداً */ }
            }
            return orig.apply(this, args);
        };
        fd.dispatch = wrapper;
        activeUnwrap = () => {
            try {
                if (fd.dispatch === wrapper) fd.dispatch = orig; // استعادة نظيفة
                else state.dead = true; // طرف آخر غلّف فوقنا — نخمل ولا نكسر سلسلته
            } catch { /* تجاهل */ }
        };
    } catch { activeUnwrap = null; }
}

function unwrapDispatch() {
    if (!activeUnwrap) return;
    activeUnwrap();
    activeUnwrap = null;
    crumbs.length = 0;
}

// مستمعو إعادة رسم الزر (لتحديث لونه/تلميحه عند تبديل الحالة)
const buttonListeners = new Set<() => void>();
function notifyButton() {
    buttonListeners.forEach(l => l());
}

function clampMax(v: unknown): number {
    const n = typeof v === "number" ? v : parseInt(String(v), 10);
    return Number.isFinite(n) ? Math.min(5000, Math.max(50, Math.floor(n))) : 500;
}

function capture(type: ConsoleEventType, args: unknown[], detail?: string) {
    if (capturing) return; // لا نعيد الدخول إلى الالتقاط أبداً
    capturing = true;
    try {
        if (type === "log" && !settings.store.includeLog) return;
        if (type === "trace" && !settings.store.includeTrace) return;
        const cleaned = cleanConsoleArgs(args); // أزِل ضوضاء %c وأنماط الـCSS
        // التقط stack الخطأ إن مُرِّر كائن Error ضمن الوسائط (يساعد التشخيص)
        let stack = detail;
        if (!stack) {
            const err = cleaned.find(a => a instanceof Error) as Error | undefined;
            if (err?.stack) stack = err.stack;
        }
        if (stack) stack = redactSecrets(stack); // الـstack قد يحمل روابط بتوكنات
        const serialized = cleaned.map(safeSerializeArg);
        const { source, pluginName } = detectSource(serialized); // انسب الحدث لمصدره

        const ev: ConsoleEvent = { timestamp: Date.now(), type, args: serialized, detail: stack, source, pluginName };

        if (ERROR_TYPES.has(type)) {
            // نسبة استدلالية للأخطاء غير الموسومة + فُتات Flux (للأخطاء فقط — رخيصة)
            if (!pluginName && source === "unknown")
                ev.probablePlugin = attributeProbablePlugin(serialized.join(" "), stack);
            if (crumbs.length) ev.crumbs = crumbs.slice(-6);
            errorCount++;
            notifyButton(); // حدّث عدّاد الزر الحيّ
        }

        events.push(ev);
        const max = clampMax(settings.store.maxEvents);
        while (events.length > max) events.shift(); // احذف الأقدم عند تجاوز الحد
    } catch {
        // الالتقاط يجب ألّا يرمي استثناءً إلى كونسول ديسكورد — نبتلعه بصمت
    } finally {
        capturing = false; // يُنفَّذ حتى مع return أعلاه
    }
}

function hookConsole() {
    if (hooked) return;
    for (const m of HOOKED_METHODS) {
        if (!original[m]) original[m] = (console as any)[m]?.bind(console); // احفظ الأصل مرّة
        const orig = original[m];
        (console as any)[m] = (...args: any[]) => {
            // الأصل أولاً: الكونسول يبقى يعمل طبيعياً حتى لو فشل الالتقاط
            try { orig?.(...args); } catch { /* الأصل رمى — ليست مشكلتنا */ }
            capture(m, args);
        };
    }
    hooked = true;
}

function unhookConsole() {
    if (!hooked) return;
    for (const m of HOOKED_METHODS)
        if (original[m]) (console as any)[m] = original[m]; // استعادة نظيفة
    hooked = false;
}

// مراجع مسمّاة كي تعمل removeEventListener — ولا تدهس معالج ديسكورد (إضافية)
function onWindowError(e: ErrorEvent) {
    capture("window.onerror", [e.message], e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
}
function onUnhandledRejection(e: PromiseRejectionEvent) {
    const r = e.reason;
    capture(
        "unhandledrejection",
        [r instanceof Error ? r.message : r],
        r instanceof Error ? r.stack : undefined
    );
}

function startRecording() {
    if (recording) return;
    events.length = 0; // امسح أي بيانات سابقة
    errorCount = 0;
    // فهرس النسبة الاستدلالية: أسماء الإضافات المُفعّلة الآن (يُبنى مرة واحدة هنا)
    try { buildAttributionIndex(Object.keys(Plugins).filter(isPluginEnabled)); } catch { /* بلا فهرس — تبقى النسبة الموسومة فقط */ }
    hookConsole();
    wrapDispatch(); // فُتات Flux — أثناء التسجيل فقط
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    recording = true;
    notifyButton();
}

// يفكّ كل شيء بلا فتح نافذة — يُستعمل عند تعطيل الإضافة
function teardownRecording() {
    unhookConsole();
    unwrapDispatch();
    clearAttributionIndex();
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    recording = false;
    notifyButton();
}

function stopRecording() {
    if (!recording) return;
    const snapshot = events.slice(); // لقطة ثابتة للنافذة
    teardownRecording();
    openEventsModal(snapshot);
}

const ERROR_TYPES = new Set<ConsoleEventType>(["error", "window.onerror", "unhandledrejection"]);

// ضوضاء متصفّح معروفة غير ضارّة — نستبعدها من «الأخطاء فقط»
function isNoise(e: ConsoleEvent): boolean {
    return e.args.some(a => a.includes("ResizeObserver loop"));
}

function formatEvents(list: ConsoleEvent[]): string {
    return list
        .map(e => {
            const ts = new Date(e.timestamp).toISOString().slice(11, 23); // HH:MM:SS.mmm
            const src = e.source !== "unknown"
                ? ` (${e.pluginName ?? e.source})`
                : (e.probablePlugin ? ` (${e.probablePlugin}?)` : ""); // «؟» = نسبة استدلالية لا يقين
            const head = `[${ts}] [${e.type}]${src} ${e.args.join(" ")}`;
            const lines = [head];
            if (e.crumbs?.length) lines.push(`    ↳ flux: ${e.crumbs.join(" → ")}`); // ما قبل الخطأ مباشرة
            if (e.detail) lines.push(`    ${e.detail}`);
            return lines.join("\n");
        })
        .join("\n");
}

// جدول المجموعات نصّياً (للنسخ/التنزيل من عرض «المجمّع»)
function formatGroups(groups: ErrorGroup[]): string {
    if (!groups.length) return t("لا أخطاء.", "No errors.");
    return groups
        .map(g => {
            const span = Math.max(1, Math.round((g.lastAt - g.firstAt) / 1000));
            const who = g.pluginName ? ` [${g.pluginName}]` : ` [${g.source}]`;
            const storm = g.storm ? "  🌩STORM" : "";
            return `×${g.count}${storm}${who} (${g.type}, ${span}s) ${g.sample}`;
        })
        .join("\n");
}

// ترويسة سياق تلقائية — تختصر أسئلة التشخيص (إصدار/بناء/نظام + أعداد الأخطاء حسب المصدر
// + أكثر المجموعات تكراراً وأي عواصف مرصودة)
function buildReportHeader(list: ConsoleEvent[], groups: ErrorGroup[]): string {
    const errs = list.filter(e => ERROR_TYPES.has(e.type) && !isNoise(e));
    const bySrc = (s: string) => errs.filter(e => e.source === s).length;
    const warnings = list.filter(e => e.type === "warn").length;
    let build = "?";
    try {
        const b = getBuildNumber();
        if (b && b !== -1) build = String(b);
    } catch { /* غير متاح — نتجاهل */ }
    const lines = [
        "=== ConsoleWatcher report ===",
        `Time:          ${new Date().toISOString()}`,
        `Equicord:      v${VERSION} (${gitHashShort})`,
        `Discord build: ${build}`,
        `Client:        ${navigator.userAgent}`,
        `Events:        total=${list.length}  warnings=${warnings}`,
        `Errors:        total=${errs.length}  (discord=${bySrc("discord")}, plugins=${bySrc("plugin")}, arabicizer=${bySrc("arabicizer")}, unknown=${bySrc("unknown")})`,
    ];
    const storms = groups.filter(g => g.storm);
    if (storms.length)
        lines.push(`Storms:        ${storms.length}  (${storms.map(g => `×${g.count} ${g.sample.slice(0, 40)}`).join(" | ")})`);
    for (const g of groups.slice(0, 3))
        lines.push(`Top error:     ×${g.count}${g.pluginName ? ` [${g.pluginName}]` : ""} ${g.sample.slice(0, 90)}`);
    lines.push("=============================");
    return lines.join("\n");
}

// شرائح ترشيح حسب المصدر — لعزل أخطاء جهة بعينها وقت الإرسال للتشخيص.
type FilterId = "all" | "errors" | "grouped" | "discord" | "plugins" | "arabicizer";
const FILTERS: { id: FilterId; label: string; }[] = [
    { id: "all", label: t("الكل", "All") },
    { id: "errors", label: t("الأخطاء", "Errors") },
    { id: "grouped", label: t("المجمّع", "Grouped") },
    { id: "discord", label: t("ديسكورد", "Discord") },
    { id: "plugins", label: t("الإضافات", "Plugins") },
    { id: "arabicizer", label: "Arabicizer" }
];

function matchesFilter(e: ConsoleEvent, f: FilterId): boolean {
    switch (f) {
        case "errors": return ERROR_TYPES.has(e.type) && !isNoise(e);
        case "grouped": return ERROR_TYPES.has(e.type) && !isNoise(e); // نفس مجموعة الأخطاء، عرض مختلف
        case "discord": return e.source === "discord";
        case "plugins": return e.source === "plugin";
        case "arabicizer": return e.source === "arabicizer";
        default: return true; // "all"
    }
}

function EventsModal({ modalProps, snapshot }: { modalProps: RenderModalProps; snapshot: ConsoleEvent[]; }) {
    const [filter, setFilter] = useState<FilterId>("all");
    // المجموعات تُحسَب مرة واحدة لكل لقطة (اللقطة ثابتة بعد الإيقاف)
    const [groups] = useState<ErrorGroup[]>(() => groupErrors(snapshot, ERROR_TYPES, isNoise));
    const header = buildReportHeader(snapshot, groups);
    const filtered = snapshot.filter(e => matchesFilter(e, filter));
    const body = filter === "grouped"
        ? formatGroups(groups)
        : (filtered.length ? formatEvents(filtered) : t("لا أحداث مطابقة.", "No matching events."));
    const text = `${header}\n\n${body}`;
    const shownCount = filter === "grouped" ? groups.length : filtered.length;

    function exportJson() {
        const payload = {
            _testcord: "consolewatcher",
            version: 2,
            takenAt: new Date().toISOString(),
            equicord: `v${VERSION} (${gitHashShort})`,
            events: snapshot,
            groups,
        };
        const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        saveFile(new File([JSON.stringify(payload, null, 2)], `consolewatcher-${date}.json`, { type: "application/json" }));
    }

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={t(`سجلّ الكونسول (${snapshot.length} حدثاً)`, `Console log (${snapshot.length} events)`)}
        >
            <div className="cw-filters">
                {FILTERS.map(f => (
                    <button
                        key={f.id}
                        className={filter === f.id ? "cw-chip cw-chip-active" : "cw-chip"}
                        onClick={() => setFilter(f.id)}
                    >
                        {f.label} ({f.id === "grouped" ? groups.length : snapshot.filter(e => matchesFilter(e, f.id)).length})
                    </button>
                ))}
            </div>
            <div className="cw-body">
                <pre className="cw-pre">{text}</pre>
            </div>
            <div className="cw-footer">
                <Button onClick={() => copyWithToast(text, t("✓ نُسخ المعروض", "✓ Copied shown"))}>
                    {t(`نسخ المعروض (${shownCount})`, `Copy shown (${shownCount})`)}
                </Button>
                <Button
                    color={Button.Colors.PRIMARY}
                    onClick={() => {
                        const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
                        saveFile(new File([text], `consolewatcher-${filter}-${date}.log`, { type: "text/plain" }));
                    }}
                >
                    {t("تنزيل كملف", "Download as file")}
                </Button>
                <Button color={Button.Colors.PRIMARY} onClick={exportJson}>
                    {t("تصدير JSON", "Export JSON")}
                </Button>
            </div>
        </Modal>
    );
}

function openEventsModal(snapshot: ConsoleEvent[]) {
    openModal(props => (
        <ErrorBoundary>
            <EventsModal modalProps={props} snapshot={snapshot} />
        </ErrorBoundary>
    ));
}

// أيقونة عين/نقطة تسجيل — لونها currentColor فتتلوّن أحمر عبر .cw-recording في CSS
function RecordIcon({ width = 18, height = 18, color = "currentColor" }: { width?: number; height?: number; color?: string; size?: string; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="none">
            <path d="M12 5C6.5 5 3 9.5 3 12s3.5 7 9 7 9-4.5 9-7-3.5-7-9-7Z" stroke={color} strokeWidth="2" />
            <circle cx="12" cy="12" r="3.25" fill={color} />
        </svg>
    );
}

function ConsoleWatcherButton() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        buttonListeners.add(l);
        return () => void buttonListeners.delete(l);
    }, []);

    return (
        <HeaderBarButton
            icon={RecordIcon}
            tooltip={recording
                ? (errorCount > 0
                    ? t(`إيقاف التسجيل — ${errorCount} خطأ حتى الآن`, `Stop recording — ${errorCount} errors so far`)
                    : t("إيقاف تسجيل الكونسول وعرض السجلّ", "Stop recording & show log"))
            : t("بدء تسجيل الكونسول", "Start console recording")}
            className={recording ? (errorCount > 0 ? "cw-button cw-recording cw-has-errors" : "cw-button cw-recording") : "cw-button"}
            selected={recording}
            aria-label={t("مراقب الكونسول", "Console Watcher")}
            onClick={() => (recording ? stopRecording() : startRecording())}
        />
    );
}

export default definePlugin({
    name: "ConsoleWatcher",
    description: t(
        "أداة مطوّر: تسجّل أحداث الكونسول والأخطاء أثناء التسجيل النشط فقط، وتجمّع المتكرر وتكشف العواصف وتنسب الخطأ لمصدره مع سياق Flux، وتحجب التوكنات تلقائياً — ثم تعرض الكل للنسخ والتصدير.",
        "Developer tool: records console events & errors only while recording — groups repeats, detects error storms, attributes errors to their source with Flux context, auto-redacts tokens — then shows everything for copying and export."
    ),
    authors: [EquicordDevs.LOSTSTR],
    dependencies: ["HeaderBarAPI"],
    settings,

    start() {
        addHeaderBarButton(BUTTON_ID, () => <ConsoleWatcherButton />);
    },

    stop() {
        if (recording) teardownRecording(); // لا نفتح نافذة عند تعطيل الإضافة
        events.length = 0;
        errorCount = 0;
        removeHeaderBarButton(BUTTON_ID);
    }
});
