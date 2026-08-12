/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu, RestAPI, Toasts } from "@webpack/common";

const GuildStoreModule = findByPropsLazy("getGuilds");

function MuteIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
        </svg>
    );
}

function UnmuteIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM16 6.5v2.21c1.48.73 2.5 2.25 2.5 4.02 0 1.77-1.02 3.29-2.5 4.03v2.21c2.47-.83 4.5-3.24 4.5-6.24s-2.03-5.41-4.5-6.24z" />
        </svg>
    );
}

async function setAllGuildsMuted(muted: boolean) {
    const guilds = GuildStoreModule.getGuilds();
    const guildIds = Object.keys(guilds);
    const label = muted ? "Muting" : "Unmuting";

    Toasts.show({
        message: `${label} all servers…`,
        type: Toasts.Type.MESSAGE,
        id: Toasts.genId(),
    });

    let count = 0;
    for (const id of guildIds) {
        try {
            const settings = {
                muted,
                mute_config: muted
                    ? { selected_time_window: -1, end_time: null }
                    : null,
                suppress_everyone: muted,
                suppress_roles: muted,
                message_notifications: muted ? 2 : 0,
                mobile_push: !muted,
            };
            await RestAPI.patch({
                url: `/users/@me/guilds/${id}/settings`,
                body: settings,
            });
            count++;
        } catch (e) {
            console.warn(`[MuteUnmuteServers] Error ${label.toLowerCase()} ${id}:`, e);
        }
    }

    Toasts.show({
        message: `${label} done! ${count}/${guildIds.length} servers updated.`,
        type: Toasts.Type.SUCCESS,
        id: Toasts.genId(),
    });
}

const guildContextPatch = (children: any, { guild }: { guild?: any }) => {
    if (!children || !Array.isArray(children) || !guild) return;
    try {
        children.splice(-1, 0, (
            <Menu.MenuGroup key="nc-muteunmute-group">
                <Menu.MenuItem
                    id="nc-mute-all-servers"
                    label="Mute all servers"
                    icon={() => <MuteIcon />}
                    action={() => setAllGuildsMuted(true)}
                />
                <Menu.MenuItem
                    id="nc-unmute-all-servers"
                    label="Unmute all servers"
                    icon={() => <UnmuteIcon />}
                    action={() => setAllGuildsMuted(false)}
                />
            </Menu.MenuGroup>
        ));
    } catch (e) {
        console.error("[MuteUnmuteServers] Context menu patch error:", e);
    }
};

export default definePlugin({
    name: "MuteUnmuteServers",
    description: "Mute or unmute all your servers at once via right-click context menu.",
    tags: ["Servers", "Utility"],
    authors: [TestcordDevs.x2b],
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
