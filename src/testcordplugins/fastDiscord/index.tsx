/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { RuntimeInteractions, RuntimeInterposition, RuntimeInterpositionPriority } from "@api/RuntimeInterposition";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { isObject } from "@utils/misc";
import { t } from "@utils/testcordI18n";
import definePlugin, { OptionType } from "@utils/types";
import { findAll } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const log = new Logger("FastDiscord");

/* -------------------------------------------------------------------------- */
/*                              Spring / animations                           */
/* -------------------------------------------------------------------------- */

interface SpringModule {
    Globals: {
        assign(options: { skipAnimation: boolean; }): void;
    };
    Springs: object;
}

let springs: SpringModule[] = [];
let started = false;

const isSpringGlobals = (v: unknown): v is SpringModule["Globals"] =>
    isObject(v) && "assign" in v && typeof (v as any).assign === "function";

const isSpringModule = (v: unknown): v is SpringModule => {
    if (!isObject(v)) return false;
    const m = v as Partial<SpringModule>;
    return isSpringGlobals(m.Globals) && isObject(m.Springs);
};

function loadSprings() {
    springs = findAll(isSpringModule);
}

function applySpringSkip(skip: boolean) {
    for (const s of springs) {
        try { s.Globals.assign({ skipAnimation: skip }); } catch (err) { log.warn("spring skip failed", err); }
    }
}

/* -------------------------------------------------------------------------- */
/*                                  CSS layer                                 */
/* -------------------------------------------------------------------------- */

const CSS_ID = "fastdiscord-css";

function buildCss(): string {
    const s = settings.store;
    let css = "";

    if (s.noGifAvatars) {
        css += `
[class*="listItem"] [class*="avatar"] img[src*=".gif"],
[class*="message"] [class*="avatar"] img[src*=".gif"],
[class*="memberInner"] [class*="avatar"] img[src*=".gif"] {
    content: url("");
}
[class*="listItem"] [class*="avatar"] img,
[class*="message"] [class*="avatar"] img,
[class*="memberInner"] [class*="avatar"] img {
    image-rendering: pixelated;
}
`;
    }

    if (s.noAnimatedEmoji) {
        css += `
[class*="emoji"][class*="animated"],
img[class*="emoji"][src*="gif"] {
    animation: none !important;
}
`;
    }

    if (s.noStickers) {
        css += `
[class*="sticker"][class*="lottie"],
[class*="stickerAsset"][class*="animated"] {
    visibility: hidden !important;
}
`;
    }

    if (s.noActivities) {
        css += `
[class*="activity"],
[class*="activityText"],
[class*="Game"] {
    display: none !important;
}
`;
    }

    if (s.noSoundboardPreview) {
        css += `
[class*="soundboardEmoji"]:hover [class*="soundWave"],
[class*="soundboardEmoji"] [class*="soundWave"] {
    animation: none !important;
    opacity: 0 !important;
}
`;
    }

    if (s.reduceBlurEffects) {
        css += `
[class*="backdropFilter"],
[style*="backdrop-filter"] {
    backdrop-filter: none !important;
}
[class*="acrylic"] {
    background-color: var(--background-secondary) !important;
}
`;
    }

    if (s.disableHoverTransitions) {
        css += `
* {
    transition-duration: 0.001s !important;
}
`;
    }

    return css.trim();
}

function injectCss() {
    const css = buildCss();
    let el = document.getElementById(CSS_ID) as HTMLStyleElement | null;
    if (!css) { el?.remove(); return; }
    if (!el) { el = document.createElement("style"); el.id = CSS_ID; document.head?.appendChild(el); }
    el.textContent = css;
}

function removeCss() {
    document.getElementById(CSS_ID)?.remove();
}

/* -------------------------------------------------------------------------- */
/*                       Background RAF throttle (FPS)                        */
/* -------------------------------------------------------------------------- */

let disposeRAF: (() => void) | null = null;
let disposeCancelRAF: (() => void) | null = null;
let bgFpsActive = false;
const rafMap = new Map<number, ReturnType<typeof setTimeout>>();
let rafSeq = 0;
// Electron's hasFocus() lies on some window managers (e.g. Hyprland), which made the
// throttle engage during real use and drop the whole client to ~10 FPS. Real input
// events are ground truth, so any of them counts as active for a grace period.
let lastRealInput = 0;

