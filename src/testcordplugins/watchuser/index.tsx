/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import {
    ChannelStore,
    ContextMenuApi,
    Menu,
    React,
    Toasts,
    UserStore
} from "@webpack/common";
import type { PropsWithChildren, SVGProps } from "react";

interface IconBaseProps extends IconProps {
    viewBox: string;
}

interface IconProps extends SVGProps<SVGSVGElement> {
    className?: string;
    height?: string | number;
    width?: string | number;
}

function Icon({
    height = 24,
    width = 24,
    className,
    children,
    viewBox,
    ...svgProps
}: PropsWithChildren<IconBaseProps>) {
    return (
        <svg
            className={className}
            role="img"
            width={width}
            height={height}
            viewBox={viewBox}
            {...svgProps}
        >
            {children}
        </svg>
    );
}

function WatchIcon(props: IconProps) {
    return (
        <Icon
            {...props}
            viewBox="0 0 16 16"
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                fill="currentColor"
                d="M0 8L3.07945 4.30466C4.29638 2.84434 6.09909 2 8 2C9.90091 2 11.7036 2.84434 12.9206 4.30466L16 8L12.9206 11.6953C11.7036 13.1557 9.90091 14 8 14C6.09909 14 4.29638 13.1557 3.07945 11.6953L0 8ZM8 11C9.65685 11 11 9.65685 11 8C11 6.34315 9.65685 5 8 5C6.34315 5 5 6.34315 5 8C5 9.65685 6.34315 11 8 11Z"
            />
        </Icon>
    );
}

function UnwatchIcon(props: IconProps) {
    return (
        <Icon
            {...props}
            viewBox="0 0 24 24"
        >
            <path
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                d="M2.99902 3L20.999 21M9.8433 9.91364C9.32066 10.4536 8.99902 11.1892 8.99902 12C8.99902 13.6569 10.3422 15 11.999 15C12.8215 15 13.5667 14.669 14.1086 14.133M6.49902 6.64715C4.59972 7.90034 3.15305 9.78394 2.45703 12C3.73128 16.0571 7.52159 19 11.9992 19C13.9881 19 15.8414 18.4194 17.3988 17.4184M10.999 5.04939C11.328 5.01673 11.6617 5 11.9992 5C16.4769 5 20.2672 7.94291 21.5414 12C21.2607 12.894 20.8577 13.7338 20.3522 14.5"
            />
        </Icon>
    );
}

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    selfStream: boolean;
    selfVideo: boolean;
    sessionId: string;
    suppress: boolean;
    requestToSpeakTimestamp: string | null;
}

export const settings = definePluginSettings({
    watchUserId: {
        type: OptionType.STRING,
        description: "User ID of the watched user",
        restartNeeded: false,
        hidden: true,
        default: "",
    },
    playSounds: {
        type: OptionType.BOOLEAN,
        description: "Play sounds when a user joins or leaves",
        restartNeeded: false,
        default: false,
    }
});

const VoiceStateStore: VoiceStateStore = findStoreLazy("VoiceStateStore");

interface VoiceStateStore {
    getAllVoiceStates(): VoiceStateEntries;
    getVoiceStatesForChannel(channelId: string): VoiceStateMembers;
}

interface VoiceStateEntries {
    [guildOrUser: string]: VoiceStateMembers;
}

interface VoiceStateMembers {
    [userId: string]: VoiceState;
}

function getChannelId(userId: string) {
    if (!userId) return null;
    try {
        const voiceStates = VoiceStateStore.getAllVoiceStates();
        for (const userStates of Object.values(voiceStates)) {
            if (userStates[userId]) {
                return userStates[userId].channelId ?? null;
            }
        }
    } catch (e) { }
    return null;
}

function playSoundJoin() {
    const audio = new Audio("https://github.com/KillaMeep/discordfiles/raw/main/VencordSFX/join.mp3");
    audio.play().catch(err => console.error("Failed to play join sound:", err));
}

function playSoundLeave() {
    const audio = new Audio("https://github.com/KillaMeep/discordfiles/raw/main/VencordSFX/leave.mp3");
    audio.play().catch(err => console.error("Failed to play leave sound:", err));
}

