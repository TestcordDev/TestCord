/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ==UserScript==
// @name         MullvadDNSCord
// @namespace    https://github.com/
// @version      1.2.0
// @description  Force Discord to use Mullvad VPN DNS servers for enhanced privacy
// @author       Irritably
// @match        *://*.discord.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/*
 * MullvadDNSCord Userscript Version
 * Forces Discord web client to use Mullvad VPN DNS servers
 */

(function() {
    "use strict";

    const PLUGIN_INFO = {
        name: "MullvadDNSCord",
        version: "1.2.0"
    };

    // Mullvad DNS records
    const DNS_RECORDS = {
        "discord.com": "162.159.137.233",
        "gateway.discord.gg": "162.159.135.233",
        "media.discordapp.net": "152.67.79.60",
        "cdn.discordapp.com": "152.67.72.12",
        "status.discord.com": "104.18.33.247",
        "ptb.discord.com": "162.159.137.233",
        "canary.discord.com": "162.159.137.233"
    };

    const originalFetch = window.fetch;
    let isActive = false;

    // Simple logger
    const log = {
        info: (...args) => console.log(`[${PLUGIN_INFO.name}]`, ...args),
        debug: (...args) => console.debug(`[${PLUGIN_INFO.name}]`, ...args),
        error: (...args) => console.error(`[${PLUGIN_INFO.name}]`, ...args)
    };

    function patchFetch() {
        if (!originalFetch) return false;

        window.fetch = async function(input, init) {
            try {
                let urlStr = input instanceof Request ? input.url : String(input);
                const url = new URL(urlStr);

                // Check if it's a Discord domain (excluding Mullvad IPs to prevent recursion)
                if (url.hostname.includes("discord") && !Object.values(DNS_RECORDS).includes(url.hostname)) {
                    const ip = DNS_RECORDS[url.hostname];
                    if (ip) {
                        url.hostname = ip;
                        urlStr = url.toString();
                        log.debug(`Resolved ${url.hostname} → ${ip}`);
                    }
                }

                const request = input instanceof Request
                    ? new Request(urlStr, { ...input, ...init })
                    : urlStr;

                return originalFetch.call(this, request, init);

            } catch (error) {
                log.error("Fetch error:", error);
                return originalFetch.call(this, input, init);
            }
        };

        return true;
    }

    function start() {
        if (isActive) return;

        try {
            if (patchFetch()) {
                isActive = true;
                log.info(`Started v${PLUGIN_INFO.version} - Routing Discord traffic through Mullvad DNS`);
            }
        } catch (error) {
            log.error("Failed to start:", error);
        }
    }

    // Start automatically
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        setTimeout(start, 1000);
    }

    // Expose for manual control
    window.MullvadDNSCord = {
        start,
        isActive: () => isActive,
        getRecords: () => ({ ...DNS_RECORDS })
    };

    log.info(`Loaded ${PLUGIN_INFO.name} v${PLUGIN_INFO.version}`);

})();
