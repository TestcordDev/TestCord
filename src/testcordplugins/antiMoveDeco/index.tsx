/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, React, Toasts, UserStore } from "@webpack/common";

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

function AntiMoveDecoIcon({ className, enabled }: { className?: string; enabled: boolean; }) {
    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: enabled ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <mask id="antiMoveDecoLine">
                <rect width="100%" height="100%" fill="#ffffff" />
                <line
                    className="blackLine"
                    x1="22"
                    y1="2"
                    x2="2"
                    y2="22"
                    stroke="#000000"
                    strokeWidth="6"
                    strokeLinecap="round"
                    style={lineStyle}
                />
            </mask>

            <g mask="url(#antiMoveDecoLine)">
                <path
                    fill={!enabled ? "var(--status-danger)" : "currentColor"}
                    d="M2 7.4A5.4 5.4 0 0 1 7.4 2c.36 0 .7.22.83.55l1.93 4.64a1 1 0 0 1-.43 1.25L7 10a8.52 8.52 0 0 0 7 7l1.12-2.24a1 1 0 0 1 1.19-.51l5.06 1.56c.38.11.63.46.63.85C22 19.6 19.6 22 16.66 22h-.37C8.39 22 2 15.6 2 7.71V7.4ZM13 3a1 1 0 0 1 1-1 8 8 0 0 1 8 8 1 1 0 1 1-2 0 6 6 0 0 0-6-6 1 1 0 0 1-1-1Z"
                />
                <path
                    fill={!enabled ? "var(--status-danger)" : "currentColor"}
                    d="M13 7a1 1 0 0 1 1-1 4 4 0 0 1 4 4 1 1 0 1 1-2 0 2 2 0 0 0-2-2 1 1 0 0 1-1-1Z"
                />
            </g>

            <line
                x1="22"
                y1="2"
                x2="2"
                y2="22"
                stroke="var(--status-danger, currentColor)"
                strokeWidth="2"
                strokeLinecap="round"
                style={lineStyle}
            />
        </svg>
    );
}

function AntiMoveDecoButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
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

        Toasts.show({
            message: enabled ? "Anti Move Deco Enabled" : "Anti Move Deco Disabled",
            id: "AntiMoveDecoToast",
            type: Toasts.Type.MESSAGE
        });

        forceUpdate();
    };

    return (
        <UserAreaButton
            onClick={toggle}
            role="switch"
            redGlow={!enabled}
            aria-checked={enabled}
            plated={nameplate != null}
            className="button__201d5 wrapper__201d5"
            tooltipText={hideTooltips ? void 0 : enabled ? "Disable AntiMove&Deco" : "Enable AntiMove&Deco"}
            icon={<AntiMoveDecoIcon enabled={enabled} className={iconForeground} />}
        />
    );
}

export default definePlugin({
    name: "AntiMoveDeco",
    description: "Adds a button to prevent being moved or disconnected from a voice channel.",
    tags: ["Voice", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],

    userAreaButton: {
        icon: () => <AntiMoveDecoIcon enabled={enabled} />,
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
