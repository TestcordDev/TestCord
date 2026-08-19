/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings, useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { ChannelStore, Menu, PermissionsBits, PermissionStore, React, Toasts, UserStore } from "@webpack/common";
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '"top"===c');
function Icon({ height = 24, width = 24, className, children, viewBox, ...svgProps }) {
    return (<svg className={classes(className, "vc-icon")} role="img" width={width} height={height} viewBox={viewBox} {...svgProps}>
            {children}
        </svg>);
}
function FollowIcon(props) {
    return (<Icon {...props} className={classes(props.className, "vc-follow-icon")} viewBox="0 -960 960 960">
            <path fill="currentColor" d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"/>
        </Icon>);
}
function UnfollowIcon(props) {
    return (<Icon {...props} className={classes(props.className, "vc-unfollow-icon")} viewBox="0 -960 960 960">
            <path fill="currentColor" d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
        </Icon>);
}
export const settings = definePluginSettings({
    disconnectUserId: {
        type: 0 /* OptionType.STRING */,
        description: "Target user ID to auto-disconnect",
        restartNeeded: false,
        hidden: true,
        default: "",
    },
});
const Auth = findByPropsLazy("getToken");
async function disconnectGuildMember(guildId, userId) {
    const token = Auth?.getToken?.();
    if (!token) {
        Toasts.show({
            message: "Cannot get auth token to disconnect user",
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE
        });
        return;
    }
    try {
        const response = await fetch(`/api/v9/guilds/${guildId}/members/${userId}`, {
            method: "PATCH",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ channel_id: null })
        });
        if (response.ok) {
            Toasts.show({
                message: "User disconnected from voice",
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS
            });
        }
        else {
            Toasts.show({
                message: `Failed to disconnect user (${response.status})`,
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE
            });
        }
    }
    catch (error) {
        Toasts.show({
            message: "Network error while disconnecting user",
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE
        });
    }
}
const UserContext = (children, { user }) => {
    if (!user || user.id === UserStore.getCurrentUser().id)
        return;
    const isActive = settings.store.disconnectUserId === user.id;
    const label = "Disconnect user";
    const icon = isActive ? UnfollowIcon : FollowIcon;
    children.splice(-1, 0, (<Menu.MenuGroup key="disconnect-user-group">
            <Menu.MenuItem id="disconnect-user" label={label} action={() => {
            settings.store.disconnectUserId = isActive ? "" : user.id;
        }} icon={icon}/>
        </Menu.MenuGroup>));
};
export default definePlugin({
    name: "DisconnectUser",
    description: "Adds a context menu entry to auto-disconnect a user when they join voice",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    patches: [
        {
            find: "toolbar:function",
            replacement: {
                match: /(function \i\(\i\){)(.{1,200}toolbar.{1,100}mobileToolbar)/,
                replace: "$1$self.addIconToToolBar(arguments[0]);$2"
            }
        },
    ],
    contextMenus: {
        "user-context": UserContext
    },
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            const targetUserId = settings.store.disconnectUserId;
            if (!targetUserId)
                return;
            for (const { userId, channelId, oldChannelId } of voiceStates) {
                if (userId !== targetUserId)
                    continue;
                if (channelId && channelId !== oldChannelId) {
                    const channel = ChannelStore.getChannel(channelId);
                    if (!channel)
                        continue;
                    const guildId = channel.guild_id ?? channel.guildId;
                    if (!guildId)
                        continue;
                    if (!PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel)) {
                        Toasts.show({
                            message: "Missing MOVE_MEMBERS permission to disconnect user",
                            id: Toasts.genId(),
                            type: Toasts.Type.FAILURE
                        });
                        continue;
                    }
                    void disconnectGuildMember(guildId, userId);
                }
            }
        },
    },
    FollowIndicator() {
        const { plugins: { DisconnectUser: { disconnectUserId } } } = useSettings(["plugins.DisconnectUser.disconnectUserId"]);
        if (disconnectUserId) {
            const current = UserStore.getUser(disconnectUserId);
            return (<HeaderBarIcon tooltip={`Disconnect user: ${current?.username ?? disconnectUserId} (right-click to disable)`} icon={UnfollowIcon} className="vc-plugin-icon-button" iconClassName="vc-plugin-icon-button" onClick={() => { }} onContextMenu={e => {
                    e.preventDefault();
                    settings.store.disconnectUserId = "";
                }}/>);
        }
        return null;
    },
    addIconToToolBar(e) {
        const icon = (<ErrorBoundary noop={true} key="disconnect-indicator">
                <this.FollowIndicator />
            </ErrorBoundary>);
        if (Array.isArray(e.toolbar)) {
            // Toolbar array ise ikonları sona ekle ki başka plugin ikonları da kalır
            e.toolbar.push(icon);
        }
        else {
            // Tek node ise array yapıp önce kendi ikonunu ekle
            e.toolbar = [icon, e.toolbar];
        }
    },
});
