/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Note: Auto-translated
import { definePluginSettings } from "@api/Settings";
import { handleGameModeChange, PluginManagerControls } from "./PluginManager";
// Settings definitions for PerformanceBoost.
export const settings = definePluginSettings({
    // Main toggle: applies runtime optimizations and disables other non-essential plugins.
    // Note: do not name this "enabled" as Settings.plugins[name].enabled is reserved for plugin activation.
    gameMode: {
        type: 3 /* OptionType.BOOLEAN */, default: false,
        description: "Enable performance / game mode (also disables other plugins except essentials and your exceptions; requires a restart)",
        onChange: handleGameModeChange
    },
    // Exceptions button component
    pluginManager: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Choose which plugins stay enabled when performance mode is on.",
        component: PluginManagerControls
    },
    // Comma-separated exceptions list
    pluginKeep: {
        type: 0 /* OptionType.STRING */, default: "", hidden: true,
        description: "Comma-separated plugin names kept enabled (exceptions)."
    },
    // Snapshot of enabled plugins before toggling mode
    pluginSaved: {
        type: 0 /* OptionType.STRING */, default: "", hidden: true,
        description: "JSON snapshot of plugins enabled before disabling the rest, restored when turned off."
    },
    // Auto-detect games option
    autoDetectGames: {
        type: 3 /* OptionType.BOOLEAN */, default: false,
        description: "Automatically enable when a game is detected"
    },
    // Auto high CPU load monitor option
    autoHighLoad: {
        type: 3 /* OptionType.BOOLEAN */, default: false,
        description: "Automatically enable performance mode when Discord's CPU usage stays above the threshold (checks every 30s, desktop only)"
    },
    cpuThreshold: {
        type: 5 /* OptionType.SLIDER */,
        description: "CPU threshold (%) that triggers automatic performance mode (total across Discord processes)",
        markers: [80, 120, 160, 220, 300],
        default: 160,
        stickToMarkers: true
    },
    reduceHardwareAcceleration: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Disable hardware acceleration (requires a Discord restart)"
    },
    // Hardware acceleration change restart prompt option
    autoRestartOnHardwareChange: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Offer to restart Discord so a hardware-acceleration change takes effect"
    },
    disableAnimations: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Disable animations and transitions"
    },
    disableGifAutoplay: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Stop GIFs from autoplaying"
    },
    compactMode: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Use compact message mode"
    },
    hideActivities: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Hide friends' activities (Active Now)"
    },
    changeProcessPriority: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Lower all Discord processes' priority to Below Normal (Windows)"
    },
    cleanCacheOnStart: {
        type: 3 /* OptionType.BOOLEAN */, default: false,
        description: "Clean Discord's cache when game mode starts"
    },
    skipSpringAnimations: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Skip Discord's spring animations for a snappier UI"
    },
    passiveListeners: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Make scroll and touch listeners passive for smoother scrolling"
    },
    lazyImages: {
        type: 3 /* OptionType.BOOLEAN */, default: true,
        description: "Lazy-load and async-decode images to reduce jank"
    },
    clearStoreCaches: {
        type: 3 /* OptionType.BOOLEAN */, default: false,
        description: "Free memory by clearing many Discord caches (messages, emojis, profiles, experiments, and more) when performance mode starts"
    }
});
