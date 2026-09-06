/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { openUserProfile } from "@utils/discord";
import { sleep } from "@utils/misc";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, Constants, FluxDispatcher, React, RestAPI, Text, TextInput, useEffect, UserStore, useState } from "@webpack/common";

const SYNC_CONFIG = {
    JSONBIN_API_KEY: "$2a$10$CiRPWHghiI/2K14rvki.t.Vg5nbOBW3AqzN4/Q2wfL8Ltc55LDhwu",
    BIN_ID: "68c0998043b1c97be93cf92e",
    UPLOAD_COOLDOWN: 300000,
    USERS: {
        dot: "1400610916285812776",
        dot2: "395599933149020161",
        wowza: "381592911369994270"
    }
};

let lastUploadTime = 0;
let lastKnownState = "";
let lastKnownVersion = "";
let autoSyncInterval: NodeJS.Timeout | null = null;
let autoSyncEnabled = false;

export function openGuildInfoModal() {
    (openModal as any)((modalProps: any) => <UserList modalProps={modalProps} />);
}

const SearchIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z" />
    </svg>
);

const EditIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
        <path d="M3 17.25V21H6.75L17.81 9.94L14.06 6.19L3 17.25ZM20.71 7.04C21.1 6.65 21.1 6.02 20.71 5.63L18.37 3.29C17.98 2.9 17.35 2.9 16.96 3.29L15.13 5.12L18.88 8.87L20.71 7.04Z" />
    </svg>
);

const DownloadIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
    </svg>
);

const UploadIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
    </svg>
);

const TrashIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
);

const SyncIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
    </svg>
);

async function uploadToSync(data: any): Promise<boolean> {
    try {
        const response = await fetch(`https://api.jsonbin.io/v3/b/${SYNC_CONFIG.BIN_ID}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "X-Master-Key": SYNC_CONFIG.JSONBIN_API_KEY,
                "X-Bin-Name": `AutoBan Sync - ${new Date().toISOString()}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.record) {
            console.log("Successfully uploaded to sync:", result);
            lastUploadTime = Date.now();
            return true;
        } else {
            console.error("Upload failed:", result);
            return false;
        }
    } catch (error) {
        console.error("Error uploading to sync:", error);
        return false;
    }
}

