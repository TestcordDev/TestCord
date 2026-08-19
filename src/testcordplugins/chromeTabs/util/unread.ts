/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelUnreadState, UnreadBadgeState } from "./types";

/**
 * Collapses a channel's read state into what the badge should render.
 * Mentions always win over plain unreads, matching Discord's own badges.
 */
export function getUnreadBadgeState(state: ChannelUnreadState | undefined): UnreadBadgeState {
    if (!state) return { count: null, hasMention: false, shouldShow: false };

    if (state.mentionCount > 0) {
        return { count: state.mentionCount, hasMention: true, shouldShow: true };
    }

    if (state.unreadCount > 0) {
        return { count: state.unreadCount, hasMention: false, shouldShow: true };
    }

    // unread but no usable count (e.g. a channel Discord hasn't counted yet): plain dot
    if (state.hasUnread) {
        return { count: null, hasMention: false, shouldShow: true };
    }

    return { count: null, hasMention: false, shouldShow: false };
}

/** Discord renders anything past 99 as "99+" */
export function formatBadgeCount(count: number): string {
    return count > 99 ? "99+" : String(count);
}
