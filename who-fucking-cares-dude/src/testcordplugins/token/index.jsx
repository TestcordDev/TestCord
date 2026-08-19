/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
const UserStore = findByPropsLazy("getCurrentUser", "getUser");
const settings = definePluginSettings({
    enabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "activates the command /mytoken",
        default: true
    },
    showInDMs: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "does the token show in dms or not",
        default: true
    }
});
export default definePlugin({
    name: "Token Display",
    description: "shows ur token with the command: /mytoken",
    tags: ["Privacy", "Developers"],
    authors: [TestcordDevs.x2b],
    dependencies: ["CommandsAPI"],
    settings,
    start() {
        console.log("mytoken plugin started");
    },
    stop() {
        console.log("mytoken plugin disabled");
    },
    commands: [
        {
            name: "mytoken",
            description: "shows ur token (do not share with anyone)",
            inputType: 0 /* ApplicationCommandInputType.BUILT_IN */,
            options: [],
            execute: async (opts, ctx) => {
                console.log("executed the /mytoken command");
                if (!settings.store.enabled) {
                    console.log("token display deactivated");
                    sendBotMessage(ctx.channel.id, {
                        content: "the command is deactivated lil vro"
                    });
                    return;
                }
                // Check if we're in a DM and if it's allowed
                if (!ctx.guild && !settings.store.showInDMs) {
                    console.log("command is not turned on in dms");
                    sendBotMessage(ctx.channel.id, {
                        content: "cant send ts in a dm lil vro."
                    });
                    return;
                }
                try {
                    console.log("tryna get ur token");
                    // Retrieve the token
                    const token = getCurrentToken();
                    if (!token) {
                        console.log("cant get no token");
                        sendBotMessage(ctx.channel.id, {
                            content: "impossible to get da token vro"
                        });
                        return;
                    }
                    console.log("success, got ur token");
                    // Retrieve the current user's information
                    const currentUser = UserStore.getCurrentUser();
                    const username = currentUser ? `${currentUser.username}#${currentUser.discriminator}` : "utilities i think, idk french";
                    sendBotMessage(ctx.channel.id, {
                        content: `🔑 **Token of: ${username}:**\n\`\`\`\n${token}\n\`\`\`\n⚠️ **Attention:** this token can be used to access ${username}'s account!`
                    });
                }
                catch (error) {
                    console.error("error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: "error when gettin token i think."
                    });
                }
            }
        }
    ]
});
function getCurrentToken() {
    console.log("[Token Display] Beginning token retrieval");
    try {
        // Method 1: Try to retrieve the token from localStorage (if available)
        if (typeof window !== "undefined" && window.localStorage) {
            console.log("[Token Display] Attempting via localStorage");
            const token = window.localStorage.getItem("token");
            if (token) {
                console.log("[Token Display] Token found in localStorage");
                // Clean the token (remove quotes if present)
                return token.replace(/^"(.*)"$/, "$1");
            }
        }
        // Method 2: Try to retrieve the token via webpack modules
        if (typeof window !== "undefined" && window.webpackChunkdiscord_app) {
            console.log("[Token Display] Attempting via webpack modules");
            const modules = window.webpackChunkdiscord_app;
            for (const chunk of modules) {
                if (chunk[1]) {
                    for (const moduleId in chunk[1]) {
                        const module = chunk[1][moduleId];
                        if (module && module.exports) {
                            // Look for getToken methods
                            if (module.exports.getToken && typeof module.exports.getToken === "function") {
                                try {
                                    const token = module.exports.getToken();
                                    if (token && typeof token === "string") {
                                        console.log("[Token Display] Token found via webpack getToken");
                                        return token;
                                    }
                                }
                                catch (e) {
                                    // Ignore errors
                                }
                            }
                            // Look in default exports
                            if (module.exports.default && module.exports.default.getToken) {
                                try {
                                    const token = module.exports.default.getToken();
                                    if (token && typeof token === "string") {
                                        console.log("[Token Display] Token found via webpack default.getToken");
                                        return token;
                                    }
                                }
                                catch (e) {
                                    // Ignore errors
                                }
                            }
                        }
                    }
                }
            }
        }
        // Method 3: Try to retrieve the token via the Discord API
        try {
            console.log("[Token Display] Attempting via findByPropsLazy");
            // Look in Vencord modules for token retrieval methods
            const { getToken } = findByPropsLazy("getToken");
            if (getToken && typeof getToken === "function") {
                const token = getToken();
                if (token && typeof token === "string") {
                    console.log("[Token Display] Token found via findByPropsLazy");
                    return token;
                }
            }
        }
        catch (e) {
            console.log("[Token Display] findByPropsLazy failed:", e);
        }
        // Method 4: Try to retrieve the token via request headers
        try {
            console.log("[Token Display] Attempting via fetch interception");
            // Guard against re-entry: if a wrapper is already installed, don't
            // capture it as "original" (that would leave fetch permanently wrapped
            // when the two pending restores race).
            if (!window.fetch._tokenDisplayPatched) {
                const originalFetch = window.fetch;
                const wrapped = function (input, init) {
                    return originalFetch.call(this, input, init);
                };
                wrapped._tokenDisplayPatched = true;
                window.fetch = wrapped;
                // Restore fetch after a short delay, but only if our wrapper is
                // still the active one.
                setTimeout(() => {
                    if (window.fetch._tokenDisplayPatched) {
                        window.fetch = originalFetch;
                    }
                }, 100);
            }
        }
        catch (e) {
            console.log("[Token Display] Fetch interception failed:", e);
        }
        console.log("[Token Display] No method worked");
        return null;
    }
    catch (error) {
        console.error("[Token Display] Error during token retrieval:", error);
        return null;
    }
}
