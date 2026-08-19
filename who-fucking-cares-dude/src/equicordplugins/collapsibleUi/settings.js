/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const panelRegistry = {
    guildBar: {
        id: "guildBar",
        classId: "guild-bar",
        label: "Guild Bar",
        collapsedKey: "guildBarCollapsed",
    },
    channelList: {
        id: "channelList",
        classId: "channel-list",
        label: "Channel List",
        collapsedKey: "channelListCollapsed",
    },
    membersList: {
        id: "membersList",
        classId: "members-list",
        label: "Members List",
        collapsedKey: "membersListCollapsed",
    },
    chatButtons: {
        id: "chatButtons",
        classId: "chat-buttons",
        label: "Message Buttons",
        collapsedKey: "chatButtonsCollapsed",
    },
    titleBar: {
        id: "titleBar",
        classId: "title-bar",
        label: "Title Bar",
        collapsedKey: "titleBarCollapsed",
    },
    headerBar: {
        id: "headerBar",
        classId: "header-bar",
        label: "Header Bar",
        collapsedKey: "headerBarCollapsed",
    },
    userArea: {
        id: "userArea",
        classId: "user-area",
        label: "User Area",
        collapsedKey: "userAreaCollapsed",
    },
};
export const toolbarPanelOrder = ["guildBar", "channelList", "membersList", "chatButtons", "titleBar", "headerBar", "userArea"];
export const collapseSettingKeys = toolbarPanelOrder.map(panelId => panelRegistry[panelId].collapsedKey);
let collapseSettingChangeHandler;
let userAreaDetachSettingChangeHandler;
export function setCollapseSettingChangeHandler(handler) {
    collapseSettingChangeHandler = handler;
}
export function setUserAreaDetachSettingChangeHandler(handler) {
    userAreaDetachSettingChangeHandler = handler;
}
function onCollapseSettingChanged(panelId) {
    return (collapsed) => collapseSettingChangeHandler?.(panelId, collapsed);
}
export const settings = definePluginSettings({
    detachUserArea: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Detach the user area so it can be moved freely when it is not collapsed.",
        default: false,
        onChange: () => userAreaDetachSettingChangeHandler?.(),
    },
    detachedUserAreaX: {
        type: 1 /* OptionType.NUMBER */,
        description: "Persist the detached user area x position.",
        default: -1,
        hidden: true,
        onChange: () => userAreaDetachSettingChangeHandler?.(),
    },
    detachedUserAreaY: {
        type: 1 /* OptionType.NUMBER */,
        description: "Persist the detached user area y position.",
        default: -1,
        hidden: true,
        onChange: () => userAreaDetachSettingChangeHandler?.(),
    },
    guildBarCollapsed: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Persist the guild bar as collapsed.",
        default: false,
        hidden: true,
        onChange: onCollapseSettingChanged("guildBar"),
    },
    channelListCollapsed: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Persist the channel list as collapsed.",
        default: false,
        hidden: true,
        onChange: onCollapseSettingChanged("channelList"),
    },
    membersListCollapsed: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Persist the members list as collapsed.",
        default: false,
        hidden: true,
        onChange: onCollapseSettingChanged("membersList"),
    },
    chatButtonsCollapsed: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Persist the message button row as collapsed.",
        default: false,
        hidden: true,
        onChange: onCollapseSettingChanged("chatButtons"),
    },
    titleBarCollapsed: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Persist the title bar as collapsed.",
        default: false,
        hidden: true,
        onChange: onCollapseSettingChanged("titleBar"),
    },
    headerBarCollapsed: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Persist the header bar as collapsed.",
        default: false,
        hidden: true,
        onChange: onCollapseSettingChanged("headerBar"),
    },
    userAreaCollapsed: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Persist the user area as collapsed.",
        default: false,
        hidden: true,
        onChange: onCollapseSettingChanged("userArea"),
    },
});
