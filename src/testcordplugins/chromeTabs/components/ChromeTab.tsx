/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { classNameFactory } from "@utils/css";
import { getGuildAcronym, getUniqueUsername } from "@utils/discord";
import { classes } from "@utils/misc";
import { Channel, Guild, User } from "@vencord/discord-types";
import { ActiveJoinedThreadsStore, Avatar, ChannelStore, ContextMenuApi, GuildStore, PresenceStore, ReadStateStore, Tooltip, useCallback, useMemo, UserStore, useStateFromStores } from "@webpack/common";

import { ChannelTypeIcon, CircleQuestionIcon, CloseIcon } from "../util/icons";
import { getSyntheticPage } from "../util/pages";
import { settings } from "../util/settings";
import { activateTab, closeTab, getTabs } from "../util/store";
import { Tab } from "../util/types";
import { formatBadgeCount, getUnreadBadgeState } from "../util/unread";
import { TabContextMenu } from "./ContextMenus";

const cl = classNameFactory("tc-chrometabs-");

/** Chrome's tab corner curve, drawn as an SVG so the tab merges into the strip */
function TabShape() {
    return (
        <svg className={cl("shape")} viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true">
            {/*
                Left curve out of the strip, flat top, right curve back down.
                Rendered with preserveAspectRatio="none" so it stretches to any tab width
                while the 8px corner radii stay visually close to Chrome's.
            */}
            <path d="M0 36 C4 36 6 34 6 30 L6 8 C6 3.6 9.6 0 14 0 L186 0 C190.4 0 194 3.6 194 8 L194 30 C194 34 196 36 200 36 Z" />
        </svg>
    );
}

function GuildIcon({ guild }: { guild: Guild; }) {
    if (!guild.icon) {
        return (
            <div className={cl("favicon", "acronym")}>
                <BaseText size="xxs" weight="semibold" tag="span">{getGuildAcronym(guild)}</BaseText>
            </div>
        );
    }

    return (
        <img
            className={cl("favicon")}
            src={`https://${window.GLOBAL_ENV.CDN_HOST}/icons/${guild.id}/${guild.icon}.png?size=32`}
            alt=""
        />
    );
}

function GroupIcon({ channel }: { channel: Channel; }) {
    return (
        <img
            className={cl("favicon")}
            src={channel.icon
                ? `https://${window.GLOBAL_ENV.CDN_HOST}/channel-icons/${channel.id}/${channel.icon}.png?size=32`
                : "https://discord.com/assets/c6851bd0b03f1cca5a8c1e720ea6ea17.png"}
            alt=""
        />
    );
}

function UnreadBadge({ channelId }: { channelId: string; }) {
    const state = useStateFromStores(
        [ReadStateStore, ActiveJoinedThreadsStore],
        () => {
            const channel = ChannelStore.getChannel(channelId);
            const newThreads = channel?.guild_id && channel.isForumLikeChannel?.()
                ? ActiveJoinedThreadsStore.getNewThreadCount(channel.guild_id, channel.id)
                : 0;

            return {
                channelId,
                hasUnread: ReadStateStore.hasUnread(channelId) || newThreads > 0,
                mentionCount: ReadStateStore.getMentionCount(channelId),
                unreadCount: ReadStateStore.getUnreadCount(channelId) || newThreads
            };
        }
    );

    const { count, hasMention, shouldShow } = getUnreadBadgeState(state);
    if (!shouldShow) return null;

    return (
        <div
            className={cl("badge", { mention: hasMention, dot: count == null })}
            data-mention={hasMention}
        >
            {count != null && formatBadgeCount(count)}
        </div>
    );
}

