/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Badge } from "@components/Badge";
import { BaseText } from "@components/BaseText";
import { getGuildAcronym, getUniqueUsername } from "@utils/discord";
import { classes } from "@utils/misc";
import { Channel, Guild, User } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import {
    Avatar,
    ChannelStore,
    Clickable,
    createRoot,
    GuildStore,
    PresenceStore,
    React,
    ReadStateStore,
    useEffect,
    useRef,
    UserStore
} from "@webpack/common";

import { ChannelTypeIcon, CloseIcon, UsersIcon } from "../util/icons";
import { getSyntheticPage, isSyntheticChannelId } from "../util/pages";
import { settings } from "../util/settings";
import { activateTab, closeTab, getActiveTabId, getMRUTabs } from "../util/store";
import { Tab } from "../util/types";

const DiscordKeybindShortcut = findComponentByCodeLazy(".combo,", ".key,");

function Keycap({ shortcut }: { shortcut: string; }) {
    if (DiscordKeybindShortcut) {
        try {
            const Comp = DiscordKeybindShortcut as any;
            return <Comp shortcut={shortcut} />;
        } catch { }
    }
    return (
        <span className="tc-chrometabs-keycap">
            <BaseText size="xxs" weight="semibold" color="text-default">{shortcut.toUpperCase()}</BaseText>
        </span>
    );
}

interface TabMeta {
    title: string;
    sub: string;
    isChannelSub: boolean;
    guildName: string;
    iconUrl: string | null;
    initial: string;
    isDM: boolean;
    isGroupDM: boolean;
    userId?: string;
    status?: string;
    channel?: Channel;
    guild?: Guild;
    mentionCount: number;
    syntheticIcon?: React.ComponentType<{ width?: number; height?: number; }>;
}

function getTabMeta(tab: Tab): TabMeta {
    if (isSyntheticChannelId(tab.channelId)) {
        const page = getSyntheticPage(tab.channelId);
        return {
            title: page?.label ?? "Navigation",
            sub: "DISCORD",
            isChannelSub: true,
            guildName: "Discord",
            iconUrl: null,
            initial: (page?.label ?? "N").charAt(0).toUpperCase(),
            isDM: false,
            isGroupDM: false,
            mentionCount: 0,
            syntheticIcon: page?.Icon
        };
    }

    const channel = ChannelStore.getChannel(tab.channelId) as Channel | undefined;
    const isDM = tab.guildId === "@me";

    if (!isDM) {
        const guild = GuildStore.getGuild(tab.guildId) as Guild | undefined;
        const isVoice = (channel as any)?.isVoice?.();
        const isThread = (channel as any)?.isThread?.();
        const title = channel?.name ?? "channel";
        const sub = isThread
            ? "THREAD"
            : (isVoice ? "VOICE CHANNEL" : "TEXT CHANNEL");
        const guildName = guild?.name ?? "Server";
        const initial = guild ? getGuildAcronym(guild) : "#";
        const mentionCount = settings.store.showUnreadBadges ? (ReadStateStore.getMentionCount?.(tab.channelId) ?? 0) : 0;
        const cdnHost = (window as any).GLOBAL_ENV?.CDN_HOST ?? "cdn.discordapp.com";
        const iconUrl = guild?.icon
            ? `https://${cdnHost}/icons/${guild.id}/${guild.icon}.webp?size=32`
            : null;

        return {
            title,
            sub,
            isChannelSub: true,
            guildName,
            iconUrl,
            initial,
            isDM: false,
            isGroupDM: false,
            channel,
            guild,
            mentionCount
        };
    }

    // Direct message / Group DM
    if ((channel as any)?.isGroupDM?.() || (channel as any)?.isMultiUserDM?.()) {
        const title = channel?.name || "Group DM";
        const sub = `${(channel as any)?.recipients?.length ?? 0} MEMBERS`;
        const cdnHost = (window as any).GLOBAL_ENV?.CDN_HOST ?? "cdn.discordapp.com";
        const iconUrl = channel?.icon
            ? `https://${cdnHost}/channel-icons/${channel.id}/${channel.icon}.webp?size=32`
            : null;
        const mentionCount = settings.store.showUnreadBadges ? (ReadStateStore.getMentionCount?.(tab.channelId) ?? 0) : 0;

        return {
            title,
            sub,
            isChannelSub: true,
            guildName: "",
            iconUrl,
            initial: title.charAt(0).toUpperCase() || "G",
            isDM: false,
            isGroupDM: true,
            channel,
            mentionCount
        };
    }

    const recipientId = (channel as any)?.getRecipientId?.() ?? (channel as any)?.recipients?.[0] ?? (channel as any)?.rawRecipients?.[0]?.id;
    const user = recipientId ? (UserStore.getUser(recipientId) as User & { globalName?: string; } | undefined) : undefined;
    const displayName = settings.store.useDisplayNames
        ? (user?.globalName || user?.username)
        : (user ? getUniqueUsername(user) : undefined);
    const title = displayName || "Direct Message";
    const sub = user?.username ? `@${user.username}` : "";
    const iconUrl = user ? (user.getAvatarURL?.(undefined, 32) ?? null) : null;
    const initial = title.charAt(0).toUpperCase() || "@";
    const mentionCount = settings.store.showUnreadBadges ? (ReadStateStore.getMentionCount?.(tab.channelId) ?? 0) : 0;
    const status = recipientId ? (PresenceStore?.getStatus?.(recipientId) ?? "offline") : undefined;

    return {
        title,
        sub,
        isChannelSub: false,
        guildName: "",
        iconUrl,
        initial,
        isDM: true,
        isGroupDM: false,
        userId: recipientId,
        status,
        channel,
        mentionCount
    };
}

