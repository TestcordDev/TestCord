/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(function() {
    "use strict";

    // Plugin configuration
    const CONFIG = {
        PLUGIN_NAME: "MullvadDNSCord",
        VERSION: "1.2.0",
        ENABLE_LOGGING: true,
        SHOW_NOTIFICATIONS: true,
        ENABLE_XHR_PATCH: true
    };

    // Mullvad DNS records for Discord services
    const MULLVAD_DNS_RECORDS = {
        // Main Discord services
        "discord.com": "162.159.137.233",
        "gateway.discord.gg": "162.159.135.233",
        "media.discordapp.net": "152.67.79.60",
        "cdn.discordapp.com": "152.67.72.12",

        // Additional services
        "status.discord.com": "104.18.33.247",
        "ptb.discord.com": "162.159.137.233",
        "canary.discord.com": "162.159.137.233",

        // Media and CDN services
        "discordapp.net": "152.67.79.60",
        "images-ext-1.discordapp.net": "152.67.79.60",
        "images-ext-2.discordapp.net": "152.67.79.60"
    };

    // State management
    let originalFetch = null;
    let originalXHR = null;
    let isActive = false;
    const dnsCache = new Map();

    // Logger utility
    const Logger = {
        info: (...args) => console.log(`[%c${CONFIG.PLUGIN_NAME}%c]`, "color: #4CAF50; font-weight: bold", "color: inherit", ...args),
        warn: (...args) => console.warn(`[%c${CONFIG.PLUGIN_NAME}%c]`, "color: #FF9800; font-weight: bold", "color: inherit", ...args),
        error: (...args) => console.error(`[%c${CONFIG.PLUGIN_NAME}%c]`, "color: #F44336; font-weight: bold", "color: inherit", ...args),
        debug: (...args) => CONFIG.ENABLE_LOGGING && console.debug(`[%c${CONFIG.PLUGIN_NAME}%c]`, "color: #2196F3; font-weight: bold", "color: inherit", ...args)
    };

    // Toast notification fallback
    function showToast(message, type = "info") {
        if (!CONFIG.SHOW_NOTIFICATIONS) return;

        try {
            // Try Discord's native toast system first
            if (window.Vencord?.Plugins?.Plugins?.Toasts) {
                const toast = window.Vencord.Plugins.Plugins.Toasts;
                toast.show({
                    message: `🔒 ${message}`,
                    type: type === "success" ? toast.Type.SUCCESS :
                          type === "error" ? toast.Type.FAILURE :
                          toast.Type.MESSAGE,
                    id: Date.now().toString(),
                    options: { position: toast.Position.BOTTOM }
                });
            } else if (window.SnowflakeToastManager) {
                // Alternative toast system
                window.SnowflakeToastManager.show(`🔒 ${message}`, { type });
            } else {
                // Console fallback
                Logger[type](message);
            }
        } catch (e) {
            Logger.debug("Toast system unavailable, using console");
            Logger[type](message);
        }
    }

    // DNS Resolution Functions
    function getDNSRecord(hostname) {
        return MULLVAD_DNS_RECORDS[hostname] || null;
    }

    function isDiscordHostname(hostname) {
        return hostname.includes("discord") && !hostname.includes("mullvad");
    }

    // Network Interception
    function patchFetch() {
        if (originalFetch) {
            Logger.warn("Fetch already patched");
            return true;
        }

        originalFetch = window.fetch;
        if (!originalFetch) {
            Logger.error("Original fetch function not found!");
            return false;
        }

        window.fetch = async function(input, init) {
            try {
                let urlStr = input instanceof Request ? input.url : String(input);
                const url = new URL(urlStr, window.location.origin);

                if (isDiscordHostname(url.hostname)) {
                    const ip = getDNSRecord(url.hostname);

                    if (ip) {
                        dnsCache.set(url.hostname, ip);

                        // Replace hostname with IP
                        url.hostname = ip;
                        urlStr = url.toString();

                        Logger.debug(`🔄 Resolved ${url.hostname} → ${ip} (Mullvad)`);

                        // Show notification for important domains
                        if (["discord.com", "gateway.discord.gg"].includes(url.hostname)) {
                            showToast(`DNS resolved: ${url.hostname} → ${ip}`, "info");
                        }
                    }
                }

                // Create new request with modified URL
                const request = input instanceof Request
                    ? new Request(urlStr, { ...input, ...init })
                    : urlStr;

                return originalFetch.call(this, request, init);

            } catch (error) {
                Logger.error("Fetch patch error:", error);
                return originalFetch.call(this, input, init);
            }
        };

        Logger.info("✅ Fetch patched successfully");
        return true;
    }

    function patchXHR() {
        if (!CONFIG.ENABLE_XHR_PATCH) return true;
        if (originalXHR) {
            Logger.warn("XHR already patched");
            return true;
        }

        originalXHR = window.XMLHttpRequest;
        if (!originalXHR) {
            Logger.error("Original XMLHttpRequest not found!");
            return false;
        }

        window.XMLHttpRequest = function() {
            const xhr = new originalXHR();
            const originalOpen = xhr.open;

            xhr.open = function(method, url, ...args) {
                try {
                    const urlStr = url.toString ? url.toString() : String(url);
                    const urlObj = new URL(urlStr, window.location.origin);

                    if (isDiscordHostname(urlObj.hostname)) {
                        const ip = getDNSRecord(urlObj.hostname);

                        if (ip) {
                            dnsCache.set(urlObj.hostname, ip);
                            urlObj.hostname = ip;

                            Logger.debug(`🔄 XHR Resolved ${urlObj.hostname} → ${ip}`);

                            return originalOpen.call(this, method, urlObj.toString(), ...args);
                        }
                    }

                    return originalOpen.call(this, method, url, ...args);

                } catch (error) {
                    Logger.error("XHR patch error:", error);
                    return originalOpen.call(this, method, url, ...args);
                }
            };

            return xhr;
        };

        Logger.info("✅ XMLHttpRequest patched successfully");
        return true;
    }

    // Restoration Functions
    function restoreFetch() {
        if (originalFetch) {
            window.fetch = originalFetch;
            originalFetch = null;
            Logger.info("🔄 Fetch restored to original");
        }
    }

    function restoreXHR() {
        if (originalXHR) {
            window.XMLHttpRequest = originalXHR;
            originalXHR = null;
            Logger.info("🔄 XMLHttpRequest restored to original");
        }
    }

    // Public API
    const MullvadDNSCord = {
        // Metadata
        name: CONFIG.PLUGIN_NAME,
        version: CONFIG.VERSION,
        isActive: () => isActive,

        // Control Methods
        start() {
            if (isActive) {
                Logger.warn("Plugin is already active!");
                return false;
            }

            try {
                Logger.info(`🚀 Starting ${CONFIG.PLUGIN_NAME} v${CONFIG.VERSION}`);

                const fetchSuccess = patchFetch();
                const xhrSuccess = patchXHR();

                if (fetchSuccess || xhrSuccess) {
                    isActive = true;
                    showToast(`${CONFIG.PLUGIN_NAME} activated - Discord traffic routed through Mullvad DNS`, "success");
                    Logger.info(`✅ Plugin started successfully with ${Object.keys(MULLVAD_DNS_RECORDS).length} DNS records`);
                    return true;
                } else {
                    throw new Error("Failed to patch network functions");
                }

            } catch (error) {
                Logger.error("❌ Failed to start plugin:", error);
                showToast(`${CONFIG.PLUGIN_NAME} failed to start`, "error");
                return false;
            }
        },

        stop() {
            if (!isActive) {
                Logger.warn("Plugin is not active!");
                return false;
            }

            try {
                Logger.info(`🛑 Stopping ${CONFIG.PLUGIN_NAME}`);

                restoreFetch();
                restoreXHR();
                dnsCache.clear();
                isActive = false;

                showToast(`${CONFIG.PLUGIN_NAME} deactivated`, "info");
                Logger.info("✅ Plugin stopped successfully");
                return true;

            } catch (error) {
                Logger.error("❌ Error stopping plugin:", error);
                return false;
            }
        },

        // Utility Methods
        getDNSTable: () => ({ ...MULLVAD_DNS_RECORDS }),

        getCacheStats: () => ({
            cacheSize: dnsCache.size,
            cachedHostnames: Array.from(dnsCache.keys())
        }),

        clearCache: () => {
            const cleared = dnsCache.size;
            dnsCache.clear();
            Logger.info(`🧹 Cleared ${cleared} DNS cache entries`);
            return cleared;
        },

        addCustomRecord: (hostname, ip) => {
            if (typeof hostname === "string" && typeof ip === "string") {
                MULLVAD_DNS_RECORDS[hostname] = ip;
                Logger.info(`➕ Added custom DNS record: ${hostname} → ${ip}`);
                return true;
            }
            Logger.error("Invalid custom record parameters");
            return false;
        },

        removeCustomRecord: hostname => {
            if (Object.prototype.hasOwnProperty.call(MULLVAD_DNS_RECORDS, hostname)) {
                delete MULLVAD_DNS_RECORDS[hostname];
                dnsCache.delete(hostname);
                Logger.info(`➖ Removed DNS record: ${hostname}`);
                return true;
            }
            Logger.warn(`DNS record not found: ${hostname}`);
            return false;
        },

        // Configuration
        getConfig: () => ({ ...CONFIG }),

        setConfig: newConfig => {
            Object.assign(CONFIG, newConfig);
            Logger.info("Configuration updated:", CONFIG);
        }
    };

    // Auto-initialization
    function initialize() {
        // Wait for Discord to load
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", startPlugin);
        } else {
            // Small delay to ensure Discord is fully loaded
            setTimeout(startPlugin, 1000);
        }
    }

    function startPlugin() {
        try {
            // Double-check we're in Discord
            if (!window.DiscordNative && !document.querySelector('[class*="app"]')) {
                Logger.warn("Not running in Discord environment, skipping initialization");
                return;
            }

            MullvadDNSCord.start();

        } catch (error) {
            Logger.error("Initialization error:", error);
        }
    }

    // Expose API globally
    window.MullvadDNSCord = MullvadDNSCord;

    // Cleanup handler
    window.addEventListener("beforeunload", () => {
        if (isActive) {
            MullvadDNSCord.stop();
        }
    });

    // Start the plugin
    initialize();

    Logger.info(`📦 ${CONFIG.PLUGIN_NAME} v${CONFIG.VERSION} loaded and ready`);

    // Return the API for direct usage
    return MullvadDNSCord;

})();