/** The favicon-position icon plus the tab label */
function TabLabel({ tab }: { tab: Tab; }) {
    const { useDisplayNames, showDmStatus } = settings.use(["useDisplayNames", "showDmStatus"]);

    const guild = GuildStore.getGuild(tab.guildId);
    const channel = ChannelStore.getChannel(tab.channelId);
    const recipients = channel?.recipients;
    const dmRecipientId = recipients?.length === 1 ? recipients[0] : undefined;

    const status = useStateFromStores(
        [PresenceStore],
        () => dmRecipientId ? PresenceStore.getStatus(dmRecipientId) : undefined,
        [dmRecipientId]
    );
    const isMobile = useStateFromStores(
        [PresenceStore],
        () => dmRecipientId ? PresenceStore.isMobileOnline(dmRecipientId) : false,
        [dmRecipientId]
    );

    const page = getSyntheticPage(tab.channelId);
    if (page) {
        const { Icon } = page;
        return <>
            <div className={cl("favicon", "glyph")}><Icon width={16} height={16} /></div>
            <BaseText className={cl("label")} size="sm">{page.label}</BaseText>
        </>;
    }

    // guild channel
    if (guild) {
        return <>
            <GuildIcon guild={guild} />
            <div className={cl("channel-glyph")}>
                {channel && <ChannelTypeIcon channel={channel} guild={guild} />}
            </div>
            <BaseText className={cl("label")} size="sm">
                {channel?.name ?? "Unknown Channel"}
            </BaseText>
        </>;
    }

    // 1:1 DM
    if (channel && dmRecipientId) {
        const user = UserStore.getUser(dmRecipientId) as User & { globalName?: string; };
        const name = user
            ? (useDisplayNames ? (user.globalName || user.username) : getUniqueUsername(user))
            : "Direct Message";

        return <>
            <div className={cl("favicon")}>
                <Avatar
                    size="SIZE_16"
                    src={user?.getAvatarURL(undefined, 32)}
                    status={showDmStatus ? status : undefined}
                    isMobile={isMobile}
                />
            </div>
            <BaseText className={cl("label")} size="sm">{name}</BaseText>
        </>;
    }

    // group DM
    if (channel && recipients?.length) {
        return <>
            <GroupIcon channel={channel} />
            <BaseText className={cl("label")} size="sm">
                {channel.name || "Group DM"}
            </BaseText>
        </>;
    }

    return <>
        <div className={cl("favicon", "glyph")}><CircleQuestionIcon width={16} height={16} /></div>
        <BaseText className={cl("label")} size="sm">Unknown Channel</BaseText>
    </>;
}

export interface ChromeTabProps {
    tab: Tab;
    index: number;
    isActive: boolean;
    /** hides the close button when only one tab is open, like Chrome */
    canClose: boolean;
    /** true while this tab is the one being dragged */
    isDragging: boolean;
    onDragStart: (index: number) => void;
    onDragEnter: (index: number) => void;
    onDragEnd: () => void;
}

export function ChromeTab({
    tab,
    index,
    isActive,
    canClose,
    isDragging,
    onDragStart,
    onDragEnter,
    onDragEnd
}: ChromeTabProps) {
    const { showUnreadBadges } = settings.use(["showUnreadBadges"]);

    const tooltipText = useMemo(() => {
        const page = getSyntheticPage(tab.channelId);
        if (page) return page.label;

        const channel = ChannelStore.getChannel(tab.channelId);
        const guild = GuildStore.getGuild(tab.guildId);
        if (guild && channel) return `#${channel.name} — ${guild.name}`;
        return channel?.name ?? "Unknown Channel";
    }, [tab.channelId, tab.guildId]);

    const handleAuxClick = useCallback((e: React.MouseEvent) => {
        if (e.button === 1 && canClose) {
            e.preventDefault();
            closeTab(tab.id);
        }
    }, [canClose, tab.id]);

    const handleClose = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        closeTab(tab.id);
    }, [tab.id]);

    return (
        <div
            className={classes(
                cl("tab"),
                isActive && cl("tab-active"),
                isDragging && cl("tab-dragging")
            )}
            role="tab"
            aria-selected={isActive}
            draggable
            onClick={() => activateTab(tab.id)}
            onAuxClick={handleAuxClick}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => (
                <TabContextMenu tab={tab} index={index} tabCount={getTabs().length} />
            ))}
            onDragStart={() => onDragStart(index)}
            onDragEnter={() => onDragEnter(index)}
            onDragEnd={onDragEnd}
            onDragOver={e => e.preventDefault()}
        >
            <TabShape />

            <Tooltip text={tooltipText}>
                {tooltipProps => (
                    <div className={cl("content")} {...tooltipProps}>
                        <TabLabel tab={tab} />
                        {showUnreadBadges && <UnreadBadge channelId={tab.channelId} />}

                        {canClose && (
                            <button
                                className={cl("close")}
                                onClick={handleClose}
                                aria-label="Close tab"
                            >
                                <CloseIcon size={14} />
                            </button>
                        )}
                    </div>
                )}
            </Tooltip>

            {/* Chrome's vertical separator, hidden next to the active tab */}
            <div className={cl("separator")} />
        </div>
    );
}
