/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import ErrorBoundary from "@components/ErrorBoundary";
import { Margins } from "@utils/margins";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal, RenderModalProps } from "@utils/modal";
import {
    Avatar,
    Button,
    ChannelStore,
    GuildStore,
    React,
    RelationshipStore,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

import { getAllUsersInVoice, getPinnedUserIds, settings, toggleFollow, togglePin, triggerFollow } from "./index";

interface FriendInVoice {
    userId: string;
    username: string;
    channelId: string;
    channelName: string;
    guildName: string;
}

interface PinnedUser {
    userId: string;
    username: string;
    channelId: string | null;
    channelName: string | null;
    guildName: string | null;
}

function FollowIcon({ className, active }: { className?: string; active?: boolean; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill={active ? "var(--status-positive)" : "currentColor"}
                d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12Zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8Z"
            />

            {active &&
                <circle cx="19" cy="5" r="5" fill="var(--status-positive)" />
            }
        </svg>
    );
}

function SectionLabel({ children }: { children: React.ReactNode; }) {
    return (
        <div style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "#ffffff",
            marginBottom: "8px",
            marginTop: "4px"
        }}>
            {children}
        </div>
    );
}

type AvatarSize = "SIZE_40" | "SIZE_48";

function UserAvatar({ userId, size }: { userId: string; size: AvatarSize; }) {
    const user = UserStore.getUser(userId);
    const px = size === "SIZE_40" ? 64 : 128;
    return <Avatar src={user?.getAvatarURL(void 0, px)} size={size} />;
}

function FollowUserModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const { followUserId, followedUsername, showNonFriendsInVoice, pinnedUserIds } = settings.use(["followUserId", "followedUsername", "showNonFriendsInVoice", "pinnedUserIds"]);
    const currentUser = UserStore.getCurrentUser();

    const friendsInVoice = React.useMemo<FriendInVoice[]>(() => {
        const friends: FriendInVoice[] = [];
        const friendIds = RelationshipStore.getFriendIDs();
        for (const friendId of friendIds) {
            if (friendId === currentUser?.id) continue;
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
        return friends;
    }, [currentUser, followUserId]);

    const nonFriendsInVoice = React.useMemo<FriendInVoice[]>(() => {
        if (!showNonFriendsInVoice) return [];
        const result: FriendInVoice[] = [];
        const friendIds = new Set(RelationshipStore.getFriendIDs());
        for (const { userId, channelId } of getAllUsersInVoice()) {
            if (userId === currentUser?.id) continue;
            if (friendIds.has(userId)) continue;
            const channel = ChannelStore.getChannel(channelId);
            if (!channel) continue;
            const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
            const user = UserStore.getUser(userId);
            result.push({
                userId,
                username: user?.username ?? userId,
                channelId,
                channelName: channel.name ?? "Unknown",
                guildName: guild?.name ?? "DM"
            });
        }
        return result;
    }, [currentUser, followUserId, showNonFriendsInVoice]);

    const pinnedUsers = React.useMemo<PinnedUser[]>(() => {
        const result: PinnedUser[] = [];
        for (const userId of getPinnedUserIds()) {
            if (userId === currentUser?.id) continue;
            const user = UserStore.getUser(userId);
            const vs = VoiceStateStore.getVoiceStateForUser(userId);
            const channel = vs?.channelId ? ChannelStore.getChannel(vs.channelId) : null;
            const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
            result.push({
                userId,
                username: user?.username ?? userId,
                channelId: channel?.id ?? null,
                channelName: channel?.name ?? null,
                guildName: guild?.name ?? (channel ? "DM" : null)
            });
        }
        return result;
    }, [currentUser, followUserId, pinnedUserIds]);

    const followedVoiceState = followUserId ? VoiceStateStore.getVoiceStateForUser(followUserId) : null;
    const followedChannel = followedVoiceState?.channelId ? ChannelStore.getChannel(followedVoiceState.channelId) : null;
    const followedGuild = followedChannel?.guild_id ? GuildStore.getGuild(followedChannel.guild_id) : null;

    function doFollow(userId: string) {
        if (settings.store.followUserId !== userId) toggleFollow(userId);
        forceUpdate();
    }

    function doUnfollow() {
        if (settings.store.followUserId) toggleFollow(settings.store.followUserId);
        forceUpdate();
    }

    function doJoin(channelId: string) {
        triggerFollow(channelId);
        modalProps.onClose();
    }

    function doUnpin(userId: string) {
        togglePin(userId);
        forceUpdate();
    }

    return (
        <ModalRoot {...modalProps} title="Follow User" size={ModalSize.MEDIUM}>
            <ModalHeader>
                <span style={{ fontSize: "20px", fontWeight: 700, color: "#ffffff" }}>
                    Follow User
                </span>
            </ModalHeader>

            <ModalContent>
                <div style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "16px 0" }}>
                    <div>
                        <SectionLabel>Currently Following</SectionLabel>
                        {followUserId ? (
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "14px",
                                padding: "16px",
                                backgroundColor: "var(--background-secondary)",
                                borderRadius: "10px",
                                border: "2px solid var(--status-positive)"
                            }}>
                                <UserAvatar userId={followUserId} size="SIZE_48" />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: "16px", fontWeight: 700, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {UserStore.getUser(followUserId)?.username ?? followedUsername ?? followUserId}
                                    </div>
                                    <div style={{ fontSize: "13px", color: "#ffffff", marginTop: "4px" }}>
                                        {followedChannel
                                            ? `#${followedChannel.name}${followedGuild ? ` — ${followedGuild.name}` : ""}`
                                            : "Not in voice right now"}
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                                    {followedChannel && (
                                        <Button size={Button.Sizes.MEDIUM} color={Button.Colors.GREEN} onClick={() => doJoin(followedChannel.id)}>
                                            Join
                                        </Button>
                                    )}
                                    <Button size={Button.Sizes.MEDIUM} color={Button.Colors.RED} onClick={doUnfollow}>
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
                                color: "#ffffff",
                                fontSize: "14px",
                                textAlign: "center"
                            }}>
                                Not following anyone. Right-click a user to follow, or pick a friend below.
                            </div>
                        )}
                    </div>

                    <div>
                        <SectionLabel>Pinned Users {pinnedUsers.length > 0 ? `(${pinnedUsers.length})` : null}</SectionLabel>
                        {pinnedUsers.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                {pinnedUsers.map(person => {
                                    const isFollowingThis = followUserId === person.userId;
                                    return (
                                        <div
                                            key={person.userId}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "12px",
                                                padding: "12px 14px",
                                                backgroundColor: "var(--background-secondary)",
                                                borderRadius: "8px",
                                                border: `1px solid ${isFollowingThis ? "var(--status-positive)" : "var(--background-modifier-accent)"}`
                                            }}
                                        >
                                            <UserAvatar userId={person.userId} size="SIZE_40" />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: "15px", fontWeight: 600, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {person.username}
                                                </div>
                                                <div style={{ fontSize: "13px", color: "#ffffff", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {person.channelName
                                                        ? `#${person.channelName} — ${person.guildName}`
                                                        : "Not in voice right now"}
                                                </div>
                                            </div>
                                            <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                                {person.channelId && (
                                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => doJoin(person.channelId!)}>
                                                        Join
                                                    </Button>
                                                )}
                                                {isFollowingThis ? (
                                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={doUnfollow}>
                                                        Unfollow
                                                    </Button>
                                                ) : (
                                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={() => doFollow(person.userId)}>
                                                        Follow
                                                    </Button>
                                                )}
                                                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => doUnpin(person.userId)}>
                                                    Unpin
                                                </Button>
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
                                color: "#ffffff",
                                fontSize: "14px",
                                textAlign: "center"
                            }}>
                                No pinned users. Right-click a user and choose "Pin to Follow Panel".
                            </div>
                        )}
                    </div>

                    <div>
                        <SectionLabel>Friends in Voice {friendsInVoice.length > 0 ? `(${friendsInVoice.length})` : null}</SectionLabel>
                        {friendsInVoice.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                {friendsInVoice.map(friend => {
                                    const isFollowingThis = followUserId === friend.userId;
                                    return (
                                        <div
                                            key={friend.userId}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "12px",
                                                padding: "12px 14px",
                                                backgroundColor: "var(--background-secondary)",
                                                borderRadius: "8px",
                                                border: `1px solid ${isFollowingThis ? "var(--status-positive)" : "var(--background-modifier-accent)"}`
                                            }}
                                        >
                                            <UserAvatar userId={friend.userId} size="SIZE_40" />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: "15px", fontWeight: 600, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {friend.username}
                                                </div>
                                                <div style={{ fontSize: "13px", color: "#ffffff", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    #{friend.channelName} — {friend.guildName}
                                                </div>
                                            </div>
                                            <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => doJoin(friend.channelId)}>
                                                    Join
                                                </Button>
                                                {isFollowingThis ? (
                                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={doUnfollow}>
                                                        Unfollow
                                                    </Button>
                                                ) : (
                                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={() => doFollow(friend.userId)}>
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
                                color: "#ffffff",
                                fontSize: "14px",
                                textAlign: "center"
                            }}>
                                No friends are currently in voice.
                            </div>
                        )}
                    </div>

                    {showNonFriendsInVoice && (
                        <div>
                            <SectionLabel>Non-Friends in Voice {nonFriendsInVoice.length > 0 ? `(${nonFriendsInVoice.length})` : null}</SectionLabel>
                            {nonFriendsInVoice.length > 0 ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    {nonFriendsInVoice.map(person => {
                                        const isFollowingThis = followUserId === person.userId;
                                        return (
                                            <div
                                                key={person.userId}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "12px",
                                                    padding: "12px 14px",
                                                    backgroundColor: "var(--background-secondary)",
                                                    borderRadius: "8px",
                                                    border: `1px solid ${isFollowingThis ? "var(--status-positive)" : "var(--background-modifier-accent)"}`
                                                }}
                                            >
                                                <UserAvatar userId={person.userId} size="SIZE_40" />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: "15px", fontWeight: 600, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {person.username}
                                                    </div>
                                                    <div style={{ fontSize: "13px", color: "#ffffff", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        #{person.channelName} — {person.guildName}
                                                    </div>
                                                </div>
                                                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => doJoin(person.channelId)}>
                                                        Join
                                                    </Button>
                                                    {isFollowingThis ? (
                                                        <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={doUnfollow}>
                                                            Unfollow
                                                        </Button>
                                                    ) : (
                                                        <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={() => doFollow(person.userId)}>
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
                                    color: "#ffffff",
                                    fontSize: "14px",
                                    textAlign: "center"
                                }}>
                                    No non-friends are currently in voice.
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <SectionLabel>Active Settings</SectionLabel>
                        <div style={{
                            padding: "12px 16px",
                            backgroundColor: "var(--background-secondary)",
                            borderRadius: "8px",
                            border: "1px solid var(--background-modifier-accent)",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "16px",
                            fontSize: "13px"
                        }}>
                            {[
                                { label: "Only when in voice", value: settings.store.onlyWhenInVoice },
                                { label: "Join same VC on follow", value: settings.store.executeOnFollow },
                                { label: "Leave when they leave", value: settings.store.followLeave },
                                { label: "Auto move back", value: settings.store.autoMoveBack },
                                { label: "Snipe on leave", value: settings.store.snipeOnLeave },
                                { label: "Manual trigger only", value: settings.store.onlyManualTrigger }
                            ].map(({ label, value }) => (
                                <div key={label} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                                    <div style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        flexShrink: 0,
                                        backgroundColor: value ? "var(--status-positive)" : "var(--status-danger)"
                                    }} />
                                    <span style={{ color: "#ffffff" }}>{label}:</span>
                                    <span style={{ color: "#ffffff", fontWeight: 600 }}>{value ? "On" : "Off"}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </ModalContent>

            <ModalFooter className={Margins.top8}>
                <Button color={Button.Colors.PRIMARY} onClick={() => modalProps.onClose()}>
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function PanelButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { showPanelButton, followUserId, followedUsername } = settings.use(["showPanelButton", "followUserId", "followedUsername"]);
    if (!showPanelButton) return null;

    const isFollowing = !!followUserId;
    const name = (followUserId && UserStore.getUser(followUserId)?.username) || followedUsername;

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : isFollowing ? `Following ${name}` : "Follow User"}
            icon={<FollowIcon className={iconForeground} active={isFollowing} />}
            role="button"
            aria-checked={isFollowing}
            plated={nameplate != null}
            onClick={() => openModal(props => <FollowUserModal modalProps={props} />)}
        />
    );
}

const PanelButtonBoundary = ErrorBoundary.wrap(PanelButton, { noop: true });
export const FollowPanelButton: UserAreaButtonFactory = props => <PanelButtonBoundary {...props} />;
export { FollowIcon };
