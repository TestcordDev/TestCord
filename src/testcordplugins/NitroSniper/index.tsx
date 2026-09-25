/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { NavigationRouter, UserStore } from "@webpack/common";

import { markExternalClaim, releaseExternalClaim } from "../autoRedeem/claimFence";

const logger = new Logger("NitroSniper");
const GiftActions = findByPropsLazy("redeemGiftCode");

let startTime = 0;
let claiming = false;
let activeClaim: { code: string; generation: number; } | undefined;
let pluginActive = false;
let generation = 0;
const codeQueue: Array<{ code: string; channelId: string; guildId?: string; messageId: string; }> = [];

const settings = definePluginSettings({
    notifyOnRedeem: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show a notification when successfully redeeming a nitro code."
    },
    notifyOnFail: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show a notification when failing to redeem a nitro code."
    }
});

function processQueue() {
    if (isPluginEnabled("AutoRedeem")) return;
    if (!pluginActive || claiming || activeClaim || !codeQueue.length) return;

    claiming = true;
    const claimGeneration = generation;
    const { code, channelId, guildId, messageId } = codeQueue.shift()!;
    activeClaim = { code, generation: claimGeneration };
    markExternalClaim(code);
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        if (activeClaim?.generation === claimGeneration) {
            releaseExternalClaim(code);
            activeClaim = undefined;
        }
        claiming = false;
        if (pluginActive) processQueue();
    };

    logger.log(`Attempting to redeem code: ${code} (channel: ${channelId}, guild: ${guildId ?? "dm"})`);

    try {
        GiftActions.redeemGiftCode({
            code,
            onRedeemed: (gift: any) => {
                try {
                    if (!pluginActive || claimGeneration !== generation) return;
                    logger.log(`Successfully redeemed code: ${code} (channel: ${channelId}, guild: ${guildId ?? "dm"})`);

                    if (settings.store.notifyOnRedeem) {
                        const user = UserStore.getCurrentUser();
                        const giftType = gift?.subscription_plan?.name || "Nitro";

                        showNotification({
                            title: "Nitro Sniped! 🎉",
                            body: `Successfully redeemed ${giftType} code`,
                            color: "#5865F2",
                            icon: user.getAvatarURL(),
                            onClick: () => {
                                NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/${messageId}`);
                            }
                        });
                    }
                } finally {
                    finish();
                }
            },

            onError: (err: Error) => {
                try {
                    if (!pluginActive || claimGeneration !== generation) return;
                    logger.error(`Failed to redeem code: ${code} (channel: ${channelId}, guild: ${guildId ?? "dm"})`, err);

                    if (settings.store.notifyOnFail) {
                        const user = UserStore.getCurrentUser();

                        showNotification({
                            title: "Nitro Redeem Failed ❌",
                            body: `Failed to redeem code: ${code}`,
                            color: "#ED4245",
                            icon: user.getAvatarURL(),
                            onClick: () => {
                                NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/${messageId}`);
                            }
                        });
                    }
                } finally {
                    finish();
                }
            }
        });
    } catch (error) {
        logger.error(`Failed to start redeeming code: ${code}`, error);
        finish();
    }
}

export default definePlugin({
    name: "NitroSniper",
    description: "Automatically redeems Nitro gift links sent in chat",
    tags: ["Utility"],
    authors: [
        { name: "neoarz", id: 1015372540937502851n },
        { name: "irritably", id: 928787166916640838n }
    ],

    settings,

    start() {
        pluginActive = true;
        generation++;
        startTime = Date.now();
        if (!isPluginEnabled("AutoRedeem")) codeQueue.length = 0;
        claiming = false;
    },

    stop() {
        pluginActive = false;
        generation++;
        if (!isPluginEnabled("AutoRedeem")) codeQueue.length = 0;
        claiming = false;
    },

    flux: {
        MESSAGE_CREATE({ message }) {
            if (isPluginEnabled("AutoRedeem")) return;
            if (!message.content) return;

            if (!message.content.includes("discord.gift") && !message.content.includes("discord.com/gift")) return;
            const match = message.content.match(/(?:discord\.gift\/|discord\.com\/gifts?\/)([a-zA-Z0-9]{16,24})/);
            if (!match) return;

            if (new Date(message.timestamp).getTime() < startTime) return;

            if (codeQueue.length < 50) {
                codeQueue.push({
                    code: match[1],
                    channelId: message.channel_id,
                    guildId: message.guild_id,
                    messageId: message.id
                });
            }
            processQueue();
        }
    }
});
