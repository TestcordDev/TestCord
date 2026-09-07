/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, GuildChannelStore, GuildMemberStore, Menu, SelectedChannelStore, UserStore } from "@webpack/common";
import { JSX } from "react";

import { ChromeTabsStrip } from "./components/ChromeTabsStrip";
import { removeChromeTabSwitcher } from "./components/ChromeTabSwitcher";
import { getSyntheticPageIdForPath, handleNavigation, isSelfNavigation, openTarget, settings } from "./util";
import * as ChromeTabsStore from "./util/store";

function parseChannelUrl(url: string): { guildId: string; channelId?: string; messageId?: string; } | null {
    try {
        const path = url.startsWith("http") ? new URL(url).pathname : url;
        const match = path.match(/^\/channels\/([@\w]+)(?:\/([a-zA-Z0-9_-]+))?(?:\/(\d+))?/);
        if (!match) return null;
        return {
            guildId: match[1],
            channelId: match[2],
            messageId: match[3]
        };
    } catch {
        return null;
    }
}

function findTargetFromFiber(target: HTMLElement): { guildId?: string; channelId?: string; } | null {
    if (target.closest('[class*="messageListItem"], [id^="chat-messages-"], [class*="messageContent"], [role="article"], [class*="markup_"]')) {
        return null;
    }

    let curr: HTMLElement | null = target;
    let depth = 0;
    while (curr && depth < 8) {
        const fiberKey = Object.keys(curr).find(k => k.startsWith("__reactFiber$"));
        if (fiberKey) {
            let fiber = (curr as unknown as Record<string, unknown>)[fiberKey] as {
                memoizedProps?: Record<string, unknown>;
                return?: any;
            } | null;
            let fDepth = 0;
            while (fiber && fDepth < 10) {
                const memo = fiber.memoizedProps;
                if (memo) {
                    if (memo.message || memo.messageId) {
                        return null;
                    }
                    const channel = memo.channel as Channel | undefined;
                    const channelId = (memo.channelId as string | undefined) || channel?.id;
                    if (channelId) {
                        const guildId = (memo.guildId as string | undefined) || channel?.guild_id || (memo.guild as { id?: string; } | undefined)?.id;
                        return { guildId, channelId };
                    }
                    const guildId = (memo.guildId as string | undefined) || (memo.guild as { id?: string; } | undefined)?.id;
                    if (guildId) {
                        const cid = SelectedChannelStore.getChannelId(guildId) || GuildChannelStore.getDefaultChannel(guildId)?.id;
                        return { guildId, channelId: cid };
                    }
                }
                fiber = fiber.return;
                fDepth++;
            }
        }
        curr = curr.parentElement;
        depth++;
    }
    return null;
}

function openTargetInNewTab(guildId: string, channelId?: string, messageId?: string) {
    let cid = channelId;
    if (!cid) {
        if (guildId === "@me") cid = "__friends__";
        else cid = SelectedChannelStore.getChannelId(guildId) || GuildChannelStore.getDefaultChannel(guildId)?.id;
    }
    if (!cid) return;

    const active = ChromeTabsStore.getActiveTab();
    if (active) {
        ChromeTabsStore.createTabAfter(active.id, { guildId, channelId: cid }, true, messageId);
    } else {
        ChromeTabsStore.createTab({ guildId, channelId: cid }, true, messageId);
    }
}

function handleGlobalClick(e: MouseEvent) {
    if (!settings.store.ctrlClickNewTab) return;
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.button !== 0) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.closest('[class*="messageListItem"], [id^="chat-messages-"], [class*="messageContent"], [role="article"], [class*="markup_"]')) {
        return;
    }

    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (anchor) {
        const href = anchor.getAttribute("href");
        if (href) {
            const parsed = parseChannelUrl(href);
            if (parsed) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                openTargetInNewTab(parsed.guildId, parsed.channelId, parsed.messageId);
                return;
            }
        }
    }

    const guildItem = target.closest('[data-list-item-id^="guildsnav___"]') as HTMLElement | null;
    if (guildItem) {
        const guildId = guildItem.getAttribute("data-list-item-id")?.replace("guildsnav___", "");
        if (guildId) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openTargetInNewTab(guildId);
            return;
        }
    }
    const fromFiber = findTargetFromFiber(target);
    if (fromFiber?.channelId) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openTargetInNewTab(fromFiber.guildId || "@me", fromFiber.channelId);
    }
}

