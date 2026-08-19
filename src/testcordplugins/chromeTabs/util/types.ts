/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** The minimum information needed to point a tab at something */
export interface TabTarget {
    guildId: string;
    channelId: string;
}

export interface Tab extends TabTarget {
    id: number;
    /** set when the tab should jump to a specific message on activation */
    messageId?: string;
}

export interface PersistedTabs {
    [userId: string]: {
        tabs: Tab[];
        activeIndex: number;
    };
}

export interface ChannelUnreadState {
    channelId: string;
    hasUnread: boolean;
    mentionCount: number;
    unreadCount: number;
}

export interface UnreadBadgeState {
    /** null when only a plain "there is something unread" dot should render */
    count: number | null;
    hasMention: boolean;
    shouldShow: boolean;
}
