/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ActiveJoinedThreadsStore, ChannelStore,FluxDispatcher, GuildChannelStore, GuildStore, Menu, React, ReadStateStore, RestAPI, Toasts } from "@webpack/common";

const GuildStoreModule = findByPropsLazy("getGuilds");

function MuteIcon({ width = 18, height = 18 }: { width?: number; height?: number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
            <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function markAllAsRead() {
    const channels: Array<any> = [];

    // Mark all servers as read
    Object.values(GuildStore.getGuilds()).forEach(guild => {
        const guildChannels = GuildChannelStore.getChannels(guild.id);
        if (!guildChannels) return;

        const allChannels = [
            ...(guildChannels.SELECTABLE || []),
            ...(guildChannels.VOCAL || []),
            ...Object.values(ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guild.id))
                .flatMap(threadChannels => Object.values(threadChannels))
        ];

        allChannels.forEach((c: any) => {
            const channelId = c.channel?.id || c.id;
            if (!channelId || !ReadStateStore.hasUnread(channelId)) return;

            channels.push({
                channelId: channelId,
                messageId: ReadStateStore.lastMessageId(channelId),
                readStateType: 0
            });
        });
    });

    // Mark all DMs / Groups as read
    ChannelStore.getSortedPrivateChannels().forEach((c: any) => {
        if (!ReadStateStore.hasUnread(c.id)) return;
        channels.push({
            channelId: c.id,
            messageId: ReadStateStore.lastMessageId(c.id),
            readStateType: 0
        });
    });

    if (channels.length > 0) {
        FluxDispatcher.dispatch({
            type: "BULK_ACK",
            context: "APP",
            channels: channels
        });
    }
}

async function muteAllServers() {
    const guilds = GuildStoreModule.getGuilds();
    const guildIds = Object.keys(guilds);

    Toasts.show({
        message: "Muting all and clearing notifications…",
        type: Toasts.Type.MESSAGE,
        id: Toasts.genId(),
    });

    // Step 1: Mark everything as read (Equicord system)
    markAllAsRead();

    // Step 2: Mute the servers
    if (guildIds.length > 0) {
        let count = 0;
        const updateSettings = findByPropsLazy("updateGuildNotificationSettings");

        for (const id of guildIds) {
            try {
                // Individual ack (safety)
                try { await RestAPI.post({ url: `/guilds/${id}/ack`, body: {} }); } catch { }

                const settings = {
                    muted: true,
                    mute_config: { selected_time_window: -1, end_time: null },
                    suppress_everyone: true,
                    suppress_roles: true,
                    message_notifications: 2,
                    mobile_push: false,
                };

                if (updateSettings?.updateGuildNotificationSettings) {
                    await updateSettings.updateGuildNotificationSettings(id, settings);
                } else {
                    await RestAPI.patch({ url: `/users/@me/guilds/${id}/settings`, body: settings });
                }
                count++;
            } catch (e) {
                console.warn(`[MuteAllServers] Error for ${id}:`, e);
            }
        }
    }

    Toasts.show({
        message: "Everything is now muted and read!",
        type: Toasts.Type.SUCCESS,
        id: Toasts.genId(),
    });
}

const guildContextPatch = (children: any, { guild }: { guild?: any; }) => {
    if (!children || !Array.isArray(children)) return;
    try {
        if (!guild) return;
        children.splice(-1, 0, (
            <Menu.MenuGroup key="nc-mute-all-group">
                <Menu.MenuItem
                    id="nc-mute-all-servers"
                    label="Mute all servers & mark as read"
                    icon={() => <MuteIcon />}
                    action={() => muteAllServers()}
                />
            </Menu.MenuGroup>
        ));
    } catch (e) {
        console.error("[MuteAllServers] Context menu patch error:", e);
    }
};

export default definePlugin({
    name: "MuteAllServers",
    description: "Right-click a server → mute all servers and mark all as read in one click.",
    tags: ["Notifications", "Servers", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["ContextMenuAPI"],

    start() {
        addContextMenuPatch("guild-context", guildContextPatch);
        addContextMenuPatch("guild-header-popout", guildContextPatch);
    },

    stop() {
        removeContextMenuPatch("guild-context", guildContextPatch);
        removeContextMenuPatch("guild-header-popout", guildContextPatch);
    },
});