const openInNewTab: NavContextMenuPatchCallback = (children, props: { channel: Channel; messageId?: string; }) => {
    const { channel, messageId } = props;
    if (!channel) return;

    const item = (
        <Menu.MenuItem
            id="tc-chrometabs-open-in-new-tab"
            label="Open in New Tab"
            action={() => openTarget(
                { guildId: channel.guild_id || "@me", channelId: channel.id },
                true,
                messageId
            )}
        />
    );

    const group = findGroupChildrenByChildId("channel-copy-link", children);
    if (group) group.push(item);
    else children.splice(-1, 0, <Menu.MenuGroup>{item}</Menu.MenuGroup>);
};

export default definePlugin({
    name: "ChromeTabs",
    description: "Browser-style channel tabs styled after Google Chrome",
    tags: ["Appearance", "Customisation", "Organisation", "Servers", "Utility"],
    authors: [TestcordDevs.SirPhantom89],
    dependencies: ["ContextMenuAPI"],

    settings,
    start() {
        window.addEventListener("click", handleGlobalClick, true);
    },
    stop() {
        window.removeEventListener("click", handleGlobalClick, true);
        removeChromeTabSwitcher();
    },

    contextMenus: {
        "channel-context": openInNewTab,
        "channel-mention-context": openInNewTab,
        "user-context": openInNewTab,
        "gdm-context": openInNewTab
    },

    patches: [
        {
            find: '"AppView"',
            replacement: {
                match: /"div",{(?=.{0,80}(\i\?\.params))/,
                replace: "$self.render,{currentTarget:$1,"
            }
        },

        {
            find: '"data-window-chrome"',
            replacement: {
                match: /onDoubleClick:(\i),children:(\i)\}\),\(0,(\i)\.jsx\)\("div",\{className:(\i\.\i),children:(\i)\}/,
                replace: 'onDoubleClick:$1,children:$self.renderTitleBarLeading($2)}),(0,$3.jsx)("div",{className:$4,children:$self.isTitleBar()?null:$5}'
            }
        },
        {
            find: ".deleteRecentMention(",
            replacement: {
                match: /(?<=className:\i.\i,onJump:)(\i)=>(\i\(\i,\i\.id\))(?=.{0,40}message:(\i))/,
                replace: "$1 => { if ($1?.ctrlKey) $self.openMessage($3); else $2 }"
            }
        },
        {
            find: "__invalid_searchResultFocusRing",
            replacement: {
                match: /(\i)\.stopPropagation.{0,50}(?=null!=(\i))/,
                replace: "$&if ($1.ctrlKey) return $self.openMessage($2);"
            }
        }
    ],

    flux: {
        CHANNEL_SELECT({ channelId, guildId }: { channelId: string | null; guildId: string | null; }) {
            if (isSelfNavigation()) {
                ChromeTabsStore.endSelfNavigation();
                return;
            }

            if (channelId) {
                handleNavigation({ guildId: guildId || "@me", channelId });
                return;
            }

            const syntheticId = getSyntheticPageIdForPath(window.location.pathname);
            if (syntheticId) handleNavigation({ guildId: "@me", channelId: syntheticId });
        },

        MESSAGE_CREATE({ message, optimistic, type }: { message: Message; optimistic?: boolean; type?: string; }) {
            if (!settings.store.openTabOnMention) return;
            if (optimistic || (type === "MESSAGE_CREATE" && message.state === "SENDING")) return;

            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!currentUserId || message.author?.id === currentUserId) return;

            const isMentioned = message.mentions?.some(m => (typeof m === "string" ? m === currentUserId : (m as unknown as { id: string; })?.id === currentUserId));
            const channel = ChannelStore.getChannel(message.channel_id);
            const guildId = channel?.guild_id || "@me";

            let isRoleMentioned = false;
            if (!isMentioned && channel?.guild_id && message.mentionRoles?.length) {
                const member = GuildMemberStore.getMember(channel.guild_id, currentUserId);
                if (member?.roles?.length) {
                    isRoleMentioned = message.mentionRoles.some(roleId => member.roles.includes(roleId));
                }
            }

            if (!isMentioned && !isRoleMentioned) return;

            const active = ChromeTabsStore.getActiveTab();
            if (active && active.channelId === message.channel_id) return;

            const existing = ChromeTabsStore.getTabs().find(t => t.channelId === message.channel_id);
            if (existing) {
                ChromeTabsStore.retargetTab(existing.id, { guildId, channelId: message.channel_id }, message.id);
                if (settings.store.focusTabOnMention) {
                    ChromeTabsStore.activateTab(existing.id);
                }
                return;
            }

            if (active) {
                ChromeTabsStore.createTabAfter(
                    active.id,
                    { guildId, channelId: message.channel_id },
                    settings.store.focusTabOnMention,
                    message.id
                );
            } else {
                ChromeTabsStore.createTab(
                    { guildId, channelId: message.channel_id },
                    settings.store.focusTabOnMention,
                    message.id
                );
            }
        }
    },

    render({ currentTarget, children }: {
        currentTarget: { guildId: string; channelId: string; };
        children: JSX.Element;
    }) {
        const { tabBarPosition, collapsible } = settings.store;
        if (tabBarPosition === "titlebar") return children;

        const strip = (
            <ErrorBoundary noop>
                <ChromeTabsStrip
                    guildId={currentTarget?.guildId || "@me"}
                    channelId={currentTarget?.channelId}
                    position={tabBarPosition as "left" | "top" | "bottom" | "right" | "titlebar"}
                    collapsible={collapsible}
                />
            </ErrorBoundary>
        );

        if (tabBarPosition === "bottom") {
            return (
                <div className={classes("tc-chrometabs-app-col", "tc-chrometabs-layout-bottom")}>
                    <div className="tc-chrometabs-app-main">{children}</div>
                    {strip}
                </div>
            );
        }

        if (tabBarPosition === "left") {
            return (
                <div className={classes("tc-chrometabs-app-row", "tc-chrometabs-layout-left")}>
                    {strip}
                    <div className="tc-chrometabs-app-main">{children}</div>
                </div>
            );
        }

        if (tabBarPosition === "right") {
            return (
                <div className={classes("tc-chrometabs-app-row", "tc-chrometabs-layout-right")}>
                    <div className="tc-chrometabs-app-main">{children}</div>
                    {strip}
                </div>
            );
        }

        return (
            <div className={classes("tc-chrometabs-app-col", "tc-chrometabs-layout-top")}>
                {strip}
                <div className="tc-chrometabs-app-main">{children}</div>
            </div>
        );
    },

    isTitleBar() {
        return settings.store.tabBarPosition === "titlebar";
    },

    renderTitleBarLeading(leading: JSX.Element) {
        if (!this.isTitleBar()) return leading;
        return (
            <>
                {leading}
                <ErrorBoundary noop>
                    <ChromeTabsStrip
                        guildId="@me"
                        channelId="__friends__"
                        titleBar
                        position="titlebar"
                        collapsible={settings.store.collapsible}
                    />
                </ErrorBoundary>
            </>
        );
    },

    openMessage(message: Message) {
        const channel = ChannelStore.getChannel(message.channel_id);

        openTarget(
            { guildId: channel?.guild_id || "@me", channelId: message.channel_id },
            false,
            message.id
        );
    },

    util: ChromeTabsStore
});