function markRealInput() {
    lastRealInput = performance.now();
}

function isClientInUse() {
    return !document.hidden && (
        document.hasFocus()
        || document.documentElement.matches(":hover")
        || performance.now() - lastRealInput < 5000
    );
}

function bgFrameIntervalMs(): number {
    return settings.store.lowEndMode ? 200 : 100;
}

function onVisibilityChange() {
    if (document.hidden) {
        installRafThrottle();
    } else if (document.hasFocus()) {
        uninstallRafThrottle();
    }
}

function onWindowBlur() {
    installRafThrottle();
}

function onWindowFocus() {
    if (!document.hidden) uninstallRafThrottle();
}

function onPointerEnter() {
    if (!document.hidden) uninstallRafThrottle();
}

function onPointerLeave() {
    if (!document.hasFocus()) installRafThrottle();
}

function applyBgFpsPatch(enable: boolean) {
    if (enable && !bgFpsActive) {
        bgFpsActive = true;
        document.addEventListener("visibilitychange", onVisibilityChange);
        document.addEventListener("pointermove", markRealInput, { passive: true, capture: true });
        document.addEventListener("pointerdown", markRealInput, { passive: true, capture: true });
        document.addEventListener("wheel", markRealInput, { passive: true, capture: true });
        document.addEventListener("keydown", markRealInput, { capture: true });
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("focus", onWindowFocus);
        window.addEventListener("pointerenter", onPointerEnter, { passive: true });
        window.addEventListener("pointerleave", onPointerLeave, { passive: true });
        if (document.hidden || !document.hasFocus()) installRafThrottle();
    } else if (!enable && bgFpsActive) {
        bgFpsActive = false;
        document.removeEventListener("visibilitychange", onVisibilityChange);
        document.removeEventListener("pointermove", markRealInput, { capture: true } as any);
        document.removeEventListener("pointerdown", markRealInput, { capture: true } as any);
        document.removeEventListener("wheel", markRealInput, { capture: true } as any);
        document.removeEventListener("keydown", markRealInput, { capture: true });
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("focus", onWindowFocus);
        window.removeEventListener("pointerenter", onPointerEnter);
        window.removeEventListener("pointerleave", onPointerLeave);
        uninstallRafThrottle();
    }
}

function installRafThrottle() {
    if (disposeRAF || !bgFpsActive) return;
    let lastT = 0;

    disposeRAF = RuntimeInterposition.register({
        owner: "FastDiscord",
        hook: "requestAnimationFrame",
        priority: RuntimeInterpositionPriority.BEHAVIOR,
        wrap: next => cb => {
            if (RuntimeInteractions.isActive() || isClientInUse()) return next(cb);
            const id = ++rafSeq;
            const now = performance.now();
            const delay = Math.max(0, bgFrameIntervalMs() - (now - lastT));
            const timer = setTimeout(() => {
                rafMap.delete(id);
                lastT = performance.now();
                cb(performance.now());
            }, delay);
            rafMap.set(id, timer);
            return id;
        }
    });
    disposeCancelRAF = RuntimeInterposition.register({
        owner: "FastDiscord",
        hook: "cancelAnimationFrame",
        priority: RuntimeInterpositionPriority.BEHAVIOR,
        wrap: next => id => {
            const timer = rafMap.get(id);
            if (timer === undefined) return next(id);
            clearTimeout(timer);
            rafMap.delete(id);
        }
    });
}

function uninstallRafThrottle() {
    disposeRAF?.();
    disposeCancelRAF?.();
    disposeRAF = null;
    disposeCancelRAF = null;
    for (const tId of rafMap.values()) clearTimeout(tId);
    rafMap.clear();
}

/* -------------------------------------------------------------------------- */
/*                  Network: debounce presence updates                         */
/* -------------------------------------------------------------------------- */

const PRESENCE_DISPATCH_TYPES = new Set([
    "LOCAL_ACTIVITY_UPDATE",
    "RUNNING_GAMES_CHANGE",
]);

let origFluxDispatch: typeof FluxDispatcher.dispatch | null = null;
let disposeFluxDispatch: (() => void) | null = null;
const pendingPresenceDispatch = new Map<string, { event: any; timer: ReturnType<typeof setTimeout>; }>();

function presenceDebounceMs(): number {
    return 8000;
}

