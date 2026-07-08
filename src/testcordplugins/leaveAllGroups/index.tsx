/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, Menu, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

// Use PrivateChannelSortStore like in other plugins
const PrivateChannelSortStore = findStoreLazy("PrivateChannelSortStore") as { getPrivateChannelIds: () => string[]; };

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable the LeaveAllGroups plugin",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications during actions",
        default: true
    },
    confirmBeforeLeave: {
        type: OptionType.BOOLEAN,
        description: "Ask for confirmation before leaving all groups",
        default: false
    },
    delayBetweenLeaves: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds between each group leave (to avoid rate limiting)",
        default: 200,
        min: 50,
        max: 2000
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode (detailed logs)",
        default: false
    }
});

// Log function with prefix
function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[LeaveAllGroups ${timestamp}]`;

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

// Debug log
function debugLog(message: string) {
    if (settings.store.debugMode) {
        log(`🔍 ${message}`, "info");
    }
}

// Function to confirm the action
function confirmLeaveAll(groupCount: number): boolean {
    if (!settings.store.confirmBeforeLeave) return true;

    return confirm(
        `⚠️ Are you sure you want to leave all ${groupCount} groups?\n\n` +
        "This action cannot be undone.\n" +
        "You will be removed from all Discord groups instantly."
    );
}

// Function to leave a specific group
async function leaveGroup(channelId: string): Promise<boolean> {
    try {
        debugLog(`Attempting to leave group ${channelId}`);

        // Use the Discord API to leave the group
        await RestAPI.del({
            url: `/channels/${channelId}`
        });

        debugLog(`✅ Group ${channelId} left successfully`);
        return true;
    } catch (error) {
        log(`❌ Error leaving group ${channelId}: ${error}`, "error");
        return false;
    }
}

// Function to get all groups
function getAllGroups(): Channel[] {
    const privateChannelIds = PrivateChannelSortStore.getPrivateChannelIds();
    const groups: Channel[] = [];

    privateChannelIds.forEach((channelId: string) => {
        const channel = ChannelStore.getChannel(channelId);

        // Check that it's a group DM (type 3) and not a private DM (type 1)
        if (channel && channel.type === 3) {
            groups.push(channel);
        }
    });

    return groups;
}

// Main function to leave all groups
async function leaveAllGroups() {
    if (!settings.store.enabled) {
        log("Plugin disabled", "warn");
        return;
    }

    try {
        const currentUserId = UserStore.getCurrentUser()?.id;

        if (!currentUserId) {
            log("Unable to get current user ID", "error");
            return;
        }

        const groups = getAllGroups();

        debugLog(`📊 Information:
- Number of groups found: ${groups.length}
- Current user: ${currentUserId}`);

        if (groups.length === 0) {
            log("No groups to leave", "warn");

            if (settings.store.showNotifications) {
                showNotification({
                    title: "ℹ️ LeaveAllGroups",
                    body: "No groups to leave",
                    icon: undefined
                });
            }

            showToast("ℹ️ No groups to leave", Toasts.Type.MESSAGE);
            return;
        }

        // Ask for confirmation
        if (!confirmLeaveAll(groups.length)) {
            log("Action cancelled by user");
            return;
        }

        log(`🚀 Starting to leave ${groups.length} group(s)`);

        let successCount = 0;
        let failureCount = 0;

        // Start notification
        if (settings.store.showNotifications) {
            showNotification({
                title: "🔄 LeaveAllGroups in progress",
                body: `Leaving ${groups.length} group(s)...`,
                icon: undefined
            });
        }

        showToast(`🔄 Leaving ${groups.length} group(s)...`, Toasts.Type.MESSAGE);

        // Leave each group
        for (const group of groups) {
            const groupName = group.name || `Group ${group.id}`;
            debugLog(`Processing group: ${groupName} (${group.id})`);

            const success = await leaveGroup(group.id);
            if (success) {
                successCount++;
                debugLog(`✅ Left: ${groupName}`);
            } else {
                failureCount++;
                debugLog(`❌ Failed: ${groupName}`);
            }

            // Delay to avoid rate limiting
            if (settings.store.delayBetweenLeaves > 0) {
                await sleep(settings.store.delayBetweenLeaves);
            }
        }

        const totalProcessed = successCount + failureCount;

        log(`✅ Operation completed:
- Groups processed: ${totalProcessed}
- Successes: ${successCount}
- Failures: ${failureCount}`);

        // Final notification
        if (settings.store.showNotifications) {
            const title = failureCount > 0 ? "⚠️ LeaveAllGroups completed with errors" : "✅ LeaveAllGroups completed";
            const body = failureCount > 0
                ? `${successCount} groups left, ${failureCount} failures`
                : `${successCount} groups left successfully`;

            showNotification({
                title,
                body,
                icon: undefined
            });
        }

        // Final toast
        if (failureCount > 0) {
            showToast(`⚠️ ${successCount} groups left, ${failureCount} failures`, Toasts.Type.FAILURE);
        } else {
            showToast(`✅ ${successCount} groups left successfully`, Toasts.Type.SUCCESS);
        }

    } catch (error) {
        log(`❌ General error: ${error}`, "error");

        if (settings.store.showNotifications) {
            showNotification({
                title: "❌ LeaveAllGroups - Error",
                body: "An error occurred while leaving groups",
                icon: undefined
            });
        }

        showToast("❌ Error while leaving groups", Toasts.Type.FAILURE);
    }
}

// Context menu for groups
const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!settings.store.enabled) return;

    // Check that it's a group DM
    if (channel?.type !== 3) return;

    const container = findGroupChildrenByChildId("leave-channel", children);

    if (container) {
        container.push(
            <Menu.MenuItem
                id="vc-leave-all-groups"
                label="🚪 Leave all groups"
                action={leaveAllGroups}
                color="danger"
            />
        );
    }
};

// Context menu for servers (global access)
const ServerContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!settings.store.enabled) return;

    const group = findGroupChildrenByChildId("privacy", children);

    if (group) {
        group.push(
            <Menu.MenuItem
                id="vc-leave-all-groups-server"
                label="🚪 Leave all groups"
                action={leaveAllGroups}
                color="danger"
            />
        );
    }
};

// Context menu for users (access from profile)
const UserContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!settings.store.enabled) return;

    const container = findGroupChildrenByChildId("block", children) || findGroupChildrenByChildId("remove-friend", children);

    if (container) {
        container.push(
            <Menu.MenuItem
                id="vc-leave-all-groups-user"
                label="🚪 Leave all groups"
                action={leaveAllGroups}
                color="danger"
            />
        );
    }
};

export default definePlugin({
    name: "LeaveAllGroups",
    description: "Allows leaving all Discord groups with one click with configurable rate limiting",
    tags: ["Utility", "Chat"],
    authors: [TestcordDevs.x2b],
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch,
        "guild-context": ServerContextMenuPatch,
        "user-context": UserContextMenuPatch
    },

    start() {
        log("Plugin LeaveAllGroups started");
    },

    stop() {
        log("Plugin LeaveAllGroups stopped");
    }
});
