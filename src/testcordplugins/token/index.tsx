/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";

const UserStore = findByPropsLazy("getCurrentUser", "getUser");
const TokenStore = findByPropsLazy("getToken");

function getCurrentToken(): string | null {
    try {
        return TokenStore?.getToken?.() ?? null;
    } catch {
        return null;
    }
}

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "activates the command /mytoken",
        default: true
    },
    showInDMs: {
        type: OptionType.BOOLEAN,
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
            inputType: ApplicationCommandInputType.BUILT_IN,
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
                } catch (error) {
                    console.error("error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: "error when gettin token i think."
                    });
                }
            }
        }
    ]
});
