/*
 * ConsoleWatcher — أداة مطوّر لمراقبة أحداث الكونسول وجمعها للصيانة
 * Copyright (c) 2026 LOSTSTR
 *
 * مبنية على Equicord المرخّصة GPL-3.0-or-later وتخضع لنفس الرخصة.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ConsoleEvent, ConsoleEventType, ConsoleSource, ErrorGroup } from "./types";

// مُسلسِل آمن: يحوّل أي وسيطة كونسول إلى نصّ دون أن يرمي استثناءً.
// يكشف المراجع الدائرية، ويحدّ العمق/الطول/العدد، ويعالج الأنواع الخاصّة.
// لا يستخدم eval أو Function — مجرّد تكرار (recursion).

const MAX_DEPTH = 4;
const MAX_STRING_LEN = 10_000; // حدّ طول النص لكل وسيطة
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;

// الأنواع التي لا يُسلسِلها JSON بشكل مفيد → وصف نصّي مختصر
function describeSpecial(value: unknown): string | undefined {
    if (typeof value === "function")
        return `[Function${(value as Function).name ? ": " + (value as Function).name : ""}]`;
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "bigint") return `${value}n`;
    if (value instanceof Error) return `[${value.name}: ${value.message}]`;
    if (typeof Node !== "undefined" && value instanceof Node) {
        const el = value as any;
        const tag = el.tagName?.toLowerCase?.() ?? el.nodeName?.toLowerCase?.() ?? "node";
        return `[HTMLElement <${tag}>]`;
    }
    return undefined;
}

// يبني نسخة "آمنة" (بدائيات/مصفوفات/كائنات عادية فقط) خالية من الدوران
function toSafe(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (value === null) return null;

    const t = typeof value;
    if (t === "string") {
        const s = value as string;
        return s.length > MAX_STRING_LEN ? s.slice(0, MAX_STRING_LEN) + "…(truncated)" : s;
    }
    if (t === "number" || t === "boolean") return value;
    if (t === "undefined") return "undefined";

    const special = describeSpecial(value);
    if (special !== undefined) return special;

    // هنا القيمة كائن أو مصفوفة
    if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[Array]" : "[Object]";

    const obj = value as object;
    if (seen.has(obj)) return "[Circular]"; // كشف الدورة الحقيقية
    seen.add(obj);
    try {
        if (Array.isArray(value)) {
            const out: unknown[] = [];
            const len = Math.min(value.length, MAX_ARRAY_ITEMS);
            for (let i = 0; i < len; i++) out.push(toSafe(value[i], depth + 1, seen));
            if (value.length > MAX_ARRAY_ITEMS) out.push(`…(+${value.length - MAX_ARRAY_ITEMS} more)`);
            return out;
        }

        const out: Record<string, unknown> = {};
        const keys = Object.keys(obj);
        const shown = Math.min(keys.length, MAX_OBJECT_KEYS);
        for (let i = 0; i < shown; i++) {
            const k = keys[i];
            try {
                out[k] = toSafe((obj as any)[k], depth + 1, seen);
            } catch {
                out[k] = "[Unserializable]";
            }
        }
        if (keys.length > MAX_OBJECT_KEYS) out["…"] = `(+${keys.length - MAX_OBJECT_KEYS} more)`;
        return out;
    } finally {
        // نزيله صعوداً: نسمح بتكرار الكائن في فروع شقيقة، ونمسك الدورة الحقيقية فقط
        seen.delete(obj);
    }
}

// ── حجب الأسرار ──────────────────────────────────────────────────────────────
// السجلّ يُنسَخ ويُرسَل للتشخيص — فنحجب أي شيء يشبه سرّاً قبل تخزينه أصلاً
// (لا يُحفَظ السرّ في الذاكرة حتى). أنماط توكن ديسكورد وBearer والبريد فقط —
// أنماط ضيّقة عمداً كي لا تشوّه نصوص السجلّ العادية.
const SECRET_PATTERNS: [RegExp, string][] = [
    // توكن ديسكورد: ثلاث فقرات base64url يفصلها نقطتان (شكله المعروف)
    [/[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{25,110}/g, "[REDACTED:token]"],
    [/mfa\.[\w-]{20,}/g, "[REDACTED:mfa-token]"],
    [/Bearer\s+[\w.~+/-]{15,}/g, "Bearer [REDACTED]"],
    [/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g, "[REDACTED:email]"],
];

/** يحجب التوكنات/البريد من نصّ قبل حفظه — يُطبَّق على كل وسيطة وكل stack. */
export function redactSecrets(s: string): string {
    let out = s;
    for (const [re, sub] of SECRET_PATTERNS) out = out.replace(re, sub);
    return out;
}

/** يحوّل وسيطة كونسول واحدة إلى نصّ آمن للعرض/النسخ (مع حجب الأسرار). */
export function safeSerializeArg(value: unknown): string {
    // النص الخام يمرّ كما هو (أوضح في العرض)
    if (typeof value === "string")
        return redactSecrets(value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) + "…(truncated)" : value);
    try {
        const safe = toSafe(value, 0, new WeakSet<object>());
        if (typeof safe === "string") return redactSecrets(safe);
        const json = JSON.stringify(safe);
        return redactSecrets(json.length > MAX_STRING_LEN ? json.slice(0, MAX_STRING_LEN) + "…(truncated)" : json);
    } catch {
        return "[Unserializable]";
    }
}

/**
 * يزيل توجيهات `%c` وأنماط الـCSS التابعة من وسائط console المنسّقة. ديسكورد
 * يلوّن سجلّاته عبر `console.x("%c[Module]", "css...", msg)` — فننظّفها لقراءة أوضح.
 * يبقى السلوك كما هو إن لم تكن أول وسيطة نصّاً يحوي `%c`.
 */
