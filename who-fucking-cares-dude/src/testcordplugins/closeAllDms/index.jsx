/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findGroupChildrenByChildId, } from "@api/ContextMenu";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, Menu, showToast, Toasts, } from "@webpack/common";
// Find ChannelActionCreators to close DMs
const ChannelActionCreators = findByPropsLazy("openPrivateChannel", "closePrivateChannel");
// Use PrivateChannelSortStore as in pinDms
const PrivateChannelSortStore = findStoreLazy("PrivateChannelSortStore");
// Function to close a DM with rate limit
async function closeDMWithDelay(channelId, delay) {
    return new Promise(resolve => {
        setTimeout(() => {
            try {
                const channel = ChannelStore.getChannel(channelId);
                // Check that it's a private DM (type 1) and not a group (type 3)
                if (channel && channel.type === 1) {
                    // Use ChannelActionCreators.closePrivateChannel if available
                    if (ChannelActionCreators?.closePrivateChannel) {
                        ChannelActionCreators.closePrivateChannel(channelId);
                    }
                    else {
                        // Fallback: use FluxDispatcher
                        FluxDispatcher.dispatch({
                            type: "CHANNEL_DELETE",
                            channel: {
                                id: channelId,
                                type: 1,
                            },
                        });
                    }
                }
            }
            catch (err) {
                console.error(`Error closing DM ${channelId}:`, err);
            }
            resolve();
        }, delay);
    });
}
async function closeAllDMs() {
    try {
        // Get all private channels via PrivateChannelSortStore
        const privateChannelIds = PrivateChannelSortStore.getPrivateChannelIds();
        let closedCount = 0;
        const dmsToClose = [];
        // Filter DMs to close (only private DMs, not groups)
        privateChannelIds.forEach((channelId) => {
            const channel = ChannelStore.getChannel(channelId);
            // Check that it's a private DM (type 1) and not a group (type 3)
            if (channel && channel.type === 1) {
                dmsToClose.push(channelId);
            }
        });
        if (dmsToClose.length === 0) {
            showToast("ℹ️ No DMs to close", Toasts.Type.MESSAGE);
            return;
        }
        // Close DMs with a 50ms rate limit
        for (let i = 0; i < dmsToClose.length; i++) {
            await closeDMWithDelay(dmsToClose[i], i * 50); // 50ms delay between each closure
            closedCount++;
        }
        // Success notification
        showToast(`✅ ${closedCount} DM(s) closed with 50ms rate limit`, Toasts.Type.SUCCESS);
    }
    catch (error) {
        console.error("Error closing DMs:", error);
        showToast("❌ Error closing DMs", Toasts.Type.FAILURE);
    }
}
// Context menu for group DMs
const GroupDMContextMenuPatch = (children, props) => {
    const container = findGroupChildrenByChildId("leave-channel", children);
    if (container) {
        container.push(<Menu.MenuItem id="vc-close-all-dms" label="Close all DMs" action={closeAllDMs}/>);
    }
};
// Context menu for users
const UserContextMenuPatch = (children, props) => {
    const container = findGroupChildrenByChildId("close-dm", children);
    if (container) {
        container.push(<Menu.MenuItem id="vc-close-all-dms-user" label="Close all DMs" action={closeAllDMs}/>);
    }
};
// Context menu for servers
const ServerContextMenuPatch = (children, props) => {
    const group = findGroupChildrenByChildId("privacy", children);
    if (group) {
        group.push(<Menu.MenuItem id="vc-close-all-dms-server" label="Close all DMs" action={closeAllDMs}/>);
    }
};
export default definePlugin({
    name: "CloseAllDms",
    description: "Closes all private DMs with one click with 50ms rate limit (preserves groups)",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    contextMenus: {
        "gdm-context": GroupDMContextMenuPatch,
        "user-context": UserContextMenuPatch,
        "guild-context": ServerContextMenuPatch,
    },
});
