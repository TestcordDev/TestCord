/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Menu, React } from "@webpack/common";
import { openCopyModal } from "./CopyModal";
import { openXRayModal } from "./XRayModal";
export const logger = new Logger("ServerToolkit");
export const settings = definePluginSettings({
    defaultIncludeRoles: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Copy roles by default",
        default: true,
    },
    defaultIncludeChannels: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Copy channels by default",
        default: true,
    },
    defaultIncludeEmojis: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Copy emojis by default",
        default: true,
    },
    defaultIncludeStickers: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Copy stickers by default",
        default: false,
    },
    defaultIncludeWebhooks: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Copy webhooks by default",
        default: false,
    },
    defaultIncludeServerSettings: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Copy server settings (icon, banner, AFK, verification, etc.) by default",
        default: true,
    },
    defaultIncludeOwnNickname: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Copy your own nickname to the target",
        default: true,
    },
    defaultIncludeBots: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Copy bots to #bots-list by default",
        default: true,
    },
    nicknameBudgetThreshold: {
        type: 1 /* OptionType.NUMBER */,
        description: "Skip bulk nickname copy if cached members exceed this number (rate-limit guard)",
        default: 75,
    },
    emojiCount: {
        type: 1 /* OptionType.NUMBER */,
        description: "Maximum emojis per type (static/animated) to copy",
        default: 250,
    },
    stickerCount: {
        type: 1 /* OptionType.NUMBER */,
        description: "Maximum stickers to copy",
        default: 5,
    },
});
const guildContextPatch = (children, props) => {
    const guild = props?.guild;
    if (!guild)
        return;
    const group = findGroupChildrenByChildId("privacy", children) ??
        findGroupChildrenByChildId("hide-muted-channels", children) ??
        children;
    group.push(<Menu.MenuItem id="server-toolkit-xray" label="Server X-Ray" action={() => openXRayModal(guild)}/>, <Menu.MenuItem id="server-toolkit-duplicate" label="Duplicate Server" action={() => openCopyModal(guild)}/>);
};
export default definePlugin({
    name: "ServerToolkit",
    description: "All-in-one server utility. Right-click any guild for an X-Ray inspector and a powerful Duplicate/Clone modal (roles, channels, emojis, stickers, webhooks, server settings, optional overwrite of an existing target).",
    authors: [TestcordDevs.sirphantom89],
    tags: ["Servers", "Utility"],
    settings,
    contextMenus: {
        "guild-context": guildContextPatch,
        "guild-header-popout": guildContextPatch,
    },
});
