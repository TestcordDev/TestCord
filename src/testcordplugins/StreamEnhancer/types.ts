/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Channel } from "@vencord/discord-types";

export interface StreamDescriptor {
    streamType?: "guild" | "call";
    channelId: string;
    ownerId: string;
    guildId?: string | null;
    streamKey?: string;
}

export interface StreamParticipant {
    id?: string;
    streamId?: string | number | bigint | null;
    user?: {
        id?: string | bigint | null;
    } | null;
}

export type ZoomableVideoProps = Record<string, unknown>;

export type StreamFitMode = "contain" | "cover" | "stretch";

export interface ApplicationStreamingStoreLike {
    getAnyStreamForUser?: (userId: string | bigint) => StreamDescriptor | null;
    getAllActiveStreams?: () => StreamDescriptor[];
    getAllActiveStreamsForChannel?: (channelId: string | bigint) => StreamDescriptor[];
    addChangeListener?: (listener: () => void) => void;
    removeChangeListener?: (listener: () => void) => void;
}

export interface ChannelRTCStoreLike {
    addChangeListener?: (listener: () => void) => void;
    removeChangeListener?: (listener: () => void) => void;
}

export interface WatchStreamOptions {
    forceFocus?: boolean;
    forceMultiple?: boolean;
    noFocus?: boolean;
}

export interface PopoutActionsLike {
    openChannelCallPopout: (channel: Channel) => void;
}

export interface ChannelRtcActionsLike {
    selectParticipant: (channelId: string, participantId: string | null) => void;
    updateLayout: (channelId: string, layout: string, appContext?: string) => void;
}

export interface StreamUiConstantsLike {
    BRT: {
        POPOUT: string;
    };
    DUB: {
        FULL_SCREEN: string;
    };
    MLl: {
        CHANNEL_CALL_POPOUT: string;
    };
}

export interface PopoutWindowStoreLike {
    getWindowOpen?: (key: string) => boolean;
}

export interface StreamRtcConnectionVideoPayload {
    type: "RTC_CONNECTION_VIDEO";
    userId?: string;
    context?: string;
}

export interface StreamRtcConnectionStatePayload {
    type: "RTC_CONNECTION_STATE";
    context?: string;
    streamKey?: string;
}

export interface StoredAutoWatchPreferences {
    autoWatchUserIds?: unknown;
    autoFocusUserIds?: unknown;
    autoWatchAllStreamsOnJoin?: unknown;
}
