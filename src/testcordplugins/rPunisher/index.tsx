/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { RestAPI, Toasts, UserStore } from "@webpack/common";
// @ts-ignore
import { VoiceState as WebpackVoiceState } from "@webpack/types";
// @ts-ignore
import type { User } from "discord-types/general";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const VoiceChannelUtils = findByPropsLazy("getVoiceChannelId");

const userJoinCounts = new Map<string, number>();
const userTimeouts = new Map<string, NodeJS.Timeout>();
const bannedUsers = new Set<string>();
let banQueue = Promise.resolve();
let lastUserChannelId: string | null = null;

const settings = definePluginSettings({
    isEnabled: {
        description: "Enable automatic banning of users who spam rejoin voice channels",
        type: OptionType.BOOLEAN,
        default: true
    },
    targetChannelId: {
        description: "Target voice channel ID to monitor (leave empty to use current VC)",
        type: OptionType.STRING,
        default: ""
    },
    joinThreshold: {
        description: "Number of joins before triggering ban",
        type: OptionType.NUMBER,
        default: 3,
        min: 2,
        max: 10
    },
    resetTimeMinutes: {
        description: "Minutes before resetting user's join count",
        type: OptionType.NUMBER,
        default: 1,
        min: 1,
        max: 10
    },
    silentDelete: {
        description: "Automatically delete ban/unban command messages",
        type: OptionType.BOOLEAN,
        default: true
    }
});

interface VoiceState {
    guildId?: string;
    channelId?: string;
    oldChannelId?: string;
    user: User;
    userId: string;
}

async function executeBan(channelId: string, userId: string): Promise<void> {
    if (bannedUsers.has(userId)) return;

    const banOperation = banQueue.then(async () => {
        if (bannedUsers.has(userId)) return;

        if (!Vencord.Plugins.plugins.vcOwnerDetector?.settings?.store?.amivcowner) {
            console.warn("Cannot ban user: VC owner permissions not detected");
            return;
        }

        bannedUsers.add(userId);

        Toasts.show({
            message: `Auto-banning user ${userId} for voice channel spam`,
            id: "voice-auto-ban",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });

        try {

            const unbanResponse = await RestAPI.post({
                url: `/channels/${channelId}/messages`,
                body: {
                    content: `!voice-unban ${userId}`,
                    nonce: Math.random().toString(36).substr(2, 9)
                }
            });

            if (settings.store.silentDelete) {
                setTimeout(() => {
                    RestAPI.del({
                        url: `/channels/${channelId}/messages/${unbanResponse.body.id}`
                    }).catch(console.error);
                }, 1500);
            }

            await sleep(1000);

            const banResponse = await RestAPI.post({
                url: `/channels/${channelId}/messages`,
                body: {
                    content: `!voice-ban ${userId}`,
                    nonce: Math.random().toString(36).substr(2, 9)
                }
            });

            if (settings.store.silentDelete) {
                setTimeout(() => {
                    RestAPI.del({
                        url: `/channels/${channelId}/messages/${banResponse.body.id}`
                    }).catch(console.error);
                }, 1500);
            }

            console.log(`Successfully banned user ${userId} for voice channel spam`);

        } catch (error) {
            console.error("Failed to ban user:", error);
            bannedUsers.delete(userId);
        }
    });

    banQueue = banOperation.then(() =>
        sleep(2000)
    );

    await banOperation;
}

function resetUserCount(userId: string): void {
    const currentCount = userJoinCounts.get(userId) || 0;
    if (currentCount <= 1) {
        userJoinCounts.delete(userId);
        const timeout = userTimeouts.get(userId);
        if (timeout) {
            clearTimeout(timeout);
            userTimeouts.delete(userId);
        }
    } else {
        userJoinCounts.set(userId, currentCount - 1);
    }
}

function handleUserVoiceActivity(userId: string, oldChannelId: string): void {
    if (bannedUsers.has(userId)) return;

    const currentCount = userJoinCounts.get(userId) || 0;
    const newCount = currentCount + 1;
    userJoinCounts.set(userId, newCount);

    console.log(`User ${userId} voice activity count: ${newCount}`);

    if (!userTimeouts.has(userId)) {
        const timeout = setTimeout(() => {
            resetUserCount(userId);
        }, settings.store.resetTimeMinutes * 60 * 1000);

        userTimeouts.set(userId, timeout);
    }

    if (newCount >= settings.store.joinThreshold) {
        executeBan(oldChannelId, userId);
    }
}

export default definePlugin({
    name: "retardExterminator",
    description: "Automatically bans users who spam rejoin voice channels",
    tags: ["Servers", "Utility"],
    authors: [TestcordDevs.dot],
    settings,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: WebpackVoiceState[]; }) {
            if (!settings.store.isEnabled) return;

            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!currentUserId) return;

            voiceStates.forEach(state => {
                const { userId, channelId } = state;
                let { oldChannelId } = state;

                if (userId === currentUserId) {
                    if (channelId !== lastUserChannelId) {
                        oldChannelId = lastUserChannelId;
                        lastUserChannelId = channelId;
                    }
                    return;
                }

                const targetChannelId = settings.store.targetChannelId ||
                    VoiceChannelUtils.getVoiceChannelId();

                if (!targetChannelId || oldChannelId !== targetChannelId) return;
                if (oldChannelId === channelId) return;

                if (oldChannelId && !channelId) {
                    handleUserVoiceActivity(userId, oldChannelId);
                }

                else if (oldChannelId && channelId && oldChannelId !== channelId) {
                    handleUserVoiceActivity(userId, oldChannelId);
                }
            });
        }
    },

    stop() {

        userTimeouts.forEach(timeout => clearTimeout(timeout));
        userTimeouts.clear();
        userJoinCounts.clear();
        bannedUsers.clear();
    }
});
