/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { handleGameModeChange, PluginManagerControls } from "./PluginManager";

// الأوصاف هنا بالإنجليزية؛ العربية تأتي من overlay (src/i18n/plugins/PerformanceBoost.ts).
// definePluginSettings يحفظ الإعدادات تلقائياً (لا localStorage).
export const settings = definePluginSettings({
    // المفتاح الرئيسي: تفعيله يطبّق تحسينات وقت التشغيل ويُعطّل بقيّة الإضافات (عدا الأساسيّة
    // واستثناءاتك) مع طلب إعادة تشغيل. الربط عبر onChange (يعمل من الإعدادات أو زرّ الشريط).
    // ملاحظة: لا تُسمِّ هذا "enabled" — Settings.plugins[name].enabled محجوز لعلَم تفعيل الإضافة نفسها في Vencord
    gameMode: {
        type: OptionType.BOOLEAN, default: false,
        description: "Enable performance / game mode (also disables other plugins except essentials and your exceptions; requires a restart)",
        onChange: handleGameModeChange
    },
    // زرّ الاستثناءات: اختيار الإضافات التي تبقى مُفعّلة عند تفعيل وضع الأداء (يُرسَم داخل المكوّن).
    pluginManager: {
        type: OptionType.COMPONENT,
        description: "Choose which plugins stay enabled when performance mode is on.",
        component: PluginManagerControls
    },
    // الاستثناءات: أسماء إضافات تبقى مُفعّلة (مفصولة بفواصل) — مخفيّة عن قائمة الإعدادات.
    pluginKeep: {
        type: OptionType.STRING, default: "", hidden: true,
        description: "Comma-separated plugin names kept enabled (exceptions)."
    },
    // لقطة الإضافات التي كانت مُفعّلة قبل تعطيل البقيّة، لاستعادتها عند الإطفاء.
    pluginSaved: {
        type: OptionType.STRING, default: "", hidden: true,
        description: "JSON snapshot of plugins enabled before disabling the rest, restored when turned off."
    },
    // افتراضياً مُطفأ: حرية كاملة للمستخدم — لا تفعيل تلقائي إلا إن طلبه صراحةً.
    autoDetectGames: {
        type: OptionType.BOOLEAN, default: false,
        description: "Automatically enable when a game is detected"
    },
    // افتراضياً مُطفأ: مراقب حمل اختياري — عيّنة CPU كل 30 ثانية فقط عند تفعيله.
    autoHighLoad: {
        type: OptionType.BOOLEAN, default: false,
        description: "Automatically enable performance mode when Discord's CPU usage stays above the threshold (checks every 30s, desktop only)"
    },
    cpuThreshold: {
        type: OptionType.SLIDER,
        description: "CPU threshold (%) that triggers automatic performance mode (total across Discord processes)",
        markers: [80, 120, 160, 220, 300],
        default: 160,
        stickToMarkers: true
    },
    reduceHardwareAcceleration: {
        type: OptionType.BOOLEAN, default: true,
        description: "Disable hardware acceleration (requires a Discord restart)"
    },
    // جديد: عند تفعيل خفض تسريع العتاد، اعرض تنبيهاً بزرّ إعادة تشغيل (ليُطبَّق التغيير اليدوي)
    autoRestartOnHardwareChange: {
        type: OptionType.BOOLEAN, default: true,
        description: "Offer to restart Discord so a hardware-acceleration change takes effect"
    },
    disableAnimations: {
        type: OptionType.BOOLEAN, default: true,
        description: "Disable animations and transitions"
    },
    disableGifAutoplay: {
        type: OptionType.BOOLEAN, default: true,
        description: "Stop GIFs from autoplaying"
    },
    compactMode: {
        type: OptionType.BOOLEAN, default: true,
        description: "Use compact message mode"
    },
    hideActivities: {
        type: OptionType.BOOLEAN, default: true,
        description: "Hide friends' activities (Active Now)"
    },
    changeProcessPriority: {
        type: OptionType.BOOLEAN, default: true,
        description: "Lower all Discord processes' priority to Below Normal (Windows)"
    },
    cleanCacheOnStart: {
        type: OptionType.BOOLEAN, default: false,
        description: "Clean Discord's cache when game mode starts"
    },
    skipSpringAnimations: {
        type: OptionType.BOOLEAN, default: true,
        description: "Skip Discord's spring animations for a snappier UI"
    },
    passiveListeners: {
        type: OptionType.BOOLEAN, default: true,
        description: "Make scroll and touch listeners passive for smoother scrolling"
    },
    lazyImages: {
        type: OptionType.BOOLEAN, default: true,
        description: "Lazy-load and async-decode images to reduce jank"
    },
    clearStoreCaches: {
        type: OptionType.BOOLEAN, default: false,
        description: "Free memory by clearing many Discord caches (messages, emojis, profiles, experiments, and more) when performance mode starts"
    }
});
