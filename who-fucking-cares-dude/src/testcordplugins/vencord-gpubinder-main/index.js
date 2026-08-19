/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { Toasts } from "@webpack/common";
const settings = definePluginSettings({
    gpuPreference: {
        type: 4 /* OptionType.SELECT */,
        description: "Choose which GPU Discord should prioritize. This fixes the issue where Windows 'forgets' your settings after a Discord update.",
        default: 2,
        options: [
            { label: "High Performance (Discrete GPU)", value: 2 },
            { label: "Power Saving (Integrated GPU)", value: 1 },
            { label: "System Default (Let Windows decide)", value: 0 },
        ],
        onChange: async (newValue) => {
            const Native = window.VencordNative?.pluginHelpers?.GpuBinder;
            if (!Native)
                return;
            try {
                const wasChanged = await Native.applyGpuPreference(Number(newValue));
                if (wasChanged) {
                    Toasts.show({
                        message: "GPU preference updated in Windows Registry!",
                        type: Toasts.Type.SUCCESS,
                    });
                }
            }
            catch (err) {
                console.error("[GpuBinder] Failed to update GPU preference:", err);
            }
        },
    },
});
export default definePlugin({
    name: "GpuBinder",
    description: "Forces Discord to stay bound to a specific GPU even after updates by managing Windows Registry keys.",
    tags: ["Utility", "Developers"],
    authors: [{ name: "unclide", id: 395504896817758210n }],
    // Safety check: registry access is only possible on Desktop
    desktopOnly: true,
    settings,
    async start() {
        // Only run on Windows
        if (process.platform !== "win32")
            return;
        const Native = window.VencordNative?.pluginHelpers?.GpuBinder;
        if (!Native) {
            console.warn("[GpuBinder] Native helper not found. Registry sync skipped.");
            return;
        }
        try {
            const currentPref = settings.store.gpuPreference;
            // Apply settings on startup to ensure the new app-1.x.xxxx path is registered
            const applied = await Native.applyGpuPreference(currentPref);
            if (applied) {
                console.log("[GpuBinder] New Discord version detected. Registry path updated.");
            }
        }
        catch (err) {
            console.error("[GpuBinder] Startup sync error:", err);
        }
    },
});
