/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findGroupChildrenByChildId, } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Menu } from "@webpack/common";
const settings = definePluginSettings({
    enabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable Server Pinner plugin",
        default: true,
    },
    showNotifications: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show notifications for actions",
        default: true,
    },
    pinnedServers: {
        type: 0 /* OptionType.STRING */,
        description: "List of pinned servers (JSON format)",
        default: "[]",
    },
});
// Log function with prefix
function log(message, level = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[ServerPinner ${timestamp}]`;
    switch (level) {
        case "warn":
            console.warn(prefix, message);
            break;
        case "error":
            console.error(prefix, message);
            break;
        default:
            console.log(prefix, message);
    }
}
// Function to get the list of pinned servers
function getPinnedServers() {
    try {
        const pinned = JSON.parse(settings.store.pinnedServers);
        return Array.isArray(pinned) ? pinned : [];
    }
    catch (error) {
        log(`Error parsing pinned servers: ${error}`, "error");
        return [];
    }
}
// Function to save the list of pinned servers
function savePinnedServers(pinnedServers) {
    try {
        settings.store.pinnedServers = JSON.stringify(pinnedServers);
        log(`Pinned servers saved: ${pinnedServers.length} server(s)`);
    }
    catch (error) {
        log(`Error saving pinned servers: ${error}`, "error");
    }
}
// Function to check if a server is pinned
function isServerPinned(guildId) {
    const pinnedServers = getPinnedServers();
    return pinnedServers.includes(guildId);
}
// Function to pin a server
function pinServer(guildId) {
    const pinnedServers = getPinnedServers();
    if (!pinnedServers.includes(guildId)) {
        pinnedServers.unshift(guildId); // Add to beginning for order
        savePinnedServers(pinnedServers);
        log(`Server ${guildId} pinned`);
        if (settings.store.showNotifications) {
            showNotification({
                title: "📌 Server pinned",
                body: "Server has been added to pinned servers",
                icon: undefined,
            });
        }
    }
}
// Function to unpin a server
function unpinServer(guildId) {
    const pinnedServers = getPinnedServers();
    const index = pinnedServers.indexOf(guildId);
    if (index !== -1) {
        pinnedServers.splice(index, 1);
        savePinnedServers(pinnedServers);
        log(`Server ${guildId} unpinned`);
        if (settings.store.showNotifications) {
            showNotification({
                title: "📌 Server unpinned",
                body: "Server has been removed from pinned servers",
                icon: undefined,
            });
        }
    }
}
// Server context menu patch
const ServerContextMenuPatch = (children, { guild }) => {
    if (!settings.store.enabled || !guild)
        return;
    const isPinned = isServerPinned(guild.id);
    const group = findGroupChildrenByChildId("privacy", children);
    if (group) {
        group.push(<Menu.MenuSeparator />, <Menu.MenuItem id="vc-toggle-server-pin" label={isPinned ? "📌 Unpin this server" : "📌 Pin this server"} action={() => {
                if (isPinned) {
                    unpinServer(guild.id);
                }
                else {
                    pinServer(guild.id);
                }
            }}/>);
    }
};
export default definePlugin({
    name: "Server Pinner",
    description: "Allows pinning servers via context menu. Dedicated category will be added in a future update.",
    tags: ["Servers", "Utility"],
    authors: [
        {
            name: "Bash",
            id: 1327483363518582784n,
        },
        TestcordDevs.x2b,
    ],
    dependencies: ["ContextMenuAPI"],
    settings,
    contextMenus: {
        "guild-context": ServerContextMenuPatch,
    },
    start() {
        log("🚀 Server Pinner plugin started");
        const pinnedCount = getPinnedServers().length;
        if (pinnedCount > 0) {
            log(`${pinnedCount} pinned server(s) loaded`);
        }
        if (settings.store.showNotifications) {
            showNotification({
                title: "📌 Server Pinner enabled",
                body: "Right-click on a server to pin it",
                icon: undefined,
            });
        }
    },
    stop() {
        log("🛑 Server Pinner plugin stopped");
    },
});
