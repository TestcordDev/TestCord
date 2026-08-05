/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserAreaButton } from "@api/UserArea";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, React, UserStore } from "@webpack/common";

// Webpack Modules
const ChannelActions = findByPropsLazy("selectVoiceChannel", "disconnect");
const SelectedChannelStore = findByPropsLazy("getVoiceChannelId", "getChannelId");

let enabled = false;
let targetChannelId: string | null = null;

function onVoiceStateUpdate({ voiceStates }: { voiceStates: any[]; }) {
    if (!enabled || !targetChannelId) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;
    const myId = currentUser.id;

    // Check if my state changed in this update
    const myState = voiceStates.find(s => s.userId === myId);

    // If there's an update concerning me
    if (myState) {
        // If the new channelId is different from the one we're protecting (or null if disconnected)
        if (myState.channelId !== targetChannelId) {
            console.log(`[AntiMoveDeco] Movement or disconnect detected! Returning to channel ${targetChannelId}...`);

            // Small delay to let Discord finish its clean disconnection before reconnecting
            setTimeout(() => {
                if (enabled && targetChannelId) {
                    try {
                        ChannelActions?.selectVoiceChannel?.(targetChannelId);
                    } catch (e) {
                        console.error("[AntiMoveDeco] Error while reconnecting:", e);
                    }
                }
            }, 500);
        }
    }
}

function AntiMoveDecoIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke="currentColor" strokeWidth="2.5" />
        </svg>
    );
}

function AntiMoveDecoButton() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const toggle = () => {
        if (!enabled) {
            const channelId = SelectedChannelStore?.getVoiceChannelId?.();
            if (!channelId) {
                // Not in voice, cannot activate
                return;
            }
            targetChannelId = channelId;
            enabled = true;
            console.log(`[AntiMoveDeco] Enabled. Protected channel: ${targetChannelId}`);
        } else {
            enabled = false;
            targetChannelId = null;
            console.log("[AntiMoveDeco] Disabled.");
        }
        forceUpdate();
    };

    return (
        <UserAreaButton
            onClick={toggle}
            aria-checked={enabled}
            role="switch"
            tooltipText={enabled ? "Disable AntiMove&Deco" : "Enable AntiMove&Deco"}
            icon={<AntiMoveDecoIcon/>}
        />
    );
}

export default definePlugin({
    name: "AntiMoveDeco",
    description: "Adds a button to prevent being moved or disconnected from a voice channel.",
    tags: ["Voice", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],

    userAreaButton: {
        icon: () => <AntiMoveDecoIcon/>,
        render: AntiMoveDecoButton
    },

    start() {
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", onVoiceStateUpdate);
    },
    stop() {
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", onVoiceStateUpdate);
        enabled = false;
        targetChannelId = null;
    }
});