function TabIconView({ meta }: { meta: TabMeta; }) {
    if (meta.syntheticIcon) {
        const Icon = meta.syntheticIcon;
        return <Icon width={18} height={18} />;
    }

    if (meta.isDM && meta.userId) {
        return (
            <Avatar
                size="SIZE_24"
                src={meta.iconUrl ?? undefined}
                status={meta.status}
                aria-label={meta.title}
            />
        );
    }

    if (meta.isGroupDM) {
        if (meta.iconUrl) {
            return <img className="tc-chrometabs-switcher-icon-img" src={meta.iconUrl} alt="" />;
        }
        return <UsersIcon size={16} />;
    }

    if (meta.channel) {
        return <ChannelTypeIcon channel={meta.channel} guild={meta.guild} />;
    }

    if (meta.iconUrl) {
        return <img className="tc-chrometabs-switcher-icon-img" src={meta.iconUrl} alt="" />;
    }

    return (
        <div className="tc-chrometabs-switcher-icon-acronym">
            <BaseText size="xxs" weight="semibold" color="text-default">
                {meta.initial}
            </BaseText>
        </div>
    );
}

interface SwitcherModalProps {
    tabs: Tab[];
    selectedIndex: number;
    onSelect: (tabId: number) => void;
    onCloseTab: (tabId: number) => void;
    onHover: (index: number) => void;
}