export function cleanConsoleArgs(args: unknown[]): unknown[] {
    const first = args[0];
    if (typeof first !== "string" || !first.includes("%c")) return args;

    const cssCount = (first.match(/%c/g) ?? []).length; // كل %c يستهلك وسيطة CSS تابعة
    const cleanedFirst = first.replace(/%c/g, "").trim();
    const rest = args.slice(1 + cssCount); // أسقِط وسائط الـCSS
    return cleanedFirst ? [cleanedFirst, ...rest] : rest;
}

/**
 * يكتشف مصدر حدث الكونسول من نصوصه (بعد التنظيف) — heuristic مبنيّ على صيغة
 * Logger في Vencord (بعد إزالة %c يصبح "Equicord <اسم>") ووسوم وحدات ديسكورد.
 * ليست نسبةً مثاليةً (الأخطاء الخام بلا وسم تبقى unknown)، لكنها موثوقة للموسوم.
 */
export function detectSource(args: string[]): { source: ConsoleSource; pluginName?: string; } {
    // DiscordArabicizer: تستخدم وسم [DiscordArabicizer] صراحةً في سجلّاتها.
    if (args.some(a => a.includes("[DiscordArabicizer]")))
        return { source: "arabicizer", pluginName: "DiscordArabicizer" };

    const head = (args[0] ?? "").trim();

    // Vencord/Equicord Logger: بعد تنظيف %c تصبح البادئة "Equicord <اسم> ...".
    const eq = head.match(/^Equicord\s+(\S+)/);
    if (eq) return { source: "plugin", pluginName: eq[1] };

    // وحدة ديسكورد أساسية: سجلّ معنون بـ [ModuleName].
    if (/^\[[^\]]+\]/.test(head)) return { source: "discord" };

    return { source: "unknown" };
}

// ── نسبة استدلالية للأخطاء غير الموسومة ──────────────────────────────────────
// حين لا يحمل الخطأ وسم Logger، نبحث عن أسماء الإضافات المُفعّلة داخل نصّه/الـstack.
// أسماء قصيرة/عامة (≤4 أحرف) تُستبعد لتفادي المطابقات الكاذبة. النتيجة «احتمال»
// تُعرَض بعلامة استفهام — لا نزعم يقيناً ليس عندنا (بلا وهم).

let attributionNames: { name: string; re: RegExp; }[] = [];

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** تُبنى مرة واحدة عند بدء التسجيل من قائمة الإضافات المُفعّلة (الأطول أولاً). */
export function buildAttributionIndex(enabledNames: string[]): void {
    attributionNames = enabledNames
        .filter(n => n.length >= 5)
        .sort((a, b) => b.length - a.length)
        .map(name => ({ name, re: new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(name)}(?:[^A-Za-z0-9]|$)`, "i") }));
}

export function clearAttributionIndex(): void {
    attributionNames = [];
}

/** يبحث عن اسم إضافة مُفعّلة داخل نصّ الخطأ + الـstack — أول مطابقة (الأطول أولاً). */
export function attributeProbablePlugin(text: string, stack?: string): string | undefined {
    if (attributionNames.length === 0) return undefined;
    const hay = stack ? `${text}\n${stack}` : text;
    for (const { name, re } of attributionNames)
        if (re.test(hay)) return name;
    return undefined;
}

// ── تجميع الأخطاء + كشف العواصف (يُحسَب وقت التقرير فقط — صفر كلفة أثناء التسجيل) ──

/** يطبّع نصّ خطأ إلى مفتاح مجموعة: أرقام/معرّفات/روابط → رموز ثابتة. */
export function normalizeGroupKey(text: string): string {
    return text
        .replace(/https?:\/\/\S+/g, "<url>")
        .replace(/[a-f0-9]{16,}/gi, "<id>")   // hex/snowflake-ish طويلة
        .replace(/\d{5,}/g, "<id>")           // معرّفات رقمية
        .replace(/\d+/g, "#")                 // بقية الأرقام (أسطر/أحجام)
        .slice(0, 140);
}

const STORM_COUNT = 20;
const STORM_WINDOW_MS = 60_000;

/** يبني مجموعات الأخطاء من لقطة الأحداث — للملخّص وعرض «المجمّع». */
export function groupErrors(list: ConsoleEvent[], errorTypes: ReadonlySet<ConsoleEventType>, isNoise: (e: ConsoleEvent) => boolean): ErrorGroup[] {
    const groups = new Map<string, ErrorGroup>();
    for (const e of list) {
        if (!errorTypes.has(e.type) || isNoise(e)) continue;
        const text = e.args.join(" ");
        const key = `${e.type}|${normalizeGroupKey(text)}`;
        const g = groups.get(key);
        if (g) {
            g.count++;
            if (e.timestamp < g.firstAt) g.firstAt = e.timestamp;
            if (e.timestamp > g.lastAt) g.lastAt = e.timestamp;
            if (!g.pluginName && (e.pluginName ?? e.probablePlugin)) g.pluginName = e.pluginName ?? e.probablePlugin;
        } else {
            groups.set(key, {
                key,
                sample: text.slice(0, 200),
                type: e.type,
                source: e.source,
                pluginName: e.pluginName ?? e.probablePlugin,
                count: 1,
                firstAt: e.timestamp,
                lastAt: e.timestamp,
                storm: false,
            });
        }
    }
    const out = [...groups.values()];
    for (const g of out)
        g.storm = g.count >= STORM_COUNT && (g.lastAt - g.firstAt) <= STORM_WINDOW_MS;
    return out.sort((a, b) => b.count - a.count);
}
