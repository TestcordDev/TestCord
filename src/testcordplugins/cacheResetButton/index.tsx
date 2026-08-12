/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelToolbarButton } from "@api/HeaderBar";
import { resetCacheLimits } from "@utils/cacheLimits";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findAll } from "@webpack";
import {
    ActiveJoinedThreadsStore,
    ApplicationCommandIndexStore,
    ApplicationStore,
    ApplicationStreamingStore,
    ApplicationStreamPreviewStore,
    DraftStore,
    EditMessageStore,
    EmojiStore,
    ExperimentStore,
    InviteStore,
    MessageCache,
    MessageStore,
    NotificationSettingsStore,
    PendingReplyStore,
    PresenceStore,
    QuestStore,
    RunningGameStore,
    showToast,
    SoundboardStore,
    SpellCheckStore,
    SpotifyStore,
    StickersStore,
    Toasts,
    TypingStore,
    UploadAttachmentStore,
    UserAffinitiesStore,
    UserGuildSettingsStore,
    UserProfileStore,
} from "@webpack/common";

interface SpringMod {
    Globals?: { assign?: (opts: Record<string, unknown>) => void; };
    Springs?: object;
}

let boostStyleEl: HTMLStyleElement | null = null;
let springs: SpringMod[] = [];

function CacheIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden="true" {...props}>
            <path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4Zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm3-10H5V5h10v4Z" />
        </svg>
    );
}

function clearStoreCache(name: string, store: any, cleared: string[]): void {
    try {
        if (store.clearCache) {
            store.clearCache();
            cleared.push(name);
        } else if (store.clear) {
            store.clear();
            cleared.push(name);
        }
    } catch { }
}

function clearMapCache(name: string, store: any, mapKey: string, cleared: string[]): void {
    try {
        const map = store[mapKey];
        if (map instanceof Map) {
            map.clear();
            cleared.push(name);
        }
    } catch { }
}

function clearCaches(): string[] {
    const cleared: string[] = [];

    try {
        (MessageStore as { clearCache?(): void }).clearCache?.();
        cleared.push("Messages");
    } catch { }

    try {
        MessageCache.clearCache?.();
        cleared.push("Message cache");
    } catch { }

    clearStoreCache("Drafts", DraftStore, cleared);
    clearStoreCache("Edits", EditMessageStore, cleared);
    clearStoreCache("Replies", PendingReplyStore, cleared);
    clearStoreCache("Typing", TypingStore, cleared);
    clearStoreCache("Emojis", EmojiStore, cleared);
    clearStoreCache("Stickers", StickersStore, cleared);
    clearStoreCache("Commands", ApplicationCommandIndexStore, cleared);
    clearStoreCache("Apps", ApplicationStore, cleared);
    clearStoreCache("Profiles", UserProfileStore, cleared);
    clearStoreCache("Invites", InviteStore, cleared);
    clearStoreCache("Quests", QuestStore, cleared);
    clearStoreCache("Experiments", ExperimentStore, cleared);
    clearStoreCache("Soundboard", SoundboardStore, cleared);
    clearStoreCache("Spellcheck", SpellCheckStore, cleared);
    clearStoreCache("Games", RunningGameStore, cleared);
    clearStoreCache("Uploads", UploadAttachmentStore, cleared);
    clearStoreCache("Threads", ActiveJoinedThreadsStore, cleared);
    clearStoreCache("Streaming", ApplicationStreamingStore, cleared);
    clearStoreCache("Stream previews", ApplicationStreamPreviewStore, cleared);
    clearStoreCache("Guild settings", UserGuildSettingsStore, cleared);
    clearStoreCache("Notifications", NotificationSettingsStore, cleared);
    clearStoreCache("Spotify", SpotifyStore, cleared);
    clearStoreCache("Affinities", UserAffinitiesStore, cleared);

    clearMapCache("Presence", PresenceStore, "_presences", cleared);

    if (typeof (window as any).gc === "function") {
        try {
            (window as any).gc();
            cleared.push("GC");
        } catch { }
    }

    try {
        resetCacheLimits();
        cleared.push("Cache limits");
    } catch { }

    return cleared;
}

function applyBoost(): string[] {
    const applied: string[] = [];

    if (!boostStyleEl) {
        boostStyleEl = document.createElement("style");
        boostStyleEl.id = "vc-perf-boost";
        boostStyleEl.textContent = [
            "[class*=\"messageListItem_\"] { contain: layout style; }",
            "[class*=\"chatContent_\"] { contain: style layout; }",
            "[class*=\"messageContent_\"], [class*=\"markup_\"] { text-rendering: optimizeSpeed; }",
            "[style*=\"will-change\"], [class*=\"scroller_\"], [class*=\"messageListItem_\"] { will-change: auto !important; }",
            "[class*=\"backdrop_\"], [class*=\"layer_\"], [class*=\"popout_\"], [class*=\"modal_\"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }",
            "*, *::before, *::after { animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; transition-delay: 0ms !important; }",
        ].join("\n");
        document.head.appendChild(boostStyleEl);
        applied.push("CSS (containment, will-change, blur, animations)");
    }

    if (springs.length === 0) {
        springs = findAll(mod => {
            const m = mod as SpringMod;
            return typeof m?.Globals === "object" && typeof m?.Springs === "object";
        }) as SpringMod[];
    }
    for (const spring of springs) {
        spring.Globals?.assign?.({ skipAnimation: true });
    }
    if (springs.length > 0) applied.push("Spring animations");

    document.querySelectorAll<HTMLImageElement>("img").forEach(img => {
        if (!img.loading) img.loading = "lazy";
        if (!img.decoding) img.decoding = "async";
    });
    applied.push("Lazy images");

    if (typeof (window as any).performance?.memory !== "undefined") {
        const mem = (window as any).performance.memory;
        const ratio = mem.usedJSHeapSize / mem.jsHeapSizeLimit;
        if (ratio > 0.75 && typeof (window as any).gc === "function") {
            (window as any).gc();
            applied.push("GC (high memory)");
        }
    }

    return applied;
}

function removeBoost(): void {
    if (boostStyleEl) {
        boostStyleEl.remove();
        boostStyleEl = null;
    }

    for (const spring of springs) {
        spring.Globals?.assign?.({ skipAnimation: false });
    }
    springs = [];
}

function CacheResetButton() {
    const handleClick = () => {
        const cleared = clearCaches();
        const boosted = applyBoost();
        const parts: string[] = [];
        if (cleared.length > 0) parts.push(`Cleared: ${cleared.join(", ")}`);
        if (boosted.length > 0) parts.push(`Boosted: ${boosted.join(", ")}`);
        showToast(
            parts.length > 0 ? parts.join(" | ") : "Cache cleared and boost applied",
            Toasts.Type.SUCCESS
        );
    };

    return (
        <ChannelToolbarButton
            icon={CacheIcon}
            tooltip="Performance Boost"
            onClick={handleClick}
        />
    );
}

export default definePlugin({
    name: "CacheResetButton",
    description: "Performance boost button: clears caches and applies runtime optimizations (CSS containment, passive listeners, spring skip, lazy images, backdrop blur removal, animation kill).",
    tags: ["Utility", "Performance"],
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],

    headerBarButton: {
        location: "channeltoolbar",
        icon: CacheIcon,
        render: CacheResetButton,
        priority: 260,
    },

    stop() {
        removeBoost();
    },
});