function ChromeTabSwitcherModal({
    tabs,
    selectedIndex,
    onSelect,
    onCloseTab,
    onHover
}: SwitcherModalProps) {
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const selectedEl = list.children[selectedIndex] as HTMLElement | undefined;
        selectedEl?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    return (
        <div className="tc-chrometabs-switcher-overlay" onMouseDown={cancelChromeTabSwitcher}>
            <div className="tc-chrometabs-switcher-shell" onMouseDown={e => e.stopPropagation()}>
                {/* Header */}
                <div className="tc-chrometabs-switcher-header">
                    <BaseText size="xs" weight="bold" color="text-muted" className="tc-chrometabs-switcher-title">OPEN TABS</BaseText>
                    <BaseText size="xs" weight="semibold" color="text-muted">{tabs.length} tabs</BaseText>
                </div>

                {/* Tab Rows List */}
                <div
                    className="tc-chrometabs-switcher-list"
                    ref={listRef}
                    onWheel={e => {
                        const list = listRef.current;
                        if (!list) return;
                        const canScrollDown = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
                        const canScrollUp = list.scrollTop > 0;
                        const wantsDown = e.deltaY > 0;
                        if ((wantsDown && canScrollDown) || (!wantsDown && canScrollUp)) return;
                        e.preventDefault();
                        cycleChromeTabSwitcher(wantsDown ? 1 : -1);
                    }}
                >
                    {tabs.map((tab, idx) => {
                        const isSelected = idx === selectedIndex;
                        const meta = getTabMeta(tab);

                        return (
                            <Clickable
                                key={tab.id}
                                className={classes(
                                    "tc-chrometabs-switcher-row",
                                    isSelected && "tc-chrometabs-switcher-row-selected"
                                )}
                                onClick={() => onSelect(tab.id)}
                                onMouseEnter={() => onHover(idx)}
                            >
                                <div className="tc-chrometabs-switcher-icon-wrap">
                                    <TabIconView meta={meta} />
                                </div>

                                <div className="tc-chrometabs-switcher-row-content">
                                    <BaseText
                                        size="sm"
                                        weight="medium"
                                        color={isSelected ? "text-default" : "text-subtle"}
                                        lineClamp={1}
                                        className="tc-chrometabs-switcher-name"
                                    >
                                        {meta.title}
                                    </BaseText>
                                    {meta.sub && (
                                        <BaseText
                                            size="xs"
                                            weight="normal"
                                            color="text-muted"
                                            lineClamp={1}
                                            className={classes(
                                                "tc-chrometabs-switcher-sub",
                                                meta.isChannelSub && "tc-sub-channel"
                                            )}
                                        >
                                            {meta.sub}
                                        </BaseText>
                                    )}
                                </div>

                                <div className="tc-chrometabs-switcher-row-right">
                                    {meta.guildName && (
                                        <BaseText
                                            size="xs"
                                            weight="normal"
                                            color="text-muted"
                                            lineClamp={1}
                                            className="tc-chrometabs-switcher-guild"
                                        >
                                            {meta.guildName}
                                        </BaseText>
                                    )}
                                    {meta.mentionCount > 0 && (
                                        <Badge variant="danger" text={meta.mentionCount > 99 ? "99+" : meta.mentionCount} />
                                    )}
                                    {tabs.length > 1 && (
                                        <Clickable
                                            className="tc-chrometabs-switcher-action-btn"
                                            onClick={(e: React.MouseEvent) => {
                                                e.stopPropagation();
                                                onCloseTab(tab.id);
                                            }}
                                            title="Close tab"
                                            aria-label="Close tab"
                                        >
                                            <CloseIcon size={12} />
                                        </Clickable>
                                    )}
                                </div>
                            </Clickable>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="tc-chrometabs-switcher-footer">
                    <div className="tc-chrometabs-switcher-hint">
                        <Keycap shortcut="tab" />
                        <BaseText size="xs" weight="medium" color="text-muted">cycle</BaseText>
                        <BaseText size="xs" weight="medium" color="text-muted" className="tc-chrometabs-switcher-sep">•</BaseText>
                        <Keycap shortcut="ctrl" />
                        <BaseText size="xs" weight="medium" color="text-muted">release to switch</BaseText>
                    </div>
                    <div className="tc-chrometabs-switcher-hint">
                        <Keycap shortcut="esc" />
                        <BaseText size="xs" weight="medium" color="text-muted">cancel</BaseText>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Lifecycle & Keyboard Controller ─────────────────────────────────────────

let mountNode: HTMLDivElement | null = null;
let reactRoot: ReturnType<typeof createRoot> | null = null;
let allTabs: Tab[] = [];
let activeSelectedIndex = 0;
let cancelSwitch = false;

function renderComponent() {
    if (!reactRoot) return;
    reactRoot.render(
        <ChromeTabSwitcherModal
            tabs={allTabs}
            selectedIndex={activeSelectedIndex}
            onSelect={tabId => {
                removeChromeTabSwitcher();
                activateTab(tabId);
            }}
            onCloseTab={tabId => {
                closeTab(tabId);
                allTabs = allTabs.filter(t => t.id !== tabId);
                if (allTabs.length <= 1) {
                    removeChromeTabSwitcher();
                    return;
                }
                activeSelectedIndex = Math.min(activeSelectedIndex, allTabs.length - 1);
                renderComponent();
            }}
            onHover={idx => {
                activeSelectedIndex = idx;
                renderComponent();
            }}
        />
    );
}

export function isChromeTabSwitcherOpen(): boolean {
    return mountNode !== null;
}

export function removeChromeTabSwitcher() {
    if (reactRoot) {
        reactRoot.unmount();
        reactRoot = null;
    }
    mountNode?.remove();
    mountNode = null;
    allTabs = [];
    activeSelectedIndex = 0;
    cancelSwitch = false;
}

export function finishChromeTabSwitcher() {
    if (!mountNode) return;

    const selected = allTabs[activeSelectedIndex];
    const shouldNavigate = !cancelSwitch && selected && selected.id !== getActiveTabId();

    removeChromeTabSwitcher();
    if (shouldNavigate) {
        activateTab(selected.id);
    }
}

export function cancelChromeTabSwitcher() {
    if (!mountNode) return;
    cancelSwitch = true;
    removeChromeTabSwitcher();
}

export function cycleChromeTabSwitcher(direction: 1 | -1) {
    if (!mountNode) {
        allTabs = getMRUTabs(settings.store.ctrlTabOrder as "mru" | "strip");
        if (allTabs.length < 2) return;

        activeSelectedIndex = direction === 1 ? 1 : allTabs.length - 1;
        cancelSwitch = false;

        mountNode = document.createElement("div");
        mountNode.id = "tc-chrometabs-switcher-mount";
        document.body.appendChild(mountNode);

        reactRoot = createRoot(mountNode);
        renderComponent();
    } else {
        if (allTabs.length === 0) return;
        activeSelectedIndex = (activeSelectedIndex + direction + allTabs.length) % allTabs.length;
        renderComponent();
    }
}

export function handleSwitcherKeyDown(event: KeyboardEvent): boolean {
    if (event.key === "Escape") {
        if (!mountNode) return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        cancelChromeTabSwitcher();
        return true;
    }

    if (mountNode && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        finishChromeTabSwitcher();
        return true;
    }

    if (mountNode) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            cycleChromeTabSwitcher(1);
            return true;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            cycleChromeTabSwitcher(-1);
            return true;
        }
    }

    if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== "Tab") return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    cycleChromeTabSwitcher(event.shiftKey ? -1 : 1);
    return true;
}

export function handleSwitcherKeyUp(event: KeyboardEvent): boolean {
    if (event.key !== "Control" || !mountNode) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    finishChromeTabSwitcher();
    return true;
}