function flushPresenceDispatch(type: string) {
    const pending = pendingPresenceDispatch.get(type);
    if (!pending) return;
    pendingPresenceDispatch.delete(type);
    try {
        origFluxDispatch?.call(FluxDispatcher, pending.event);
    } catch (err) {
        log.warn("flush presence dispatch failed", err);
    }
}

function patchedDispatch(event: any): Promise<void> {
    if (!settings.store.throttlePresence || !event || !PRESENCE_DISPATCH_TYPES.has(event.type)) {
        return origFluxDispatch?.call(FluxDispatcher, event) ?? Promise.resolve();
    }

    const existing = pendingPresenceDispatch.get(event.type);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => flushPresenceDispatch(event.type), presenceDebounceMs());
    pendingPresenceDispatch.set(event.type, { event, timer });
    return Promise.resolve();
}

function applyPresenceThrottle(enable: boolean) {
    if (enable && !disposeFluxDispatch) {
        disposeFluxDispatch = RuntimeInterposition.register({
            owner: "FastDiscord",
            hook: "fluxDispatch",
            priority: RuntimeInterpositionPriority.BEHAVIOR,
            wrap: next => {
                origFluxDispatch = next;
                return patchedDispatch;
            }
        });
    } else if (!enable && origFluxDispatch) {
        for (const type of Array.from(pendingPresenceDispatch.keys())) {
            const pending = pendingPresenceDispatch.get(type)!;
            clearTimeout(pending.timer);
            try { origFluxDispatch.call(FluxDispatcher, pending.event); } catch (err) { log.debug("Ignored error", err); }
        }
        pendingPresenceDispatch.clear();
        disposeFluxDispatch?.();
        disposeFluxDispatch = null;
        origFluxDispatch = null;
    }
}

/* -------------------------------------------------------------------------- */
/*                                  Settings                                  */
/* -------------------------------------------------------------------------- */

const settings = definePluginSettings({
    disableSpringAnimations: {
        type: OptionType.BOOLEAN,
        description: t("تعطيل حركات الزنبرك في الواجهة (الأزرار، النوافذ، الانتقالات)", "Disable spring animations in the UI (buttons, modals, transitions)"),
        default: true,
        disabled: () => isPluginEnabled("DisableAnimations"),
        onChange(val: boolean) {
            if (!started) return;
            if (val && springs.length === 0) loadSprings();
            applySpringSkip(val);
        }
    },
    noGifAvatars: {
        type: OptionType.BOOLEAN,
        description: t("منع صور GIF المتحركة في القوائم والرسائل (عبر CSS)", "Block animated GIF avatars in lists and messages (via CSS)"),
        default: true,
        onChange() { if (started) injectCss(); }
    },
    noAnimatedEmoji: {
        type: OptionType.BOOLEAN,
        description: t("تعطيل حركات إيموجي ديسكورد", "Disable Discord emoji animations"),
        default: false,
        onChange() { if (started) injectCss(); }
    },
    noStickers: {
        type: OptionType.BOOLEAN,
        description: t("منع تشغيل ملصقات Lottie المتحركة تلقائياً", "Prevent Lottie animated stickers from autoplaying"),
        default: false,
        restartNeeded: true
    },
    noActivities: {
        type: OptionType.BOOLEAN,
        description: t("إخفاء قسم الأنشطة (الألعاب، Spotify، إلخ) في لوحة الأعضاء", "Hide the Activities section (games, Spotify, etc.) in the members panel"),
        default: false,
        onChange() { if (started) injectCss(); }
    },
    noVideoAutoplay: {
        type: OptionType.BOOLEAN,
        description: t("منع التشغيل التلقائي للفيديوهات المضمّنة في الرسائل", "Block autoplay of embedded videos in messages"),
        default: false,
        restartNeeded: true
    },
    noSoundboardPreview: {
        type: OptionType.BOOLEAN,
        description: t("تعطيل معاينة صوت لوحة الأصوات عند التمرير", "Disable soundboard audio preview on hover"),
        default: true,
        restartNeeded: true
    },
    reduceBlurEffects: {
        type: OptionType.BOOLEAN,
        description: t("تعطيل تأثيرات الضبابية المكلفة (backdrop-filter) لأداء أفضل", "Disable expensive blur effects (backdrop-filter) for better performance"),
        default: true,
        onChange() { if (started) injectCss(); }
    },
    disableHoverTransitions: {
        type: OptionType.BOOLEAN,
        description: t("جعل كل انتقالات CSS عند التمرير فورية", "Make all CSS hover transitions instant"),
        default: false,
        onChange() { if (started) injectCss(); }
    },
    limitMsgCache: {
        type: OptionType.BOOLEAN,
        description: t("تم تعطيل جمع القمامة القسري لأنه قد يتسبب في توقفات متقطعة", "Disabled because forced garbage collection can cause intermittent pauses"),
        default: false,
        disabled: true
    },
    reduceFpsBackground: {
        type: OptionType.BOOLEAN,
        description: t("تقييد رسم التطبيق لبضعة إطارات عندما تكون النافذة في الخلفية", "Limit app rendering to a few FPS when the window is in the background"),
        default: true,
        onChange(v: boolean) { if (started) applyBgFpsPatch(v); }
    },
    throttlePresence: {
        type: OptionType.BOOLEAN,
        description: t("تقليل تكرار إرسال تحديثات الحضور/النشاط (اللعبة، Spotify) للخادم، مما يوفّر طلبات الشبكة. ستكون حالتك أقل تحديثاً للآخرين.", "Reduce how often presence/activity updates (game, Spotify) are sent to the server, saving network requests. Your status will be less up-to-date for others."),
        default: false,
        onChange(v: boolean) { if (started) applyPresenceThrottle(v); }
    },
    lowEndMode: {
        type: OptionType.BOOLEAN,
        description: t("وضع الأجهزة الضعيفة: إطارات خلفية أقل", "Low-end PC mode: lower background FPS"),
        default: false,
        onChange(_v: boolean) {
            if (!started) return;
            if (bgFpsActive) { applyBgFpsPatch(false); applyBgFpsPatch(true); }
        }
    },
});

