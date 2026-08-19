/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import definePlugin from "@utils/types";
export default definePlugin({
    name: "OverlayFix",
    description: "Attempts to fix the overlay by tricking Discord about the process name (pretends to be discord.exe).",
    tags: ["Performance", "Voice", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    cannotBeDisabled: false,
    enabledByDefault: false,
    requiresRestart: true,
    _originalNative: undefined,
    start() {
        try {
            if (typeof window.DiscordNative !== "undefined") {
                const originalNative = window.DiscordNative;
                this._originalNative = originalNative;
                // Try to redefine the property on window safely
                try {
                    const proxy = new Proxy(originalNative, {
                        get(target, prop) {
                            const value = target[prop];
                            if (prop === "processUtils" && value) {
                                return new Proxy(value, {
                                    get(pTarget, pProp) {
                                        const pValue = pTarget[pProp];
                                        if (pProp === "getMainArgv" && typeof pValue === "function") {
                                            return (...args) => {
                                                const argv = pValue.apply(pTarget, args);
                                                if (Array.isArray(argv) && argv[0]) {
                                                    argv[0] = argv[0].replace(/nightcord\.exe/i, "discord.exe");
                                                }
                                                return argv;
                                            };
                                        }
                                        return typeof pValue === "function" ? pValue.bind(pTarget) : pValue;
                                    }
                                });
                            }
                            return typeof value === "function" ? value.bind(target) : value;
                        }
                    });
                    // Attempt replacement via defineProperty if direct assignment fails
                    Object.defineProperty(window, "DiscordNative", {
                        value: proxy,
                        configurable: true,
                        enumerable: true,
                        writable: true
                    });
                    console.log("[OverlayFix] Process name spoofing active via defineProperty Proxy");
                }
                catch (e) {
                    console.warn("[OverlayFix] Could not redefine DiscordNative on window, attempting sub-property patch...");
                    // If we can't replace the entire object, try to patch its internal properties
                    // Note: This may also fail if the object is frozen, but it's our last native chance
                }
            }
        }
        catch (e) {
            console.error("[OverlayFix] Failed to setup spoofing:", e);
        }
    },
    stop() {
        try {
            if (this._originalNative !== undefined) {
                Object.defineProperty(window, "DiscordNative", {
                    value: this._originalNative,
                    configurable: true,
                    enumerable: true,
                    writable: true
                });
                this._originalNative = undefined;
            }
        }
        catch (e) {
            console.error("[OverlayFix] Failed to restore DiscordNative:", e);
        }
    },
    patches: [
        {
            // Patch to force overlay module installation if Discord hesitates
            find: "window.DiscordNative.nativeModules.install",
            replacement: {
                match: /"discord_desktop_overlay"/,
                replace: "\"discord_desktop_overlay\", {force: true}"
            }
        }
    ]
});
