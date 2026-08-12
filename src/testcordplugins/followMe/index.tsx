/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, Constants,Menu, PermissionsBits, PermissionStore, React, RestAPI, Toasts, useEffect, UserStore, useState } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");

const DS_KEY = "followme-target-v1";

// ── Global state ──────────────────────────────────────────────────────────────
let targetId: string | null = null;
let targetName: string = "";

const listeners = new Set<() => void>();
function notifyAll() { listeners.forEach(fn => fn()); }

function useFollowMeId(): string | null {
    const [, tick] = useState(0);
    useEffect(() => {
        const fn = () => tick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return targetId;
}

async function persist() {
    await DataStore.set(DS_KEY, targetId ? { id: targetId, name: targetName } : null);
}

async function moveTargetTo(guildId: string, channelId: string) {
    if (!targetId || !guildId || !channelId) return;

    const targetState = VoiceStateStore.getVoiceStateForUser(targetId);
    if (!targetState) return;

    if (targetState.channelId === channelId) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;
    const canMove = PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel);

    if (!canMove) return;

    try {
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(guildId, targetId),
            body: { channel_id: channelId }
        });
    } catch (e) {
        console.error("[FollowMe] Failed to move user:", e);
    }
}

function followMe(userId: string) {
    if (targetId === userId) return;
    const user = UserStore?.getUser?.(userId);
    targetId = userId;
    targetName = user?.globalName ?? user?.username ?? userId;

    const myId = UserStore.getCurrentUser()?.id;
    const myState = VoiceStateStore.getVoiceStateForUser(myId);
    if (myState?.channelId && myState.guildId) {
        moveTargetTo(myState.guildId, myState.channelId);
    }

    notifyAll();
    persist().catch(() => { });
    Toasts.show({ message: `Following Me: ${targetName} 🏃‍♂️`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
}

function unfollowMe() {
    const name = targetName;
    targetId = null; targetName = "";
    notifyAll();
    persist().catch(() => { });
    Toasts.show({ message: `Stopped forcing ${name} to follow`, type: Toasts.Type.MESSAGE, id: Toasts.genId() });
}

// ── Icon ──
function FollowMeIcon({ filled = false }: { filled?: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path
                fill={filled ? "#3ba55d" : "currentColor"}
                d="M15,10V5H13V10.5C13,10.78 13.22,11 13.5,11H18V9H15.5L18.41,6.09L17,4.68L14.09,7.59V5H12V11A1,1 0 0,0 13,12H19A1,1 0 0,0 20,11V5A1,1 0 0,0 19,4H13V2H19A3,3 0 0,1 22,5V11A3,3 0 0,1 19,14H13.81L14.41,15.79L12.5,16.41L11.5,13.5C11.31,12.92 10.77,12.5 10.16,12.5H6.5A1,1 0 0,0 5.5,13.5V20.5A1,1 0 0,0 6.5,21.5H9.5V23.5H6.5A3,3 0 0,1 3.5,20.5V13.5A3,3 0 0,1 6.5,10.5H9.5V7A3,3 0 0,1 12.5,4H13V2H12.5A5,5 0 0,0 7.5,7V10.5H6.5A5,5 0 0,0 1.5,15.5V20.5A5,5 0 0,0 6.5,25.5H9.5V23.5H6.5A3,3 0 0,1 3.5,20.5V15.5A3,3 0 0,1 6.5,12.5H7.5V15.5A1,1 0 0,0 8.5,16.5H11.5L12.5,19.41L14.41,17.5L12,15.09V13.41L15.09,16.5L17,14.59L13.91,11.5H15V10Z"
            />
        </svg>
    );
}

// ── HeaderBar Button ──
function FollowMeHeaderButton() {
    const tid = useFollowMeId();
    if (!tid) return null;

    return (
        <HeaderBarButton
            icon={() => (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#3ba55d">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z" />
                </svg>
            )}
            tooltip={`Stop Follow Me: ${targetName}`}
            onClick={() => unfollowMe()}
        />
    );
}

// ── Context Menu ──
const ctxPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!children || !Array.isArray(children)) return;
    try {
        const userId: string | undefined = props?.user?.id;
        if (!userId || userId === UserStore.getCurrentUser()?.id) return;

        const isFollowed = targetId === userId;

        children.push(
            <Menu.MenuCheckboxItem
                id="follow-me-ctx"
                label={isFollowed ? "Stop Follow Me" : "Follow Me"}
                checked={isFollowed}
                action={() => { if (isFollowed) unfollowMe(); else followMe(userId); }}
            />
        );
    } catch (e) {
        console.error("[FollowMe] Context menu patch error:", e);
    }
};

// ── Plugin ───────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "FollowMe",
    description: "Forces a user to follow you in voice channels (if you have permissions). Right-click a user -> Follow Me.",
    tags: ["Voice", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["ContextMenuAPI"],

    headerBarButton: {
        icon: () => <FollowMeIcon filled={true} />,
        render: FollowMeHeaderButton,
        priority: 6,
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            if (!targetId) return;
            const myId = UserStore.getCurrentUser()?.id;

            for (const s of voiceStates) {
                if (s.userId === myId) {
                    if (s.channelId && s.guildId) {
                        moveTargetTo(s.guildId, s.channelId);
                    }
                }
                else if (s.userId === targetId) {
                    const myState = VoiceStateStore.getVoiceStateForUser(myId);
                    if (myState?.channelId && myState.guildId && s.channelId !== myState.channelId) {
                        if (s.guildId === myState.guildId) {
                            moveTargetTo(myState.guildId, myState.channelId);
                        }
                    }
                }
            }
        }
    },

    async start() {
        const saved = await DataStore.get(DS_KEY) as { id: string; name: string; } | null;
        if (saved?.id) {
            targetId = saved.id;
            targetName = saved.name ?? saved.id;
        }
        addContextMenuPatch("user-context", ctxPatch);
        addContextMenuPatch("user-profile-actions", ctxPatch);
    },

    stop() {
        targetId = null; targetName = "";
        removeContextMenuPatch("user-context", ctxPatch);
        removeContextMenuPatch("user-profile-actions", ctxPatch);
    },
});
