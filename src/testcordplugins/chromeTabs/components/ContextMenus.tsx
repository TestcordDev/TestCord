/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getIntlMessage } from "@utils/discord";
import { ChannelStore, FluxDispatcher, Menu, ReadStateStore, ReadStateUtils } from "@webpack/common";

import { getSyntheticPage } from "../util/pages";
import { closeOtherTabs, closeTab, closeTabsToTheLeft, closeTabsToTheRight, createTabAfter, hasClosedTabs, reopenClosedTab } from "../util/store";
import { Tab } from "../util/types";

export function TabContextMenu({ tab, index, tabCount }: { tab: Tab; index: number; tabCount: number; }) {
    const channel = ChannelStore.getChannel(tab.channelId);
    const isSyntheticPage = !!getSyntheticPage(tab.channelId);
    const canClose = tabCount > 1;

    return (
        <Menu.Menu
            navId="tc-chrometabs-tab-context"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="Chrome Tabs Tab Context Menu"
        >
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="duplicate-tab"
                    label="Duplicate"
                    action={() => createTabAfter(tab.id, { guildId: tab.guildId, channelId: tab.channelId }, true)}
                />
                {channel && !isSyntheticPage && (
                    <Menu.MenuItem
                        id="mark-as-read"
                        label={getIntlMessage("MARK_AS_READ")}
                        disabled={!ReadStateStore.hasUnread(channel.id)}
                        action={() => ReadStateUtils.ackChannel(channel)}
                    />
                )}
            </Menu.MenuGroup>

            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="close-tab"
                    label="Close"
                    disabled={!canClose}
                    action={() => closeTab(tab.id)}
                />
                <Menu.MenuItem
                    id="close-other-tabs"
                    label="Close other tabs"
                    disabled={!canClose}
                    action={() => closeOtherTabs(tab.id)}
                />
                <Menu.MenuItem
                    id="close-left-tabs"
                    label="Close tabs to the left"
                    disabled={index === 0}
                    action={() => closeTabsToTheLeft(tab.id)}
                />
                <Menu.MenuItem
                    id="close-right-tabs"
                    label="Close tabs to the right"
                    disabled={index === tabCount - 1}
                    action={() => closeTabsToTheRight(tab.id)}
                />
            </Menu.MenuGroup>

            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="reopen-closed-tab"
                    label="Reopen closed tab"
                    disabled={!hasClosedTabs()}
                    action={() => reopenClosedTab()}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

export function StripContextMenu({ onNewTab }: { onNewTab: () => void; }) {
    return (
        <Menu.Menu
            navId="tc-chrometabs-strip-context"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="Chrome Tabs Context Menu"
        >
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="new-tab"
                    label="New tab"
                    action={onNewTab}
                />
                <Menu.MenuItem
                    id="reopen-closed-tab"
                    label="Reopen closed tab"
                    disabled={!hasClosedTabs()}
                    action={() => reopenClosedTab()}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}
