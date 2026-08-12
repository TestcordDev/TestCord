/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
const ContextMenuApi: any = null;
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { EquicordDevs } from "@utils/constants";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, User, VoiceState } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Button, ChannelStore, Forms, GuildStore, Menu, React, RelationshipStore, Toasts, UserStore, VoiceStateStore } from "@webpack/common";

// ─── Webpack ──────────────────────────────────────────────────────────────────

const voiceChannelAction = findByPropsLazy("selectVoiceChannel");

// ─── Types ────────────────────────────────────────────────────────────────────

type TFollowedUserInfo = {
    lastChannelId: string;
    userId: string;
    username: string;
} | null;

interface UserContextProps {
    channel: Channel;
    user: User;
    guildId?: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

let followedUserInfo: TFollowedUserInfo = null;

// ─── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    onlyWhenInVoice: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Only follow the user when you are already in a voice channel"
    },
    leaveWhenUserLeaves: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Leave the voice channel when the followed user leaves (warning: can cause join/leave loops)"
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show toast notifications when following/unfollowing or when moving channels"
    },
    showPanelButton: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show a follow indicator button in the user area panel (next to Mute/Deafen)"
    }
});

// ─── Icons ────────────────────────────────────────────────────────────────────

function FollowIcon({ className, active }: { className?: string; active?: boolean; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill={active ? "var(--status-positive)" : "currentColor"}
                d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12Zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8Z"
            />
            {active && <circle cx="19" cy="5" r="5" fill="var(--status-positive)" />}
            {active && (
                <path
                    fill="white"
                    transform="translate(14.5, 2) scale(0.38)"
                    d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"
                />
            )}
        </svg>
    );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function FollowUserModal({ modalProps }: { modalProps: ModalProps; }) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const info = followedUserInfo;
    const currentUser = UserStore.getCurrentUser();

    // Gather friends currently in voice
    const friendsInVoice = React.useMemo(() => {
        const friends: { userId: string; username: string; channelId: string; channelName: string; guildName: string; }[] = [];
        try {
            const friendIds: string[] = RelationshipStore.getFriendIDs();
            for (const friendId of friendIds) {
                if (friendId === currentUser.id) continue;
                const vs = VoiceStateStore.getVoiceStateForUser(friendId);
                if (!vs?.channelId) continue;
                const channel = ChannelStore.getChannel(vs.channelId);
                if (!channel) continue;
                const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
                const user = UserStore.getUser(friendId);
                friends.push({
                    userId: friendId,
                    username: user?.username ?? friendId,
                    channelId: vs.channelId,
                    channelName: channel.name ?? "Unknown",
                    guildName: guild?.name ?? "DM"
                });
            }
        } catch { /* RelationshipStore may not be available in all contexts */ }
        return friends;
    }, []);

    const followedVoiceState = info ? VoiceStateStore.getVoiceStateForUser(info.userId) : null;
    const followedChannel = followedVoiceState?.channelId ? ChannelStore.getChannel(followedVoiceState.channelId) : null;
    const followedGuild = followedChannel?.guild_id ? GuildStore.getGuild(followedChannel.guild_id) : null;

    function doFollow(userId: string, username: string) {
        followedUserInfo = { lastChannelId: "", userId, username };
        if (settings.store.showToasts) {
            Toasts.show({
                message: `Now following ${username} into voice`,
                id: "followuser-follow",
                type: Toasts.Type.SUCCESS,
                options: { position: Toasts.Position.BOTTOM }
            });
        }
        forceUpdate();
    }

    function doUnfollow() {
        if (!followedUserInfo) return;
        const name = followedUserInfo.username;
        followedUserInfo = null;
        if (settings.store.showToasts) {
            Toasts.show({
                message: `Stopped following ${name}`,
                id: "followuser-unfollow",
                type: Toasts.Type.MESSAGE,
                options: { position: Toasts.Position.BOTTOM }
            });
        }
        forceUpdate();
    }

    function doJump(channelId: string) {
        voiceChannelAction.selectVoiceChannel(channelId);
        modalProps.onClose();
    }

    const T = {
        primary: "#e0e1e5",
        muted: "#a0a4ae",
        section: "#72757e",
    };

    const SectionLabel = ({ children }: { children: any; }) => (
        <div style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: T.section,
            marginBottom: "8px",
            marginTop: "4px"
        }}>
            {children}
        </div>
    );

    const Avatar = ({ userId, size }: { userId: string; size: number; }) => {
        const user = UserStore.getUser(userId);
        const defaultIdx = userId ? Number(BigInt(userId) >> 22n) % 6 : 0;
        const src = user?.avatar
            ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.webp?size=${size <= 32 ? 64 : 128}`
            : `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
        return (
            <img
                src={src}
                onError={e => { (e.target as HTMLImageElement).src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
                style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "block" }}
            />
        );
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false} style={{ padding: "20px 20px 0 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24">
                        <path fill="#e0e1e5" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
                    </svg>
                    <span style={{ fontSize: "20px", fontWeight: 700, color: "#e0e1e5", lineHeight: 1 }}>
                        Follow User
                    </span>
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "16px 20px 8px 20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "20px", paddingBottom: "8px" }}>

                    {/* ── Currently Following ── */}
                    <div>
                        <SectionLabel>Currently Following</SectionLabel>
                        {info ? (
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "14px",
                                padding: "16px",
                                backgroundColor: "var(--background-secondary)",
                                borderRadius: "10px",
                                border: "2px solid var(--status-positive)",
                                position: "relative",
                                overflow: "hidden"
                            }}>
                                {/* green glow strip on left */}
                                <div style={{
                                    position: "absolute",
                                    left: 0, top: 0, bottom: 0,
                                    width: "4px",
                                    backgroundColor: "var(--status-positive)",
                                    borderRadius: "10px 0 0 10px"
                                }} />

                                <div style={{ marginLeft: "6px" }}>
                                    <Avatar userId={info.userId} size={52} />
                                </div>

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: "17px", fontWeight: 700, color: "#e0e1e5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {info.username}
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "4px" }}>
                                        {followedChannel ? (
                                            <>
                                                <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                                                    <path fill="var(--status-positive)" d="M11.383 3.07904C11.009 2.92504 10.579 3.01004 10.293 3.29604L6 8.00204H3C2.45 8.00204 2 8.45304 2 9.00204V15.002C2 15.552 2.45 16.002 3 16.002H6L10.293 20.71C10.579 20.996 11.009 21.078 11.383 20.924C11.757 20.77 12 20.407 12 20.002V4.00204C12 3.59904 11.757 3.23204 11.383 3.07904ZM14 5.00195V7.00195C16.757 7.00195 19 9.24595 19 12.002C19 14.758 16.757 17.002 14 17.002V19.002C17.86 19.002 21 15.862 21 12.002C21 8.14195 17.86 5.00195 14 5.00195ZM14 9.00195V11.002H16V13.002H14V15.002C15.654 15.002 17 13.656 17 12.002C17 10.348 15.654 9.00195 14 9.00195Z" />
                                                </svg>
                                                <span style={{ fontSize: "13px", color: "#e0e1e5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    #{followedChannel.name}
                                                    {followedGuild && <span style={{ color: "#a0a4ae" }}> — {followedGuild.name}</span>}
                                                </span>
                                            </>
                                        ) : (
                                            <span style={{ fontSize: "13px", color: "#a0a4ae", fontStyle: "italic" }}>Not in voice right now</span>
                                        )}
                                    </div>
                                </div>

                                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                                    {followedChannel && (
                                        <Button size={Button.Sizes.MEDIUM as any} color={Button.Colors.GREEN as any} onClick={() => doJump(followedVoiceState!.channelId!)}>
                                            Join
                                        </Button>
                                    )}
                                    <Button size={Button.Sizes.MEDIUM as any} color={Button.Colors.RED as any} onClick={doUnfollow}>
                                        Unfollow
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div style={{
                                padding: "16px",
                                backgroundColor: "var(--background-secondary)",
                                borderRadius: "10px",
                                border: "1px dashed var(--background-modifier-accent)",
                                color: "#a0a4ae",
                                fontSize: "14px",
                                textAlign: "center",
                                lineHeight: 1.5
                            }}>
                                Not following anyone.<br />
                                <span style={{ fontSize: "13px" }}>Right-click any user → <strong style={{ color: "#e0e1e5" }}>Follow into Voice</strong>, or pick a friend below.</span>
                            </div>
                        )}
                    </div>

                    {/* ── Friends in Voice ── */}
                    <div>
                        <SectionLabel>Friends in Voice {(friendsInVoice.length > 0 && `(${friendsInVoice.length})`) as any}</SectionLabel>

                        {friendsInVoice.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                {friendsInVoice.map(friend => {
                                    const isFollowingThis = info?.userId === friend.userId;
                                    return (
                                        <div
                                            key={friend.userId}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "12px",
                                                padding: "12px 14px",
                                                backgroundColor: isFollowingThis ? "var(--background-secondary)" : "var(--background-secondary-alt, var(--background-secondary))",
                                                borderRadius: "8px",
                                                border: `1px solid ${isFollowingThis ? "var(--status-positive)" : "var(--background-modifier-accent)"}`,
                                                transition: "border-color 0.15s ease"
                                            }}
                                        >
                                            <div style={{ position: "relative", flexShrink: 0 }}>
                                                <Avatar userId={friend.userId} size={40} />
                                                {isFollowingThis && (
                                                    <div style={{
                                                        position: "absolute",
                                                        bottom: -1, right: -1,
                                                        width: 12, height: 12,
                                                        borderRadius: "50%",
                                                        backgroundColor: "var(--status-positive)",
                                                        border: "2px solid var(--background-secondary)"
                                                    }} />
                                                )}
                                            </div>

                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                                                    <span style={{ fontSize: "15px", fontWeight: 600, color: "#e0e1e5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {friend.username}
                                                    </span>
                                                    {isFollowingThis && (
                                                        <span style={{
                                                            fontSize: "10px",
                                                            fontWeight: 700,
                                                            letterSpacing: "0.05em",
                                                            textTransform: "uppercase",
                                                            color: "var(--status-positive)",
                                                            backgroundColor: "rgba(59, 165, 93, 0.15)",
                                                            padding: "1px 6px",
                                                            borderRadius: "4px",
                                                            flexShrink: 0
                                                        }}>
                                                            Following
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: "13px", color: "#a0a4ae", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    #{friend.channelName} — {friend.guildName}
                                                </div>
                                            </div>

                                            <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                                <Button size={Button.Sizes.SMALL as any} color={Button.Colors.BRAND as any} onClick={() => doJump(friend.channelId)}>
                                                    Join
                                                </Button>
                                                {isFollowingThis ? (
                                                    <Button size={Button.Sizes.SMALL as any} color={Button.Colors.RED as any} onClick={doUnfollow}>
                                                        Unfollow
                                                    </Button>
                                                ) : (
                                                    <Button size={Button.Sizes.SMALL as any} color={Button.Colors.GREEN as any} onClick={() => doFollow(friend.userId, friend.username)}>
                                                        Follow
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div style={{
                                padding: "16px",
                                backgroundColor: "var(--background-secondary)",
                                borderRadius: "8px",
                                border: "1px dashed var(--background-modifier-accent)",
                                color: "#a0a4ae",
                                fontSize: "14px",
                                textAlign: "center"
                            }}>
                                No friends are currently in voice.
                            </div>
                        )}
                    </div>

                    {/* ── Settings Summary ── */}
                    <div>
                        <SectionLabel>Active Settings</SectionLabel>
                        <div style={{
                            padding: "12px 16px",
                            backgroundColor: "var(--background-secondary)",
                            borderRadius: "8px",
                            border: "1px solid var(--background-modifier-accent)",
                            display: "flex",
                            gap: "20px",
                            fontSize: "13px",
                        }}>
                            {[
                                { label: "Only follow when in voice", value: settings.store.onlyWhenInVoice },
                                { label: "Leave when they leave", value: settings.store.leaveWhenUserLeaves },
                            ].map(({ label, value }) => (
                                <div key={label} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                                    <div style={{
                                        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                                        backgroundColor: value ? "var(--status-positive)" : "var(--status-danger)"
                                    }} />
                                    <span style={{ color: "#a0a4ae" }}>{label}:</span>
                                    <span style={{ color: "#e0e1e5", fontWeight: 600 }}>{value ? "On" : "Off"}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </ModalContent>

            <ModalFooter style={{ padding: "16px 20px" }}>
                <Button color={Button.Colors.PRIMARY as any} onClick={() => modalProps.onClose()}>
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// ─── User Area Panel Button ───────────────────────────────────────────────────

function FollowUserPanelButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { showPanelButton } = settings.use(["showPanelButton"]);
    const isFollowing = followedUserInfo !== null;

    if (!showPanelButton) return null;

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : isFollowing ? `Following ${followedUserInfo?.username}` : "Follow User"}
            icon={<FollowIcon className={iconForeground} active={isFollowing} />}
            role="button"
            aria-checked={isFollowing}
            redGlow={false}
            plated={nameplate != null}
            onClick={() => openModal((props: any) => <FollowUserModal modalProps={props} /> as any)}
        />
    );
}

// ─── Context Menu Patch ───────────────────────────────────────────────────────

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    try {
        const user = props?.user;
        if (!user || UserStore.getCurrentUser().id === user.id) return;

        const isFollowing = followedUserInfo?.userId === user.id;
        const voiceState = VoiceStateStore.getVoiceStateForUser(user.id);
        const isInVoice = !!voiceState?.channelId;

        const MenuItem = (Menu as any).MenuSwitchItem;
        const menuItem = (
                    <Menu.MenuGroup>
                {/* Parent item — expands to submenu */}
                <Menu.MenuItem
                    id="fvu-root"
                    label="Follow User"
                >
                    {/* Toggle follow on/off */}
                    <MenuItem
                        id="fvu-toggle"
                        label={isFollowing ? `Following ${user.username}` : "Follow into Voice"}
                        checked={isFollowing}
                        action={() => {
                            if (isFollowing) {
                                followedUserInfo = null;
                                if (settings.store.showToasts) Toasts.show({
                                    message: `Stopped following ${user.username}`,
                                    id: "followuser-unfollow",
                                    type: Toasts.Type.MESSAGE,
                                    options: { position: Toasts.Position.BOTTOM }
                                });
                            } else {
                                followedUserInfo = { lastChannelId: "", userId: user.id, username: user.username };
                                if (settings.store.showToasts) Toasts.show({
                                    message: `Now following ${user.username}`,
                                    id: "followuser-follow",
                                    type: Toasts.Type.SUCCESS,
                                    options: { position: Toasts.Position.BOTTOM }
                                });
                            }
                        }}
                    />

                    {/* Jump to their channel — only shown when they're in voice */}
                    {isInVoice && (
                        <Menu.MenuItem
                            id="fvu-jump"
                            label="Join Their Channel"
                            action={() => {
                                voiceChannelAction.selectVoiceChannel(voiceState!.channelId);
                            }}
                        />
                    )}

                    <Menu.MenuSeparator />

                    {/* Open the full management modal */}
                    <Menu.MenuItem
                        id="fvu-open-modal"
                        label="Manage Follow..."
                        action={() => openModal((props: any) => <FollowUserModal modalProps={props} /> as any)}
                    />
                </Menu.MenuItem>
            </Menu.MenuGroup>
        );

        // Insert after the send-message/call group (near top), fallback to index 1
        const profileGroup = findGroupChildrenByChildId(["send-message", "call"], children);
        if (profileGroup) {
            const idx = children.indexOf(profileGroup as any);
            if (idx !== -1) { children.splice(idx + 1, 0, menuItem); return; }
        }
        children.splice(1, 0, menuItem);
    } catch (e) {
        console.error("[FollowUser] context menu patch error:", e);
    }
};

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "deraculfollouser",
    description: "Follow a friend into voice channels. Click the panel icon to manage.",
    authors: [EquicordDevs.TheArmagan],
    dependencies: ["UserSettingsAPI"],
    settings,

    userAreaButton: {
        icon: FollowIcon,
        render: FollowUserPanelButton
    },

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!followedUserInfo) return;

            if (
                settings.store.onlyWhenInVoice &&
                !VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id)
            ) return;

            for (const voiceState of voiceStates) {
                if (voiceState.userId !== followedUserInfo.userId) continue;

                if (voiceState.channelId && voiceState.channelId !== followedUserInfo.lastChannelId) {
                    followedUserInfo.lastChannelId = voiceState.channelId;
                    voiceChannelAction.selectVoiceChannel(followedUserInfo.lastChannelId);
                    if (settings.store.showToasts) {
                        Toasts.show({
                            message: `Following ${followedUserInfo.username} to new channel`,
                            id: "followuser-move",
                            type: Toasts.Type.MESSAGE,
                            options: { position: Toasts.Position.BOTTOM }
                        });
                    }
                } else if (!voiceState.channelId && settings.store.leaveWhenUserLeaves) {
                    voiceChannelAction.selectVoiceChannel(null);
                    if (settings.store.showToasts) {
                        Toasts.show({
                            message: `${followedUserInfo.username} left voice — leaving too`,
                            id: "followuser-leave",
                            type: Toasts.Type.MESSAGE,
                            options: { position: Toasts.Position.BOTTOM }
                        });
                    }
                }
            }
        }
    }
});

