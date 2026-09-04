/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, Menu } from "@webpack/common";
import { JSX } from "react";

import { ChromeTabsStrip } from "./components/ChromeTabsStrip";
import { removeChromeTabSwitcher } from "./components/ChromeTabSwitcher";
import { getSyntheticPageIdForPath, handleNavigation, isSelfNavigation, openTarget, settings } from "./util";
import * as ChromeTabsStore from "./util/store";

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
    description: "Browser-style channel tabs styled after Google Chrome, with curved tabs that fuse into the app below",
    tags: ["Appearance", "Customisation", "Organisation", "Servers", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["ContextMenuAPI"],

    settings,
    stop() {
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
            predicate: () => settings.store.tabBarPosition !== "titlebar",
            replacement: {
                match: /"div",{(?=.{0,80}(\i\?\.params))/,
                replace: "$self.render,{currentTarget:$1,"
            }
        },

        {
            find: '"data-window-chrome"',
            predicate: () => settings.store.tabBarPosition === "titlebar",
            replacement: {
                match: /(\i)&&\(0,\i\.jsx\)\(\i,\{windowKey:\i,showDivider:null!=\i\}\)/,
                replace: "$self.renderTitleBarTabs(),$&"
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
        }
    },

    render({ currentTarget, children }: {
        currentTarget: { guildId: string; channelId: string; };
        children: JSX.Element;
    }) {
        if (settings.store.tabBarPosition === "titlebar") return children;

        const strip = (
            <ErrorBoundary noop>
                <ChromeTabsStrip
                    guildId={currentTarget?.guildId || "@me"}
                    channelId={currentTarget?.channelId}
                />
            </ErrorBoundary>
        );

        return settings.store.tabBarPosition === "bottom"
            ? <>{children}{strip}</>
            : <>{strip}{children}</>;
    },

    renderTitleBarTabs() {
        return (
            <ErrorBoundary noop>
                <ChromeTabsStrip guildId="@me" channelId="__friends__" titleBar />
            </ErrorBoundary>
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
