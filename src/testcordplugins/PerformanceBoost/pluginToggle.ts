/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Esharq — تعطيل الإضافات لأقصى أداء: بضغطة يُعطّل كل الإضافات الاختياريّة ويُبقي الأساسيّة
 * فقط: المطلوبة (required) والتابعة (isDependency) + نواة اشراق العربيّة، إضافةً إلى استثناءات
 * المستخدم. يحفظ قائمة المُفعّلة قبل الدخول ليستعيدها عند الخروج. لا يمسّ سوى علم `enabled`
 * (يُطبَّق عند إعادة التشغيل) — لا تشغيل/إيقاف حيّ (أضمن للباتشات).
 */

import { plugins } from "@api/PluginManager";
import { Settings } from "@api/Settings";

// نواة اشراق التي تبقى دائماً: الخطّ داخل إضافة Settings (required)، والشارات عبر
// BadgeAPI (dependency)، فيكفي حماية مُعرِّب الواجهة صراحةً هنا. كما نحمي PerformanceBoost
// نفسها — وإلّا لعطّلت ذاتها فَفقَد المستخدم مفتاح الإطفاء بعد إعادة التشغيل.
const ESHARQ_ESSENTIALS = ["DiscordArabicizer", "PerformanceBoost"];

/** أساسيّة = مطلوبة أو تابعة أو نواة اشراق → لا تُعطَّل أبداً في وضع الأداء. */
export function isEssentialPlugin(name: string): boolean {
    const p = (plugins as Record<string, { required?: boolean; isDependency?: boolean; }>)[name];
    return !!(p?.required || p?.isDependency) || ESHARQ_ESSENTIALS.includes(name);
}

/** كل الإضافات القابلة للتعطيل (غير الأساسيّة) — تُعرَض في نافذة الاستثناءات. */
export function togglablePlugins(): string[] {
    return Object.keys(plugins).filter(n => !isEssentialPlugin(n)).sort((a, b) => a.localeCompare(b));
}

/** الإضافات القابلة للتعطيل والمُفعّلة حاليّاً فقط — هذه ما سيتأثّر بوضع الأداء. */
export function enabledTogglablePlugins(): string[] {
    return togglablePlugins().filter(n => Settings.plugins[n]?.enabled);
}

/** يحلّل قائمة الاستثناءات المخزّنة (أسماء مفصولة بفواصل). */
export function parseKeep(raw: string): string[] {
    return (raw || "").split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * يدخل وضع الأداء: يُعطّل كل غير أساسيّ عدا الاستثناءات، ويُرجع قائمة ما كان مُفعّلاً
 * (لتُخزَّن وتُستعاد لاحقاً). لا يلمس علم الأساسيّة إطلاقاً.
 */
export function enterPerformanceMode(keep: string[]): string[] {
    const keepSet = new Set(keep);
    const wasEnabled: string[] = [];
    for (const name of Object.keys(plugins)) {
        if (isEssentialPlugin(name)) continue;
        const s = Settings.plugins[name];
        if (!s) continue;
        if (s.enabled) wasEnabled.push(name);
        if (keepSet.has(name)) continue;
        s.enabled = false;
    }
    return wasEnabled;
}

/** يخرج من وضع الأداء: يُعيد تفعيل الإضافات المحفوظة كما كانت. */
export function exitPerformanceMode(saved: string[]): void {
    for (const name of saved) {
        const s = Settings.plugins[name];
        if (s) s.enabled = true;
    }
}
