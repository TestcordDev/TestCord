/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { Channel } from "@vencord/discord-types";
import {
    DefaultExtractAndLoadChunksRegex,
    extractAndLoadChunksLazy,
    findComponentByCodeLazy,
} from "@webpack";
import {
    ChannelStore,
    GuildStore,
    MessageActions,
    MessageStore,
    React,
    useEffect,
    useState,
    useStateFromStores,
} from "@webpack/common";

import { TileEntity } from "../types";

const cl = classNameFactory("vc-hyprtiles-");

const ForumView = findComponentByCodeLazy("sidebarState") as React.ComponentType<Record<string, unknown>>;

// Lightweight message history surface (Discord internal module 371648, export A).
// Renders the message list for a channel without the channel header, search bar,
// or text input.
const ChatMessages = findComponentByCodeLazy("forceCompact", "forceCozy") as React.ComponentType<{
    channel: Channel;
    hideSummaries?: boolean;
    typingGradient?: boolean;
}>;

const requireForumView = extractAndLoadChunksLazy(
    ["Missing channel in Channel.renderHeaderToolbar"],
    new RegExp(DefaultExtractAndLoadChunksRegex.source + '.{1,150}name:"ForumChannel"')
);

interface TileContentProps {
    tile: TileEntity;
    active?: boolean;
}

function TileContentComponent({ tile, active = false }: TileContentProps) {
    const channel = useStateFromStores([ChannelStore], () => ChannelStore.getChannel(tile.channelId), [tile.channelId]);
    const guild = useStateFromStores([GuildStore], () => channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null, [channel?.guild_id]);
    const [forumReady, setForumReady] = useState(false);
    const liveMessageToken = useStateFromStores([MessageStore], () => {
        if (!channel || channel.isForumLikeChannel()) return "";

        const messages = MessageStore.getMessages(channel.id);
        const lastMessage = MessageStore.getLastMessage?.(channel.id) ?? messages?.last?.();
        return `${messages?._array?.length ?? 0}:${lastMessage?.id ?? ""}:${lastMessage?.editedTimestamp ?? ""}`;
    }, [channel?.id]);

    // Prime the message cache for regular channels so the list is populated
    // immediately when the tile opens. Skipped if messages are already present.
    useEffect(() => {
        if (!channel || channel.isForumLikeChannel()) return;
        if (MessageStore.hasPresent?.(channel.id)) return;

        MessageActions.fetchMessages({
            channelId: channel.id,
            limit: 50
        });
        return () => {};
    }, [channel?.id]);

    useEffect(() => {
        if (!channel?.isForumLikeChannel()) {
            setForumReady(false);
            return;
        }

        let cancelled = false;
        requireForumView().then(() => {
            if (!cancelled) setForumReady(true);
        });

        return () => {
            cancelled = true;
        };
    }, [channel?.id]);

    if (!channel) {
        return (
            <div className={cl("tile-empty")}>
                Channel unavailable
            </div>
        );
    }

    if (channel.isForumLikeChannel()) {
        if (ForumView && forumReady) {
            return (
                <div className={cl("tile-content-inner")}>
                    <ForumView
                        channel={channel}
                        guild={guild}
                        sidebarState={null}
                    />
                </div>
            );
        }

        return (
            <div className={cl("tile-empty")}>
                Loading forum view…
            </div>
        );
    }

    return (
        <div className={cl("tile-content-inner")} data-active={active} data-live-token={liveMessageToken}>
            <ChatMessages channel={channel} hideSummaries typingGradient={active} />
        </div>
    );
}

export const TileContent = ErrorBoundary.wrap(TileContentComponent, { noop: true });