/* -------------------------------------------------------------------------- */
/*                                   Plugin                                   */
/* -------------------------------------------------------------------------- */

export default definePlugin({
    name: "FastDiscord",
    description: "Maximizes app smoothness and responsiveness: animations, media, memory cache, background FPS, and network (presence) are all optimized. Disabled by default; everything returns to normal once disabled.",
    authors: [{ name: ">Snayz", id: 1361345963175968779n }],
    tags: ["Utility", "Appearance"],
    searchTerms: ["performance", "optimization", "lag", "fps", "ram", "memory", "low-end", "fluide", "rapide", "latence"],
    settings,

    patches: [
        // The typing-dots patch lived here as a byte-identical copy of the core
        // NoTypingAnimation plugin, guarded by a predicate that already admitted the
        // duplication. On current Discord it produced invalid JS ("Invalid left-hand
        // side in assignment") and the module failed to evaluate, so it was removed —
        // enable NoTypingAnimation for that feature instead.

        // Disable video autoplay — strict regex to avoid touching other modules
        {
            find: "autoplay:!0",
            predicate: () => settings.store.noVideoAutoplay,
            replacement: {
                match: /autoplay:!0/g,
                replace: "autoplay:!1"
            }
        },
        // Disable soundboard preview on hover
        {
            find: "soundboard_sound_hover",
            predicate: () => settings.store.noSoundboardPreview,
            replacement: {
                match: /onMouseEnter:\s*\(\)\s*=>\s*\{[^}]*play[^}]*\}/,
                replace: "onMouseEnter:()=>{}"
            }
        },
        // Disable animated Lottie stickers
        {
            find: /StickerType\.STANDARD/,
            predicate: () => settings.store.noStickers,
            replacement: {
                match: /shouldAnimate:!0/g,
                replace: "shouldAnimate:!1"
            }
        },
    ],

    start() {
        started = true;
        settings.store.limitMsgCache = false;

        if (settings.store.disableSpringAnimations && !isPluginEnabled("DisableAnimations")) {
            loadSprings();
            applySpringSkip(true);
        }

        injectCss();

        if (settings.store.reduceFpsBackground) applyBgFpsPatch(true);
        if (settings.store.throttlePresence) applyPresenceThrottle(true);

        log.info("FastDiscord enabled: applying optimizations.");
    },

    stop() {
        started = false;

        if (springs.length !== 0 && !isPluginEnabled("DisableAnimations")) {
            applySpringSkip(false);
        }
        springs = [];

        removeCss();
        applyBgFpsPatch(false);
        applyPresenceThrottle(false);

        log.info("FastDiscord disabled: everything restored to normal.");
    }
});