async function downloadFromSync(): Promise<any | null> {
    try {
        const response = await fetch(`https://api.jsonbin.io/v3/b/${SYNC_CONFIG.BIN_ID}/latest`, {
            headers: {
                "X-Master-Key": SYNC_CONFIG.JSONBIN_API_KEY
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result.record;
    } catch (error) {
        console.error("Error downloading from sync:", error);
        return null;
    }
}

// Check if user is a friend
function isFriend(userId) {
    try {
        const RelationshipStore = findByPropsLazy("getRelationshipType");
        if (!RelationshipStore) return false;

        // Relationship type 1 = friend
        return RelationshipStore.getRelationshipType(userId) === 1;
    } catch (error) {
        console.warn("Failed to check friend status:", error);
        return false;
    }
}

// Remove friends from ban list
function removeFriendsFromBanList(pluginName, usersKey, reasonsKey) {
    const plugin = Vencord.Plugins.plugins[pluginName] as any;
    if (!plugin?.settings?.store) return { removed: 0, usernames: [] };

    const userString = plugin.settings.store[usersKey] || "";
    const userList = userString.split("/").filter(Boolean);

    const friendsToRemove: string[] = [];
    const friendUsernames: string[] = [];

    userList.forEach(id => {
        if (isFriend(id)) {
            friendsToRemove.push(id);
            const user = UserStore.getUser(id);
            friendUsernames.push(user?.username || `ID: ${id}`);
        }
    });

    if (friendsToRemove.length > 0) {
        // Remove friends from user list
        const newUsers = userList.filter(id => !friendsToRemove.includes(id));
        plugin.settings.store[usersKey] = newUsers.join("/");

        // Remove friend reasons if they exist
        if (reasonsKey && plugin.settings.store[reasonsKey]) {
            const currentReasons = plugin.settings.store[reasonsKey].split(".").filter(Boolean);
            const updatedReasons = currentReasons.filter(entry => {
                const [id] = entry.split("/");
                return !friendsToRemove.includes(id);
            });
            plugin.settings.store[reasonsKey] = updatedReasons.join(".");
        }
    }

    return { removed: friendsToRemove.length, usernames: friendUsernames };
}

function getCurrentBanListState(): string {
    const singleBans = Vencord.Plugins.plugins.autoBan?.settings?.store?.users || "";
    const multiBans = Vencord.Plugins.plugins.MultiServerAutoban?.settings?.store?.users || "";
    const singleReasons = Vencord.Plugins.plugins.autoBan?.settings?.store?.store || "";
    const multiReasons = Vencord.Plugins.plugins.MultiServerAutoban?.settings?.store?.reasons || "";

    return JSON.stringify({
        single: { users: singleBans, reasons: singleReasons },
        multi: { users: multiBans, reasons: multiReasons }
    });
}

function hasStateChanged(): boolean {
    const currentState = getCurrentBanListState();
    const changed = currentState !== lastKnownState;
    if (changed) {
        lastKnownState = currentState;
    }
    return changed;
}

function startAutoSync(): void {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
    }

    autoSyncEnabled = true;
    autoSyncInterval = setInterval(async () => {
        try {
            console.log("[AutoSync] Running scheduled sync download...");
            const result = await syncDownload();
            console.log(`[AutoSync] ${result.success ? "Success" : "Failed"}: ${result.message}`);
        } catch (error) {
            console.error("[AutoSync] Error during scheduled sync:", error);
        }
    }, 300000); // 5 minutes = 300000ms

    console.log("[AutoSync] Auto-sync enabled - will sync every 5 minutes");
}

function stopAutoSync(): void {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
    }
    autoSyncEnabled = false;
    console.log("[AutoSync] Auto-sync disabled");
}

async function syncUpload(): Promise<{ success: boolean; message: string; }> {
    const now = Date.now();
    const timeLeft = SYNC_CONFIG.UPLOAD_COOLDOWN - (now - lastUploadTime);

    // Check cooldown
    if (timeLeft > 0) {
        const minutes = Math.ceil(timeLeft / 60000);
        return {
            success: false,
            message: `Upload on cooldown. Try again in ${minutes} minute${minutes !== 1 ? "s" : ""}.`
        };
    }

    // Check if state changed
    if (!hasStateChanged()) {
        return {
            success: false,
            message: "No changes detected in ban lists since last upload."
        };
    }

    // Get single server ban data using exact export logic
    const singlePlugin = Vencord.Plugins.plugins.autoBan;
    let singleData: any = null;
    if (singlePlugin?.settings?.store) {
        const userString = singlePlugin.settings.store.users || "";
        const userList = userString.split("/").filter(Boolean);

        const reasonMap: Record<string, string> = {};
        if (singlePlugin.settings.store.store) {
            const reasonString = singlePlugin.settings.store.store;
            const reasonEntries = reasonString.split(".").filter(Boolean);
            reasonEntries.forEach(entry => {
                const [id, reason] = entry.split("/");
                if (id && reason) reasonMap[id] = reason;
            });
        }

        singleData = {
            version: "1.0",
            plugin: "autoBan",
            exportDate: new Date().toISOString(),
            users: userList.map(id => ({
                id,
                reason: reasonMap[id] || ""
            }))
        };
    }

    const success = await uploadToSync(singleData);

    if (success) {
        return {
            success: true,
            message: "Successfully uploaded ban lists to sync!"
        };
    } else {
        return {
            success: false,
            message: "Failed to upload to sync. Check console for details."
        };
    }
}

async function syncDownload(): Promise<{ success: boolean; message: string; }> {
    const syncResult = await downloadFromSync();

    if (!syncResult) {
        return {
            success: false,
            message: "Failed to download sync data."
        };
    }

    if (!syncResult.users || !Array.isArray(syncResult.users)) {
        return {
            success: false,
            message: "Invalid sync data format."
        };
    }

    try {
        const plugin = Vencord.Plugins.plugins.autoBan;
        if (!plugin?.settings?.store) {
            return {
                success: false,
                message: "AutoBan plugin not found or not configured."
            };
        }

        // Get existing data
        const existingUserString = plugin.settings.store.users || "";
        const existingUsers = existingUserString.split("/").filter(Boolean);

        const existingReasons: Record<string, string> = {};
        if (plugin.settings.store.store) {
            const reasonString = plugin.settings.store.store;
            const reasonEntries = reasonString.split(".").filter(Boolean);
            reasonEntries.forEach(entry => {
                const [id, reason] = entry.split("/");
                if (id && reason) existingReasons[id] = reason;
            });
        }

        // Merge data
        const mergedUsers = [...existingUsers];
        const mergedReasons = { ...existingReasons };

        syncResult.users.forEach((userData: any) => {
            if (userData.id && !mergedUsers.includes(userData.id)) {
                mergedUsers.push(userData.id);
            }
            if (userData.id && userData.reason) {
                mergedReasons[userData.id] = userData.reason;
            }
        });

        // Save merged data
        plugin.settings.store.users = mergedUsers.join("/");

        const reasonEntries = Object.entries(mergedReasons)
            .filter(([id, reason]) => reason.trim())
            .map(([id, reason]) => `${id}/${reason}`);
        plugin.settings.store.store = reasonEntries.join(".");

        // Update last known state
        lastKnownState = getCurrentBanListState();
        lastKnownVersion = syncResult.version;

        const importedCount = syncResult.users.length;
        const newCount = syncResult.users.filter((u: any) => !existingUsers.includes(u.id)).length;
        const uploadDate = new Date(syncResult.exportDate).toLocaleString();

        let message = "Successfully synced ban lists!\n\n";
        message += `Last updated: ${uploadDate}\n`;
        message += `Version: ${syncResult.version}\n\n`;
        message += "Results:\n";
        message += `Total users: ${importedCount}\n`;
        message += `New users added: ${newCount}\n`;
        message += `Duplicates merged: ${importedCount - newCount}`;

        return {
            success: true,
            message
        };

    } catch (error) {
        console.error("Error applying sync data:", error);
        return {
            success: false,
            message: "Failed to apply sync data. Check console for details."
        };
    }
}

// Simplified user fetching
async function fetchUser(id: string) {
    const user = UserStore.getUser(id);
    if (user) return user;

    try {
        const response = await RestAPI.get({ url: Constants.Endpoints.USER(id) });
        FluxDispatcher.dispatch({
            type: "USER_UPDATE",
            user: response.body,
        });
        await sleep(100); // Simple rate limiting
        return UserStore.getUser(id);
    } catch (error) {
        console.warn(`Failed to fetch user ${id}:`, error);
        return null;
    }
}

// Export ban list to JSON
function exportBanList(pluginName: string, usersKey: string, reasonsKey?: string) {
    const plugin = Vencord.Plugins.plugins[pluginName] as any;
    if (!plugin?.settings?.store) return;

    // Get users
    const userString = plugin.settings.store[usersKey] || "";
    const userList = userString.split("/").filter(Boolean);

    // Get reasons
    const reasonMap: Record<string, string> = {};
    if (reasonsKey && plugin.settings.store[reasonsKey]) {
        const reasonString = plugin.settings.store[reasonsKey];
        const reasonEntries = reasonString.split(".").filter(Boolean);

        reasonEntries.forEach(entry => {
            const [id, reason] = entry.split("/");
            if (id && reason) reasonMap[id] = reason;
        });
    }

    // Create export data
    const exportData = {
        version: "1.0",
        plugin: pluginName,
        exportDate: new Date().toISOString(),
        users: userList.map(id => ({
            id,
            reason: reasonMap[id] || ""
        }))
    };

    // Download as JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pluginName}-banlist-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Import ban list from JSON
function importBanList(
    pluginName: string,
    usersKey: string,
    reasonsKey: string | undefined,
    onUpdate: () => void
) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = e => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = e => {
            try {
                const importData = JSON.parse(e.target?.result as string);

                // Validate import data
                if (!importData.users || !Array.isArray(importData.users)) {
                    alert("Invalid ban list format!");
                    return;
                }

    const plugin = Vencord.Plugins.plugins[pluginName] as any;
                if (!plugin?.settings?.store) return;

                // Get existing data
                const existingUserString = plugin.settings.store[usersKey] || "";
                const existingUsers = existingUserString.split("/").filter(Boolean);

                const existingReasons: Record<string, string> = {};
                if (reasonsKey && plugin.settings.store[reasonsKey]) {
                    const reasonString = plugin.settings.store[reasonsKey];
                    const reasonEntries = reasonString.split(".").filter(Boolean);

                    reasonEntries.forEach(entry => {
                        const [id, reason] = entry.split("/");
                        if (id && reason) existingReasons[id] = reason;
                    });
                }

                // Merge data (override duplicates, add new ones)
                const mergedUsers = [...existingUsers];
                const mergedReasons = { ...existingReasons };

                importData.users.forEach((userData: any) => {
                    if (userData.id && !mergedUsers.includes(userData.id)) {
                        mergedUsers.push(userData.id);
                    }
                    if (userData.id && userData.reason) {
                        mergedReasons[userData.id] = userData.reason;
                    }
                });

                // Save merged data
                plugin.settings.store[usersKey] = mergedUsers.join("/");

                if (reasonsKey) {
                    const reasonEntries = Object.entries(mergedReasons)
                        .filter(([id, reason]) => reason.trim())
                        .map(([id, reason]) => `${id}/${reason}`);
                    plugin.settings.store[reasonsKey] = reasonEntries.join(".");
                }

                const importedCount = importData.users.length;
                const newCount = importData.users.filter((u: any) => !existingUsers.includes(u.id)).length;

                alert(`Import successful!\n\nImported: ${importedCount} users\nNew users added: ${newCount}\nDuplicates merged: ${importedCount - newCount}`);
                onUpdate();

            } catch (error) {
                console.error("Import error:", error);
                alert("Failed to import ban list. Please check the file format.");
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// Clear entire ban list
function clearBanList(
    pluginName: string,
    usersKey: string,
    reasonsKey: string | undefined,
    onUpdate: () => void
) {
    const confirmed = confirm("Are you sure you want to clear the entire ban list? This action cannot be undone!");
    if (!confirmed) return;

    const plugin = Vencord.Plugins.plugins[pluginName] as any;
    if (!plugin?.settings?.store) return;

    plugin.settings.store[usersKey] = "";
    if (reasonsKey) {
        plugin.settings.store[reasonsKey] = "";
    }

    alert("Ban list cleared successfully!");
    onUpdate();
}

// Single ban list component
function BanList({
    pluginName,
    usersKey,
    reasonsKey,
    title,
    onUpdate
}: {
    pluginName: string;
    usersKey: string;
    reasonsKey?: string;
    title: string;
    onUpdate?: () => void;
}) {
    const [users, setUsers] = useState<string[]>([]);
    const [userMap, setUserMap] = useState<Record<string, any>>({});
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const [editingReasons, setEditingReasons] = useState<Record<string, boolean>>({});
    const [searchTerm, setSearchTerm] = useState("");
    const [updateTrigger, setUpdateTrigger] = useState(0);

    const plugin = Vencord.Plugins.plugins[pluginName] as any;

    const triggerUpdate = () => {
        setUpdateTrigger(prev => prev + 1);
        onUpdate?.();
    };

    // Load data from plugin settings
    useEffect(() => {
        if (!plugin?.settings?.store) return;

        // Load users
        const userString = plugin.settings.store[usersKey] || "";
        const userList = userString.split("/").filter(Boolean);
        setUsers(userList);

        // const result = removeFriendsFromBanList(pluginName, usersKey, reasonsKey);
        // if (result.removed > 0) {
        //     console.log(`Auto-removed ${result.removed} friends from ${title}:`, result.usernames);
        // }

        // Load reasons if available
        if (reasonsKey && plugin.settings.store[reasonsKey]) {
            const reasonString = plugin.settings.store[reasonsKey];
            const reasonEntries = reasonString.split(".").filter(Boolean);
            const reasonMap: Record<string, string> = {};

            reasonEntries.forEach(entry => {
                const [id, reason] = entry.split("/");
                if (id && reason) reasonMap[id] = reason;
            });

            setReasons(reasonMap);
        }
    }, [plugin, usersKey, reasonsKey, updateTrigger]);

    // Fetch user data
    useEffect(() => {
        users.forEach(async id => {
            if (!userMap[id]) {
                const user = await fetchUser(id);
                if (user) {
                    setUserMap(prev => ({ ...prev, [id]: user }));
                }
            }
        });
    }, [users]);

    // Filter users based on search
    const filteredUsers = users.filter(id => {
        if (!searchTerm.trim()) return true;

        const user = userMap[id];
        const searchLower = searchTerm.toLowerCase();

        return (
            user?.username?.toLowerCase().includes(searchLower) ||
            user?.globalName?.toLowerCase().includes(searchLower) ||
            id.includes(searchTerm) ||
            reasons[id]?.toLowerCase().includes(searchLower)
        );
    });

    const removeUser = (id: string) => {
        const newUsers = users.filter(uid => uid !== id);
        const updatedStore = newUsers.length ? newUsers.join("/") : "";

        plugin.settings.store[usersKey] = updatedStore;
        setUsers(newUsers);

        // Remove reason if it exists
        if (reasonsKey && plugin.settings.store[reasonsKey]) {
            const currentReasons = plugin.settings.store[reasonsKey].split(".").filter(Boolean);
            const updatedReasons = currentReasons.filter(entry => !entry.startsWith(`${id}/`));
            plugin.settings.store[reasonsKey] = updatedReasons.join(".");
        }

        triggerUpdate();
    };

    const saveReason = (id: string, newReason: string) => {
        if (!reasonsKey) return;

        setReasons(prev => ({ ...prev, [id]: newReason }));
        setEditingReasons(prev => ({ ...prev, [id]: false }));

        // Update plugin store
        const currentReasons = (plugin.settings.store[reasonsKey] || "").split(".").filter(Boolean);
        const updatedReasons = currentReasons.filter(entry => !entry.startsWith(`${id}/`));

        if (newReason.trim()) {
            updatedReasons.push(`${id}/${newReason}`);
        }

        plugin.settings.store[reasonsKey] = updatedReasons.join(".");
        triggerUpdate();
    };

    return (
        <div style={{
            padding: "20px",
            backgroundColor: "var(--background-primary)",
            borderRadius: "8px",
            border: "1px solid var(--background-modifier-accent)"
        }}>
            {/* Header with count and controls */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "20px",
                paddingBottom: "12px",
                borderBottom: "2px solid var(--brand-experiment)"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <Text
                        variant="heading-lg/semibold"
                        style={{
                            color: "white",
                            fontSize: "24px",
                            fontWeight: "700"
                        }}
                    >
                        {title}
                    </Text>
                    <div style={{
                        backgroundColor: "var(--brand-experiment)",
                        color: "white",
                        padding: "6px 12px",
                        borderRadius: "20px",
                        fontSize: "14px",
                        fontWeight: "600"
                    }}>
                        {users.length} users
                    </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", gap: "8px" }}>
                    <Button
                        size="small"
                        color="blue"
                        onClick={() => {
                            const result = removeFriendsFromBanList(pluginName, usersKey, reasonsKey);
                            if (result.removed > 0) {
                                alert(`Removed ${result.removed} friends from ban list:\n\n${result.usernames.join("\n")}`);
                                triggerUpdate();
                            } else {
                                alert("No friends found in ban list!");
                            }
                        }}
                        style={{
                            backgroundColor: "#1a7bfaff",
                            color: "white",
                            fontWeight: "600",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}
                    >
                        👥 Remove Friends
                    </Button>

                    <Button
                        size="small"
                        color="green"
                        onClick={() => exportBanList(pluginName, usersKey, reasonsKey)}
                        style={{
                            backgroundColor: "#43b581",
                            color: "white",
                            fontWeight: "600",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}
                    >
                        <DownloadIcon />
                        Export
                    </Button>

                    <Button
                        size="small"
                        color="blurple"
                        onClick={() => importBanList(pluginName, usersKey, reasonsKey, triggerUpdate)}
                        style={{
                            backgroundColor: "var(--brand-experiment)",
                            color: "white",
                            fontWeight: "600",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}
                    >
                        <UploadIcon />
                        Import
                    </Button>

                    <Button
                        size="small"
                        color="red"
                        onClick={() => clearBanList(pluginName, usersKey, reasonsKey, triggerUpdate)}
                        style={{
                            backgroundColor: "#f04747",
                            color: "white",
                            fontWeight: "600",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}
                        disabled={users.length === 0}
                    >
                        <TrashIcon />
                        Clear All
                    </Button>
                </div>
            </div>

            {/* Search */}
            <div style={{ marginBottom: "24px", position: "relative" }}>
                <TextInput
                    value={searchTerm}
                    onChange={setSearchTerm}
                    placeholder="🔍 Search by username, display name, or reason..."
                    style={{
                        width: "100%",
                        paddingRight: "40px",
                        backgroundColor: "var(--input-background)",
                        border: "2px solid var(--background-modifier-accent)",
                        borderRadius: "8px",
                        fontSize: "16px",
                        color: "white"
                    }}
                />
                <div style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)"
                }}>
                    <SearchIcon />
                </div>
            </div>

            {/* User list container */}
            <div style={{
                maxHeight: "500px",
                overflowY: "auto",
                backgroundColor: "var(--background-secondary)",
                borderRadius: "8px",
                padding: "12px"
            }}>
                {filteredUsers.length === 0 ? (
                    <div style={{
                        textAlign: "center",
                        padding: "40px 20px",
                        color: "var(--text-muted)",
                        fontSize: "16px",
                        fontStyle: "italic"
                    }}>
                        {users.length === 0 ?
                            "No users in the ban list yet" :
                            `No users matching "${searchTerm}"`
                        }
                    </div>
                ) : (
                    filteredUsers.map((id, index) => {
                        const user = userMap[id];
                        const isEditing = editingReasons[id];
                        const reason = reasons[id] || "";

                        return (
                            <div key={id} style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                padding: "12px 16px",
                                marginBottom: "8px",
                                backgroundColor: "var(--background-primary)",
                                borderRadius: "8px",
                                border: "1px solid var(--background-modifier-accent)",
                                transition: "all 0.2s ease",
                                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                            }}>
                                {/* Index number */}
                                <div style={{
                                    minWidth: "40px",
                                    height: "40px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: "var(--brand-experiment)",
                                    color: "white",
                                    borderRadius: "50%",
                                    fontSize: "14px",
                                    fontWeight: "700"
                                }}>
                                    {index + 1}
                                </div>

                                {/* Avatar */}
                                <img
                                    onClick={() => openUserProfile(id)}
                                    src={user?.getAvatarURL?.() ?? "https://cdn.discordapp.com/embed/avatars/0.png"}
                                    style={{
                                        width: "48px",
                                        height: "48px",
                                        borderRadius: "50%",
                                        cursor: "pointer",
                                        border: "3px solid var(--brand-experiment)",
                                        transition: "transform 0.2s ease"
                                    }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = "scale(1.1)"}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = "scale(1)"}
                                />

                                {/* User info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        color: "white",
                                        fontSize: "16px",
                                        fontWeight: "600",
                                        marginBottom: "2px"
                                    }}>
                                        {user?.username || "Unknown User"}
                                    </div>
                                    {user?.globalName && user.globalName !== user.username && (
                                        <div style={{
                                            fontSize: "14px",
                                            color: "var(--text-muted)",
                                            fontStyle: "italic"
                                        }}>
                                            {user.globalName}
                                        </div>
                                    )}
                                    <div style={{
                                        fontSize: "12px",
                                        color: "var(--text-muted)",
                                        fontFamily: "monospace"
                                    }}>
                                        ID: {id}
                                    </div>
                                </div>

                                {/* Reason input section */}
                                {reasonsKey && (
                                    <div style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        minWidth: "250px"
                                    }}>
                                        <TextInput
                                            value={isEditing ? reasons[id] || "" : reason}
                                            placeholder="Enter ban reason..."
                                            disabled={!isEditing}
                                            onChange={value => setReasons(prev => ({ ...prev, [id]: value }))}
                                            style={{
                                                flex: 1,
                                                backgroundColor: isEditing ? "var(--input-background)" : "var(--background-secondary)",
                                                border: `2px solid ${isEditing ? "var(--brand-experiment)" : "var(--background-modifier-accent)"}`,
                                                borderRadius: "6px",
                                                color: "white",
                                                fontSize: "14px"
                                            }}
                                        />

                                        {isEditing ? (
                                            <Button
                                                size="small"
                                                color="green"
                                                onClick={() => saveReason(id, reasons[id] || "")}
                                                style={{
                                                    backgroundColor: "#43b581",
                                                    color: "white",
                                                    fontWeight: "600"
                                                }}
                                            >
                                                ✓ Save
                                            </Button>
                                        ) : (
                                            <div
                                                onClick={() => setEditingReasons(prev => ({ ...prev, [id]: true }))}
                                                style={{
                                                    cursor: "pointer",
                                                    padding: "8px",
                                                    borderRadius: "6px",
                                                    backgroundColor: "var(--background-secondary)",
                                                    color: "var(--text-normal)",
                                                    transition: "all 0.2s ease"
                                                }}
                                                onMouseEnter={e => {
                                                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--brand-experiment)";
                                                    (e.currentTarget as HTMLElement).style.color = "white";
                                                }}
                                                onMouseLeave={e => {
                                                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--background-secondary)";
                                                    (e.currentTarget as HTMLElement).style.color = "var(--text-normal)";
                                                }}
                                            >
                                                <EditIcon />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Remove button */}
                                <Button
                                    onClick={() => removeUser(id)}
                                    size="small"
                                    color="red"
                                    style={{
                                        backgroundColor: "#f04747",
                                        color: "white",
                                        fontWeight: "600",
                                        minWidth: "80px"
                                    }}
                                >
                                    🗑️ Remove
                                </Button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

// Main modal component
function UserList({ modalProps }: { modalProps: any; }) {
    const [activeTab, setActiveTab] = useState<"single" | "multi">("single");
    const [refreshKey, setRefreshKey] = useState(0);

    const handleUpdate = () => {
        setRefreshKey(prev => prev + 1);
        // Update last known state when changes are made
        setTimeout(() => {
            lastKnownState = getCurrentBanListState();
        }, 100);
    };

    const tabStyle = (isActive: boolean) => ({
        padding: "12px 24px",
        backgroundColor: isActive ? "var(--brand-experiment)" : "var(--background-secondary)",
        color: "white",
        border: "none",
        borderRadius: isActive ? "12px 12px 0 0" : "12px",
        cursor: "pointer",
        marginRight: "4px",
        fontSize: "16px",
        fontWeight: isActive ? "700" : "500",
        transition: "all 0.3s ease",
        boxShadow: isActive ? "0 -2px 8px rgba(0,0,0,0.2)" : "none",
        transform: isActive ? "translateY(-2px)" : "none"
    });

    const getTabCounts = () => {
        const singleCount = Vencord.Plugins.plugins.autoBan?.settings?.store?.users?.split("/")?.filter(Boolean).length || 0;
        const multiCount = Vencord.Plugins.plugins.MultiServerAutoban?.settings?.store?.users?.split("/")?.filter(Boolean).length || 0;
        return { singleCount, multiCount };
    };

    const { singleCount, multiCount } = getTabCounts();

    const handleSyncUpload = async () => {
        const result = await syncUpload();
        alert(result.message);
        if (result.success) {
            setRefreshKey(prev => prev + 1);
        }
    };

    const handleSyncDownload = async () => {
        const result = await syncDownload();
        alert(result.message);
        if (result.success) {
            setRefreshKey(prev => prev + 1);
        }
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader style={{
                backgroundColor: "var(--background-primary)",
                borderBottom: "3px solid var(--brand-experiment)",
                padding: "20px"
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{
                            fontSize: "32px"
                        }}>
                            🔨
                        </div>
                        <div>
                            <Text
                                variant="heading-lg/semibold"
                                style={{
                                    color: "white",
                                    fontSize: "28px",
                                    fontWeight: "700"
                                }}
                            >
                                Auto-Ban List Management
                            </Text>
                            <Text style={{
                                color: "var(--text-muted)",
                                fontSize: "14px",
                                marginTop: "4px"
                            }}>
                                Export, import, sync and manage your ban lists
                            </Text>
                        </div>
                    </div>

                    {/* Sync buttons in header */}
                    <div style={{ display: "flex", gap: "8px" }}>
                        <Button
                            size="small"
                            color="blurple"
                            onClick={handleSyncDownload}
                            style={{
                                backgroundColor: "var(--brand-experiment)",
                                color: "white",
                                fontWeight: "600",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px"
                            }}
                        >
                            <SyncIcon />
                            Sync
                        </Button>

                        <Button
                            size="small"
                            color="green"
                            onClick={handleSyncUpload}
                            style={{
                                backgroundColor: "#43b581",
                                color: "white",
                                fontWeight: "600",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px"
                            }}
                        >
                            <UploadIcon />
                            Upload
                        </Button>
                    </div>
                </div>
            </ModalHeader>

            <ModalContent style={{
                backgroundColor: "var(--background-secondary)",
                padding: "0"
            }}>
                {/* Tab navigation */}
                <div style={{
                    padding: "20px 20px 0 20px",
                    backgroundColor: "var(--background-secondary)"
                }}>
                    <div style={{ display: "flex", borderBottom: "2px solid var(--background-modifier-accent)" }}>
                        <button
                            style={tabStyle(activeTab === "single")}
                            onClick={() => setActiveTab("single")}
                            onMouseEnter={e => {
                                if (activeTab !== "single") {
                                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--background-modifier-hover)";
                                    (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                                }
                            }}
                            onMouseLeave={e => {
                                if (activeTab !== "single") {
                                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--background-secondary)";
                                    (e.currentTarget as HTMLElement).style.transform = "none";
                                }
                            }}
                        >
                            🏠 Dadscord
                            <div style={{
                                display: "inline-block",
                                marginLeft: "8px",
                                backgroundColor: activeTab === "single" ? "rgba(255,255,255,0.2)" : "var(--brand-experiment)",
                                color: "white",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "12px",
                                fontWeight: "600"
                            }}>
                                {singleCount}
                            </div>
                        </button>
                        <button
                            style={tabStyle(activeTab === "multi")}
                            onClick={() => setActiveTab("multi")}
                            onMouseEnter={e => {
                                if (activeTab !== "multi") {
                                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--background-modifier-hover)";
                                    (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                                }
                            }}
                            onMouseLeave={e => {
                                if (activeTab !== "multi") {
                                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--background-secondary)";
                                    (e.currentTarget as HTMLElement).style.transform = "none";
                                }
                            }}
                        >
                            🌍 Multi Server
                            <div style={{
                                display: "inline-block",
                                marginLeft: "8px",
                                backgroundColor: activeTab === "multi" ? "rgba(255,255,255,0.2)" : "var(--brand-experiment)",
                                color: "white",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "12px",
                                fontWeight: "600"
                            }}>
                                {multiCount}
                            </div>
                        </button>
                    </div>
                </div>

                {/* Tab content */}
                <div style={{ padding: "0 20px 20px 20px" }} key={refreshKey}>
                    {activeTab === "single" ? (
                        <BanList
                            pluginName="autoBan"
                            usersKey="users"
                            reasonsKey="store"
                            title="Dadscord Bans"
                            onUpdate={handleUpdate}
                        />
                    ) : (
                        <BanList
                            pluginName="MultiServerAutoban"
                            usersKey="users"
                            reasonsKey="reasons"
                            title="Multi Server Bans"
                            onUpdate={handleUpdate}
                        />
                    )}
                </div>
            </ModalContent>

            <ModalFooter style={{
                backgroundColor: "var(--background-primary)",
                borderTop: "2px solid var(--background-modifier-accent)",
                padding: "16px 20px"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <Text style={{
                        color: "var(--text-muted)",
                        fontSize: "13px",
                        fontStyle: "italic"
                    }}>
                        💡 Tip: Use Alt+J to quickly open this menu | Use /sync, /upload, and /autosync commands for quick sync
                    </Text>
                    <Button
                        color="red"
                        onClick={modalProps.onClose}
                        style={{
                            backgroundColor: "#f04747",
                            color: "white",
                            fontWeight: "600",
                            padding: "10px 20px",
                            fontSize: "14px"
                        }}
                    >
                        Close
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "AutoBanMenu",
    description: "Enhanced ban list with import/export/sync functionality.",
    tags: ["Servers", "Utility"],
    authors: [
        { name: "dot", id: 1400610916285812776n },
        { name: "dot", id: 1400606596521791773n }
    ],

    dependencies: ["CommandsAPI"],

    commands: [
        {
            name: "sync",
            description: "Download and sync ban lists from shared storage",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (opts, ctx) => {
                console.log("[AutoBan] Sync command executed");
                try {
                    console.log("[AutoBan] Starting sync download...");
                    const result = await syncDownload();
                    console.log("[AutoBan] Sync result:", result);
                    return {
                        content: `[SYNC] ${result.message}`
                    };
                } catch (error) {
                    console.error("[AutoBan] Sync command error:", error);
                    return {
                        content: `[SYNC ERROR] Failed to sync ban lists. Error: ${(error as any).message || "Unknown error"}`
                    };
                }
            }
        },
        {
            name: "upload",
            description: "Upload current ban lists to shared storage",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (opts, ctx) => {
                console.log("[AutoBan] Upload command executed");
                try {
                    console.log("[AutoBan] Starting upload...");
                    const result = await syncUpload();
                    console.log("[AutoBan] Upload result:", result);
                    return {
                        content: `[UPLOAD] ${result.message}`
                    };
                } catch (error) {
                    console.error("[AutoBan] Upload command error:", error);
                    return {
                        content: `[UPLOAD ERROR] Failed to upload ban lists. Error: ${(error as any).message || "Unknown error"}`
                    };
                }
            }
        },
        {
            name: "autosync",
            description: "Toggle automatic sync every 5 minutes",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "state",
                    description: "Turn autosync on or off",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                    choices: [
                        { label: "on", value: "on", name: "on" },
                        { label: "off", value: "off", name: "off" }
                    ]
                }
            ],
            execute: async (opts, ctx) => {
                console.log("[AutoSync] Command executed with:", opts);
                try {
                    const state = findOption(opts, "state", "")?.toLowerCase();

                    if (state === "on") {
                        startAutoSync();
                        return {
                            content: "[AUTOSYNC] Auto-sync enabled! Ban lists will be downloaded every 5 minutes."
                        };
                    } else if (state === "off") {
                        stopAutoSync();
                        return {
                            content: "[AUTOSYNC] Auto-sync disabled."
                        };
                    } else {
                        return {
                            content: "[AUTOSYNC ERROR] Please use 'on' or 'off' as the argument."
                        };
                    }
                } catch (error) {
                    console.error("[AutoSync] Command error:", error);
                    return {
                        content: `[AUTOSYNC ERROR] Failed to toggle auto-sync. Error: ${(error as any).message || "Unknown error"}`
                    };
                }
            }
        }
    ],

    start() {
        document.addEventListener("keydown", handleKeydown);
        // Initialize last known state
        setTimeout(() => {
            lastKnownState = getCurrentBanListState();
        }, 1000);
    },

    stop() {
        document.removeEventListener("keydown", handleKeydown);
        // Clean up auto-sync when plugin stops
        if (autoSyncInterval) {
            clearInterval(autoSyncInterval);
            autoSyncInterval = null;
            autoSyncEnabled = false;
        }
    },
});

function handleKeydown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === "j") {
        openGuildInfoModal();
    }
}
