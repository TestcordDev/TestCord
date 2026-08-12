/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Dispatched when any user (including us) starts a stream in a voice channel. */
export interface StreamCreateEvent {
    type: "STREAM_CREATE";
    streamKey: string;
    rtcServerId: string;
    region: string;
    viewerIds: number[];
    paused: boolean;
}

/** Dispatched when a stream ends. */
export interface StreamDeleteEvent {
    type: "STREAM_DELETE";
    streamKey: string;
    reason: string;
    unavailable: unknown;
}

/** A stream key (`call:channelId:userId` or `guild:guildId:channelId:userId`) parsed into parts. */
export type ParsedStreamKey =
    | {
        voiceChannelType: "call";
        guildId?: undefined;
        channelId: string;
        userId: string;
    }
    | {
        voiceChannelType: "guild";
        guildId: string;
        channelId: string;
        userId: string;
    };