function triggerWatch(targetChannelId: string | null = getChannelId(settings.store.watchUserId)) {
    if (!settings.store.watchUserId) return;

    const watchedUser = UserStore.getUser(settings.store.watchUserId);
    if (targetChannelId) {
        const channel = ChannelStore.getChannel(targetChannelId);
        const guildName = channel.guild_id
            ? findStoreLazy("GuildStore").getGuild(channel.guild_id).name
            : "Direct Messages";
        const channelName = channel.name || "Unknown Channel";

        if (settings.store.playSounds) playSoundJoin();

        Toasts.show({
            message: `User ${watchedUser.username} joined a channel | Channel: ${channelName} | Server: ${guildName}`,
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS,
            options: { duration: 5000, position: Toasts.Position.TOP }
        });
    } else {
        if (settings.store.playSounds) playSoundLeave();

        Toasts.show({
            message: `User ${watchedUser.username} is not in a voice channel`,
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            options: { duration: 5000, position: Toasts.Position.TOP }
        });
    }
}

function toggleWatch(userId: string) {
    if (settings.store.watchUserId === userId) {
        settings.store.watchUserId = "";
    } else {
        settings.store.watchUserId = userId;
        triggerWatch();
    }
}

interface UserContextMenuProps {
    channel: Channel;
    guildId?: string;
    user: User;
}

const UserContextMenu: NavContextMenuPatchCallback = (menuItems, { user }: UserContextMenuProps) => {
    if (!user || user.id === UserStore.getCurrentUser().id) return;
    const isWatching = settings.store.watchUserId === user.id;

    menuItems.splice(-1, 0, (
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="watch-user"
                label={isWatching ? "Unwatch User" : "Watch User"}
                action={() => toggleWatch(user.id)}
                icon={isWatching ? UnwatchIcon : WatchIcon}
            />
        </Menu.MenuGroup>
    ));
};

function WatchIndicatorMenu({ onClose }: { onClose: () => void; }) {
    const { watchUserId } = settings.store;
    const watchedUser = watchUserId ? UserStore.getUser(watchUserId) : null;
    const watchedUserChannelId = watchUserId ? getChannelId(watchUserId) : null;

    return (
        <Menu.Menu
            navId="watch-menu"
            onClose={onClose}
            aria-label="Watch Users"
        >
            <Menu.MenuGroup label="WATCHING">
                <Menu.MenuItem
                    id="watched-user"
                    label={watchedUser?.username || "No user watched"}
                    disabled={true}
                />
                <Menu.MenuItem
                    id="watched-user-status"
                    label={watchedUserChannelId
                        ? `In Channel: ${ChannelStore.getChannel(watchedUserChannelId)?.name || "Unknown"}`
                        : "Not in a voice channel"
                    }
                    disabled={true}
                />
            </Menu.MenuGroup>
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="trigger-watch"
                    label="Trigger Manually"
                    action={() => { triggerWatch(); onClose(); }}
                />
                <Menu.MenuItem
                    id="unwatch-user"
                    label="Unwatch User"
                    action={() => { settings.store.watchUserId = ""; onClose(); }}
                    color="danger"
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function WatchButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { watchUserId } = settings.store;

    const tooltip = watchUserId
        ? `Watching ${UserStore.getUser(watchUserId)?.username || "User"}`
        : "No user being watched";

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : tooltip}
            icon={watchUserId
                ? <UnwatchIcon className={iconForeground} />
                : <WatchIcon className={iconForeground} />
            }
            plated={nameplate != null}
            onClick={e => ContextMenuApi.openContextMenu(e, () => <WatchIndicatorMenu onClose={() => { }} />)}
        />
    );
}

export default definePlugin({
    name: "WatchUsers",
    description: "Watches a user, and notifies when they join or leave a channel in a server you share",
    authors: [{ name: "KillaMeep", id: 247075046659457024n }, TestcordDevs.x2b],
    tags: ["Friends", "Voice", "Notifications"],
    settings,

    contextMenus: {
        "user-context": UserContextMenu
    },

    userAreaButton: {
        icon: WatchIcon,
        render: WatchButton
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!settings.store.watchUserId) return;
            for (const { userId, channelId, oldChannelId } of voiceStates) {
                if (channelId !== oldChannelId) {
                    if (settings.store.watchUserId !== userId) continue;
                    triggerWatch();
                }
            }
        },
    },
});
