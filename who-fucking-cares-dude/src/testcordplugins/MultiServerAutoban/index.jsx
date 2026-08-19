/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Button, ChannelStore, FluxDispatcher, Forms, GuildChannelStore, GuildStore, Menu, React, RestAPI, TextInput, Toasts, UserStore } from "@webpack/common";
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const sessionStore = findByPropsLazy("getSessionId");
let pluginActive = false;
const settings = definePluginSettings({
    users: {
        type: 0 /* OptionType.STRING */,
        description: "Global user ban list (internal storage - do not edit manually)",
        default: "",
    },
    reasons: {
        type: 0 /* OptionType.STRING */,
        description: "Ban reasons storage (internal storage - do not edit manually)",
        default: "",
    },
    serverConfigs: {
        type: 0 /* OptionType.STRING */,
        description: "Server configurations (internal storage - do not edit manually)",
        default: "[]",
    },
    // Settings UI Component
    manageSettings: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Configure Multi-Server Auto-Ban Settings",
        default: null,
        component: () => <ServerConfigManager />
    }
});
// Settings Modal Component
function SettingsModal(props) {
    return (<ModalRoot {...props} size={"large" /* ModalSize.LARGE */}>
            <ModalHeader>
                <Forms.FormTitle tag="h2">Multi-Server Auto-Ban Settings</Forms.FormTitle>
            </ModalHeader>
            <ModalContent>
                <ServerConfigManager />
            </ModalContent>
            <ModalFooter>
                <Button color={Button.Colors.BRAND} onClick={props.onClose}>
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>);
}
// Debugging function to help troubleshoot channel loading
const debugChannelStructure = (guildId) => {
    console.log(`[Multi-Ban] Debug info for guild ${guildId}:`);
    try {
        const guildChannels = GuildChannelStore.getChannels(guildId);
        console.log("GuildChannelStore.getChannels():", guildChannels);
        console.log("Type:", typeof guildChannels);
        console.log("Keys:", guildChannels ? Object.keys(guildChannels) : "null");
    }
    catch (e) {
        console.log("GuildChannelStore.getChannels() error:", e);
    }
    try {
        const guild = GuildStore.getGuild(guildId);
        console.log("Guild object:", guild);
    }
    catch (e) {
        console.log("Guild object error:", e);
    }
    try {
        const allChannels = ChannelStore.getAllChannels?.();
        const guildChannels = Object.values(allChannels || {}).filter((c) => c.guild_id === guildId);
        console.log("Channels from getAllChannels():", guildChannels.length);
        console.log("Sample channel:", guildChannels[0]);
    }
    catch (e) {
        console.log("getAllChannels() error:", e);
    }
};
// Server Configuration Manager Component with Dropdowns
function ServerConfigManager() {
    const [configs, setConfigs] = React.useState([]);
    const [selectedGuildId, setSelectedGuildId] = React.useState("");
    const [selectedChannelId, setSelectedChannelId] = React.useState("");
    const [newCommand, setNewCommand] = React.useState("!voice-ban");
    const [availableServers, setAvailableServers] = React.useState([]);
    const [availableChannels, setAvailableChannels] = React.useState([]);
    const [loadingChannels, setLoadingChannels] = React.useState(false);
    // Load configurations and available servers on mount
    React.useEffect(() => {
        loadConfigs();
        loadAvailableServers();
    }, []);
    // Load channels when server selection changes
    React.useEffect(() => {
        if (selectedGuildId) {
            loadChannelsForServer(selectedGuildId);
        }
        else {
            setAvailableChannels([]);
            setSelectedChannelId("");
        }
    }, [selectedGuildId]);
    const loadConfigs = () => {
        try {
            const storedConfigs = JSON.parse(settings.store.serverConfigs || "[]");
            setConfigs(Array.isArray(storedConfigs) ? storedConfigs : []);
        }
        catch (e) {
            setConfigs([]);
        }
    };
    const loadAvailableServers = () => {
        try {
            const guilds = GuildStore.getGuilds();
            if (!guilds) {
                setAvailableServers([]);
                return;
            }
            const serverList = Object.values(guilds)
                .filter((guild) => guild && guild.id && guild.name)
                .map((guild) => ({
                id: guild.id,
                name: guild.name,
                icon: guild.icon || null
            }))
                .sort((a, b) => a.name.localeCompare(b.name));
            setAvailableServers(serverList);
        }
        catch (e) {
            console.error("[Multi-Ban] Error loading servers:", e);
            setAvailableServers([]);
        }
    };
    // Aggressive channel scanning function - attempts to find ALL channels regardless of permissions
    const loadChannelsForServer = (guildId) => {
        if (!guildId)
            return;
        setLoadingChannels(true);
        try {
            console.log(`[Multi-Ban] Aggressively scanning channels for guild: ${guildId}`);
            const channelList = [];
            const foundChannels = new Set(); // Track found channel IDs to avoid duplicates
            // Method 1: GuildChannelStore with all possible structure variations
            try {
                const guildChannels = GuildChannelStore.getChannels(guildId);
                console.log("[Multi-Ban] GuildChannelStore raw data:", guildChannels);
                if (guildChannels) {
                    // Recursively scan all properties for channel-like objects
                    const scanObject = (obj, path = "") => {
                        if (!obj || typeof obj !== "object")
                            return;
                        Object.keys(obj).forEach(key => {
                            const value = obj[key];
                            const currentPath = path ? `${path}.${key}` : key;
                            if (Array.isArray(value)) {
                                value.forEach((item, index) => {
                                    if (item && typeof item === "object" && item.id && item.name && (item.type === 0 || item.type === undefined)) {
                                        if (!foundChannels.has(item.id)) {
                                            foundChannels.add(item.id);
                                            channelList.push({
                                                id: item.id,
                                                name: item.name,
                                                type: "Text Channel",
                                                category: item.parent_id ? "In Category" : currentPath || "No Category"
                                            });
                                            console.log(`[Multi-Ban] Found channel via ${currentPath}[${index}]:`, item.name, item.id);
                                        }
                                    }
                                    else if (typeof item === "object") {
                                        scanObject(item, `${currentPath}[${index}]`);
                                    }
                                });
                            }
                            else if (value && typeof value === "object" && value.id && value.name && (value.type === 0 || value.type === undefined)) {
                                if (!foundChannels.has(value.id)) {
                                    foundChannels.add(value.id);
                                    channelList.push({
                                        id: value.id,
                                        name: value.name,
                                        type: "Text Channel",
                                        category: value.parent_id ? "In Category" : currentPath || "No Category"
                                    });
                                    console.log(`[Multi-Ban] Found channel via ${currentPath}:`, value.name, value.id);
                                }
                            }
                            else if (typeof value === "object") {
                                scanObject(value, currentPath);
                            }
                        });
                    };
                    scanObject(guildChannels);
                }
            }
            catch (e) {
                console.warn("[Multi-Ban] GuildChannelStore scanning failed:", e);
            }
            // Method 2: Brute force through ALL Discord channels
            try {
                console.log("[Multi-Ban] Brute force scanning all Discord channels...");
                const allChannels = ChannelStore.getAllChannels?.() || {};
                let totalScanned = 0;
                let guildMatches = 0;
                Object.values(allChannels).forEach((channel) => {
                    totalScanned++;
                    if (channel && channel.guild_id === guildId) {
                        guildMatches++;
                        // Accept any channel type that might be text-like (0 = GUILD_TEXT, but also try others)
                        if ((channel.type === 0 || channel.type === 5 || channel.type === 10 || channel.type === 11 || channel.type === 12) && channel.id && channel.name) {
                            if (!foundChannels.has(channel.id)) {
                                foundChannels.add(channel.id);
                                channelList.push({
                                    id: channel.id,
                                    name: channel.name,
                                    type: `Type ${channel.type}`,
                                    category: channel.parent_id ? "Categorized" : "Uncategorized"
                                });
                                console.log("[Multi-Ban] Found channel via brute force:", channel.name, channel.id, `type: ${channel.type}`);
                            }
                        }
                    }
                });
                console.log(`[Multi-Ban] Brute force results: ${totalScanned} total channels scanned, ${guildMatches} belonging to guild ${guildId}`);
            }
            catch (e) {
                console.warn("[Multi-Ban] Brute force channel scan failed:", e);
            }
            // Method 3: Try to enumerate channel IDs by pattern (experimental)
            try {
                console.log("[Multi-Ban] Attempting pattern-based channel discovery...");
                const guild = GuildStore.getGuild(guildId);
                if (guild) {
                    // Try to find channels in any guild properties
                    const scanGuildObject = (obj, path = "") => {
                        if (!obj || typeof obj !== "object")
                            return;
                        Object.keys(obj).forEach(key => {
                            const value = obj[key];
                            const currentPath = path ? `${path}.${key}` : key;
                            // Look for anything that looks like a channel ID (Discord snowflakes are ~18-20 digits)
                            if (typeof value === "string" && /^\d{17,20}$/.test(value)) {
                                try {
                                    const possibleChannel = ChannelStore.getChannel(value);
                                    if (possibleChannel && possibleChannel.guild_id === guildId && possibleChannel.name) {
                                        if (!foundChannels.has(possibleChannel.id)) {
                                            foundChannels.add(possibleChannel.id);
                                            channelList.push({
                                                id: possibleChannel.id,
                                                name: possibleChannel.name,
                                                type: "Discovered",
                                                category: "Pattern Found"
                                            });
                                            console.log("[Multi-Ban] Pattern discovered channel:", possibleChannel.name, possibleChannel.id);
                                        }
                                    }
                                }
                                catch (e) {
                                    // Ignore failed lookups
                                }
                            }
                            else if (Array.isArray(value)) {
                                value.forEach((item, index) => {
                                    scanGuildObject(item, `${currentPath}[${index}]`);
                                });
                            }
                            else if (typeof value === "object") {
                                scanGuildObject(value, currentPath);
                            }
                        });
                    };
                    scanGuildObject(guild);
                }
            }
            catch (e) {
                console.warn("[Multi-Ban] Pattern-based discovery failed:", e);
            }
            // Method 4: If still no channels, create some common channel IDs to test
            if (channelList.length === 0) {
                console.log("[Multi-Ban] No channels found, attempting to guess common channel names...");
                // Try to find channels by common names (this is a last resort)
                const commonNames = ["general", "chat", "main", "lobby", "welcome", "announcements", "rules"];
                // This method is limited since we can't actually guess channel IDs
                // Instead, let's try one more approach - check if we can access the guild's system channel
                try {
                    const guild = GuildStore.getGuild(guildId);
                    if (guild && guild.systemChannelId) {
                        const systemChannel = ChannelStore.getChannel(guild.systemChannelId);
                        if (systemChannel && !foundChannels.has(systemChannel.id)) {
                            foundChannels.add(systemChannel.id);
                            channelList.push({
                                id: systemChannel.id,
                                name: systemChannel.name || "system-channel",
                                type: "System Channel",
                                category: "Guild Default"
                            });
                            console.log("[Multi-Ban] Found system channel:", systemChannel.name, systemChannel.id);
                        }
                    }
                }
                catch (e) {
                    console.warn("[Multi-Ban] System channel lookup failed:", e);
                }
            }
            // Remove duplicates and sort
            const uniqueChannels = channelList.filter((channel, index, self) => index === self.findIndex(c => c.id === channel.id));
            uniqueChannels.sort((a, b) => {
                if (a.category !== b.category) {
                    return a.category.localeCompare(b.category);
                }
                return a.name.localeCompare(b.name);
            });
            console.log(`[Multi-Ban] Aggressive scan complete! Found ${uniqueChannels.length} unique channels for guild ${guildId}:`, uniqueChannels);
            setAvailableChannels(uniqueChannels);
            if (uniqueChannels.length === 0) {
                // Create a fallback option for manual entry
                setAvailableChannels([{
                        id: "manual-entry",
                        name: "Manual Entry Required",
                        type: "Fallback",
                        category: "No channels found"
                    }]);
                Toasts.show({
                    message: "No channels discovered automatically. You may need to manually enter a channel ID.",
                    type: Toasts.Type.FAILURE,
                    options: { position: Toasts.Position.BOTTOM }
                });
            }
        }
        catch (e) {
            console.error("[Multi-Ban] Error during aggressive channel scan:", e);
            setAvailableChannels([]);
            Toasts.show({
                message: `Channel scanning error: ${e.message}`,
                type: Toasts.Type.FAILURE,
                options: { position: Toasts.Position.BOTTOM }
            });
        }
        finally {
            setLoadingChannels(false);
        }
    };
    const saveConfigs = (newConfigs) => {
        settings.store.serverConfigs = JSON.stringify(newConfigs);
        setConfigs(newConfigs);
    };
    const addNewConfig = () => {
        if (!selectedGuildId || !selectedChannelId) {
            Toasts.show({
                message: "Please select both a server and a channel",
                type: Toasts.Type.FAILURE,
                options: { position: Toasts.Position.BOTTOM }
            });
            return;
        }
        // Check if this server is already configured
        const existingConfig = configs.find((config) => config.serverId === selectedGuildId);
        if (existingConfig) {
            Toasts.show({
                message: "This server is already configured. Remove the existing configuration first.",
                type: Toasts.Type.FAILURE,
                options: { position: Toasts.Position.BOTTOM }
            });
            return;
        }
        const newConfig = {
            serverId: selectedGuildId,
            channelId: selectedChannelId,
            voiceCommand: newCommand.trim() || "!voice-ban",
            requireBanPermission: false
        };
        const updatedConfigs = [...configs, newConfig];
        saveConfigs(updatedConfigs);
        // Reset form
        setSelectedGuildId("");
        setSelectedChannelId("");
        setNewCommand("!voice-ban");
        Toasts.show({
            message: "Server configuration added successfully",
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.BOTTOM }
        });
    };
    const removeConfig = (index) => {
        const updatedConfigs = configs.filter((_, i) => i !== index);
        saveConfigs(updatedConfigs);
        Toasts.show({
            message: "Server configuration removed",
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
    };
    const getGuildName = (guildId) => {
        try {
            const guild = GuildStore.getGuild(guildId);
            return guild ? guild.name : "Unknown Server";
        }
        catch (e) {
            return "Unknown Server";
        }
    };
    const getChannelName = (channelId) => {
        try {
            const channel = ChannelStore.getChannel(channelId);
            return channel ? `#${channel.name}` : "Unknown Channel";
        }
        catch (e) {
            return "Unknown Channel";
        }
    };
    return (<div style={{
            padding: "16px",
            backgroundColor: "var(--background-secondary)",
            borderRadius: "8px",
            margin: "8px 0"
        }}>
            <Forms.FormTitle style={{ marginBottom: "16px", fontSize: "18px" }}>
                dot's Multi-Server Auto-Ban Configuration
            </Forms.FormTitle>

            <Forms.FormText style={{ marginBottom: "20px", color: "var(--text-muted)" }}>
                Configure servers where banned users should be automatically voice banned when they join voice channels.
            </Forms.FormText>

            {/* Add New Server Section */}
            <div style={{
            backgroundColor: "var(--background-primary)",
            padding: "16px",
            borderRadius: "6px",
            marginBottom: "20px"
        }}>
                <Forms.FormTitle style={{ marginBottom: "12px", fontSize: "16px" }}>
                    Add New Server
                </Forms.FormTitle>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                    {/* Server dropdown */}
                    <div>
                        <Forms.FormText style={{ marginBottom: "8px", fontSize: "12px", fontWeight: "600" }}>
                            Select Server *
                        </Forms.FormText>
                        <select value={selectedGuildId} onChange={e => {
            const selectedId = e.target.value;
            setSelectedGuildId(selectedId);
            // Add debugging
            if (selectedId) {
                console.log(`[Multi-Ban] Selected guild: ${selectedId}`);
                debugChannelStructure(selectedId);
            }
        }} style={{
            width: "100%",
            padding: "8px 12px",
            backgroundColor: "black",
            border: "1px solid #333",
            borderRadius: "4px",
            color: "white",
            fontSize: "14px"
        }}>
                            <option value="" style={{ color: "white", backgroundColor: "black" }}>Choose a server...</option>
                            {availableServers.map(server => (<option key={server.id} value={server.id} style={{ color: "white", backgroundColor: "black" }}>
                                    {server.name}
                                </option>))}
                        </select>
                        {availableServers.length === 0 && (<Forms.FormText style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                                No servers found. Make sure you're logged into Discord.
                            </Forms.FormText>)}
                    </div>

                    {/* Channel dropdown */}
                    <div>
                        <Forms.FormText style={{ marginBottom: "8px", fontSize: "12px", fontWeight: "600" }}>
                            Select Command Channel *
                        </Forms.FormText>
                        <select value={selectedChannelId} onChange={e => setSelectedChannelId(e.target.value)} disabled={!selectedGuildId || loadingChannels} style={{
            width: "100%",
            padding: "8px 12px",
            backgroundColor: !selectedGuildId ? "#333" : "black",
            border: "1px solid #333",
            borderRadius: "4px",
            color: !selectedGuildId ? "#999" : "white",
            fontSize: "14px",
            cursor: !selectedGuildId ? "not-allowed" : "pointer"
        }}>
                            <option value="" style={{ color: "white", backgroundColor: "black" }}>
                                {!selectedGuildId ? "Select a server first..." :
            loadingChannels ? "Scanning all channels..." :
                "Choose a channel..."}
                            </option>
                            {availableChannels.map(channel => (<option key={channel.id} value={channel.id} style={{ color: "white", backgroundColor: "black" }}>
                                    #{channel.name} ({channel.category})
                                </option>))}
                        </select>
                        {selectedGuildId && availableChannels.length === 0 && !loadingChannels && (<Forms.FormText style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                                No text channels found or no permission to view channels.
                            </Forms.FormText>)}
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px", marginBottom: "12px" }}>
                    <div>
                        <Forms.FormText style={{ marginBottom: "8px", fontSize: "12px", fontWeight: "600" }}>
                            Ban Command
                        </Forms.FormText>
                        <TextInput placeholder="!voice-ban" value={newCommand} onChange={setNewCommand} style={{ width: "100%" }}/>
                        <Forms.FormText style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                            The command that will be sent to ban users (e.g., !voice-ban, /ban, !tempban)
                        </Forms.FormText>
                    </div>
                </div>

                <div style={{ marginBottom: "12px" }}>
                    <Forms.FormText style={{
            fontSize: "12px",
            color: "var(--text-muted)",
            fontStyle: "italic"
        }}>
                        Note: Permission requirements are disabled - auto-ban will work regardless of your permissions
                    </Forms.FormText>
                </div>

                <Button color={Button.Colors.BRAND} onClick={addNewConfig} disabled={!selectedGuildId || !selectedChannelId} style={{ marginTop: "8px" }}>
                    Add Server
                </Button>
            </div>

            {/* Current Servers Section */}
            <div>
                <Forms.FormTitle style={{ marginBottom: "12px", fontSize: "16px" }}>
                    Configured Servers ({configs.length})
                </Forms.FormTitle>

                {configs.length === 0 ? (<div style={{
                padding: "20px",
                textAlign: "center",
                backgroundColor: "var(--background-primary)",
                borderRadius: "6px",
                border: "2px dashed var(--background-modifier-accent)"
            }}>
                        <Forms.FormText style={{ color: "var(--text-muted)" }}>
                            No servers configured yet. Add your first server above.
                        </Forms.FormText>
                    </div>) : (<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {configs.map((config, index) => (<div key={config.serverId ?? index} style={{
                    backgroundColor: "var(--background-primary)",
                    padding: "12px",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
                                        <Forms.FormText style={{ fontWeight: "600", fontSize: "14px" }}>
                                            {getGuildName(config.serverId)}
                                        </Forms.FormText>
                                        <Forms.FormText style={{
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    backgroundColor: "var(--background-secondary)",
                    padding: "2px 6px",
                    borderRadius: "3px"
                }}>
                                            {config.serverId}
                                        </Forms.FormText>
                                    </div>

                                    <div style={{ display: "flex", gap: "16px" }}>
                                        <Forms.FormText style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                            Channel: {getChannelName(config.channelId)}
                                        </Forms.FormText>
                                        <Forms.FormText style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                            Command: {config.voiceCommand}
                                        </Forms.FormText>
                                        <Forms.FormText style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                            Permissions: Disabled (always execute)
                                        </Forms.FormText>
                                    </div>
                                </div>

                                <Button color={Button.Colors.RED} size={Button.Sizes.SMALL} onClick={() => removeConfig(index)}>
                                    Remove
                                </Button>
                            </div>))}
                    </div>)}
            </div>

            {/* Help Section */}
            <div style={{
            marginTop: "20px",
            padding: "12px",
            backgroundColor: "var(--background-modifier-accent)",
            borderRadius: "6px"
        }}>
                <Forms.FormText style={{ fontSize: "12px", lineHeight: "1.4" }}>
                    <strong>How to use:</strong><br />
                    1. Select a server from the dropdown<br />
                    2. Select a text channel where ban commands should be sent<br />
                    3. Configure the ban command (default: !voice-ban)<br />
                    4. Right-click any user and click "Multi-Server Auto-Ban" to toggle them on the ban list<br />
                    5. When a banned user joins a voice channel you're in, they'll be automatically banned<br />
                    6. Permission checks are disabled - auto-bans will execute regardless of your Discord permissions
                </Forms.FormText>
            </div>
        </div>);
}
// Helper function to get server configurations
function getServerConfigs() {
    try {
        const configs = JSON.parse(settings.store.serverConfigs || "[]");
        return Array.isArray(configs) ? configs : [];
    }
    catch (e) {
        return [];
    }
}
// Helper function to check if user has permission in a server (now always returns true)
function hasPermissionInServer(serverId, requireBanPermission = false) {
    // Always return true - ignore permission requirements
    return true;
}
// Helper function to get current server configuration
function getCurrentServerConfig() {
    const currentUserId = UserStore.getCurrentUser().id;
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    if (!currentVoiceState?.channelId)
        return null;
    const channel = ChannelStore.getChannel(currentVoiceState.channelId);
    if (!channel?.guild_id)
        return null;
    const configs = getServerConfigs();
    return configs.find(config => config.serverId === channel.guild_id);
}
function makeContextMenuPatch() {
    return (children, props) => {
        if (!props)
            return;
        const ban = MenuItem(props.user.id);
        if (!ban)
            return;
        children.splice(-1, 0, <Menu.MenuGroup>{ban}</Menu.MenuGroup>);
    };
}
function MenuItem(id) {
    if (UserStore.getCurrentUser().id === id)
        return;
    const bannedUsers = settings.store.users.split("/").filter(item => item !== "");
    const isCurrentlyBanned = bannedUsers.includes(id);
    return (<Menu.MenuItem id="multi-auto-ban" label={isCurrentlyBanned ? "Remove from Multi-Server Auto-Ban" : "Add to Multi-Server Auto-Ban"} action={async () => {
            if (!isCurrentlyBanned) {
                // Adding user to ban list - do it directly
                const updatedList = [...bannedUsers, id];
                settings.store.users = updatedList.join("/");
                // Check if they're in current VC and ban them immediately
                const currentUserId = UserStore.getCurrentUser().id;
                const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
                if (currentVoiceState?.channelId) {
                    const targetVoiceState = VoiceStateStore.getVoiceStateForUser(id);
                    // Check if target user is in the same VC as current user
                    if (targetVoiceState?.channelId === currentVoiceState.channelId) {
                        const serverConfig = getCurrentServerConfig();
                        if (serverConfig && hasPermissionInServer(serverConfig.serverId, serverConfig.requireBanPermission)) {
                            Toasts.show({
                                message: `Auto banning User ${id} (added to list while in VC)`,
                                id: "multi-auto-ban-immediate",
                                type: Toasts.Type.SUCCESS,
                                options: {
                                    position: Toasts.Position.BOTTOM
                                }
                            });
                            const t = setTimeout(() => {
                                pendingBanTimeouts.delete(t);
                                sendBanCommand(id, serverConfig.channelId, serverConfig.voiceCommand, " (added to list while in VC)");
                            }, 200);
                            pendingBanTimeouts.add(t);
                            return;
                        }
                    }
                }
                Toasts.show({
                    message: `Added User ${id} to multi-server ban list`,
                    id: "multi-auto-ban-add",
                    type: Toasts.Type.SUCCESS,
                    options: {
                        position: Toasts.Position.BOTTOM
                    }
                });
            }
            else {
                // Removing user from ban list - do it directly
                const updatedList = bannedUsers.filter(userId => userId !== id);
                settings.store.users = updatedList.join("/");
                // Also remove their reason if it exists
                const currentReasons = settings.store.reasons.split(".").filter(Boolean);
                const updatedReasons = currentReasons.filter(entry => !entry.startsWith(`${id}/`));
                settings.store.reasons = updatedReasons.join(".");
                Toasts.show({
                    message: `Removed User ${id} from multi-server ban list`,
                    id: "multi-auto-ban-remove",
                    type: Toasts.Type.MESSAGE,
                    options: {
                        position: Toasts.Position.BOTTOM
                    }
                });
            }
        }}/>);
}
// Function to send ban command (simplified version based on working original)
function sendBanCommand(userId, channelId, command, context = "") {
    console.log(`[Multi-Ban] Attempting to send to channel ${channelId}: ${command} ${userId}${context}`);
    // Validate inputs
    if (!channelId || !userId || !command) {
        console.error(`[Multi-Ban] Missing required parameters - channelId: ${channelId}, userId: ${userId}, command: ${command}`);
        Toasts.show({
            message: `Invalid parameters for ban command${context}`,
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }
    // Check if channel exists and is accessible
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) {
        console.error(`[Multi-Ban] Channel not found: ${channelId}`);
        Toasts.show({
            message: `Channel not found (ID: ${channelId})${context}`,
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }
    console.log(`[Multi-Ban] Channel found: ${channel.name || "Unknown"} in guild ${channel.guild_id || "DM"}`);
    const messageBody = {
        content: `${command} ${userId}`,
        nonce: (Math.floor(Math.random() * 10000000000000)).toString()
    };
    console.log("[Multi-Ban] Sending message:", messageBody);
    RestAPI.post({
        url: `/channels/${channelId}/messages`,
        body: messageBody
    }).then(response => {
        console.log(`[Multi-Ban] Successfully sent command${context}:`, response);
        Toasts.show({
            message: `Ban command sent successfully${context}`,
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.BOTTOM }
        });
    }).catch(error => {
        console.error(`[Multi-Ban] Failed to send ban command${context}:`, error);
        // More detailed error handling
        let errorMessage = "Unknown error";
        if (error.body && error.body.message) {
            errorMessage = error.body.message;
        }
        else if (error.message) {
            errorMessage = error.message;
        }
        else if (error.status) {
            errorMessage = `HTTP ${error.status}`;
        }
        Toasts.show({
            message: `Failed to send ban command${context}: ${errorMessage}`,
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
        // Log the full error for debugging
        console.log("[Multi-Ban] Full error object:", error);
    });
}
// Function to ban user in current server
function banUserInCurrentServer(userId) {
    const serverConfig = getCurrentServerConfig();
    if (!serverConfig) {
        Toasts.show({
            message: "No server configuration found for current server",
            id: "multi-ban-error",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        return;
    }
    if (!hasPermissionInServer(serverConfig.serverId, serverConfig.requireBanPermission)) {
        Toasts.show({
            message: "No permission to ban in this server (missing Ban Members permission)",
            id: "multi-ban-permission-error",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        return;
    }
    // Send ban command with delay
    const timeout = setTimeout(() => {
        pendingBanTimeouts.delete(timeout);
        if (!pluginActive)
            return;
        sendBanCommand(userId, serverConfig.channelId, serverConfig.voiceCommand);
    }, 200);
    pendingBanTimeouts.add(timeout);
}
// Function to check existing users in voice channel
function checkExistingUsersInVC(channelId) {
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    const bannedUsers = settings.store.users.split("/").filter(item => item !== "");
    const currentUserId = UserStore.getCurrentUser().id;
    // Check if current user is in the voice channel
    if (!Object.keys(voiceStates).includes(currentUserId))
        return;
    const serverConfig = getCurrentServerConfig();
    if (!serverConfig)
        return;
    // Check if we have permission
    if (!hasPermissionInServer(serverConfig.serverId, serverConfig.requireBanPermission)) {
        return;
    }
    // Check each user in the voice channel
    Object.keys(voiceStates).forEach((userId, index) => {
        if (userId === currentUserId)
            return; // Don't ban yourself
        if (bannedUsers.includes(userId)) {
            Toasts.show({
                message: `Auto banning existing User ${userId} in voice channel`,
                type: Toasts.Type.SUCCESS,
                options: { position: Toasts.Position.BOTTOM }
            });
            // Add delay between multiple bans to prevent rate limiting
            const timeout = setTimeout(() => {
                pendingBanTimeouts.delete(timeout);
                if (!pluginActive)
                    return;
                sendBanCommand(userId, serverConfig.channelId, serverConfig.voiceCommand, " (existing user in VC)");
            }, 200 * (index + 1));
            pendingBanTimeouts.add(timeout);
        }
    });
}
// Keyboard shortcut handler
function handleKeyDown(event) {
    // Alt + B to open settings
    if (event.altKey && event.code === "KeyB") {
        event.preventDefault();
        openModal((props) => <SettingsModal {...props}/>);
    }
}
export default definePlugin({
    name: "MultiServerAutoban",
    description: "dot's Multi-server automatic ban system. Press Alt+B to open settings.",
    tags: ["Servers", "Utility"],
    authors: [TestcordDevs.dot],
    settings,
    contextMenus: {
        "user-context": makeContextMenuPatch()
    },
    start() {
        pluginActive = true;
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", voiceStateCallback);
        document.addEventListener("keydown", handleKeyDown);
        Toasts.show({
            message: "Multi-Server Auto-Ban loaded! Press Alt+B to configure settings.",
            id: "multi-auto-ban-loaded",
            type: Toasts.Type.SUCCESS,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
    },
    stop() {
        pluginActive = false;
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", voiceStateCallback);
        document.removeEventListener("keydown", handleKeyDown);
        for (const id of pendingBanTimeouts)
            clearTimeout(id);
        pendingBanTimeouts.clear();
    }
});
// Deferred ban/check timers — tracked so stop() can cancel any still pending after teardown
const pendingBanTimeouts = new Set();
const voiceStateCallback = async (e) => {
    const state = e.voiceStates[0];
    if (!state?.channelId)
        return;
    const currentUserId = UserStore.getCurrentUser().id;
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(state?.channelId) ?? {};
    // Check if current user just joined a voice channel
    if (state.userId === currentUserId && state?.channelId !== state?.oldChannelId && state?.channelId) {
        // Small delay to ensure voice state is fully updated
        const t = setTimeout(() => {
            pendingBanTimeouts.delete(t);
            if (!pluginActive)
                return;
            checkExistingUsersInVC(state.channelId);
        }, 500);
        pendingBanTimeouts.add(t);
        return;
    }
    // Original logic for when someone else joins
    if (state?.channelId === state?.oldChannelId)
        return;
    if (!Object.keys(voiceStates).includes(currentUserId))
        return;
    const bannedUsers = settings.store.users.split("/").filter(item => item !== "");
    if (bannedUsers.includes(state.userId)) {
        const serverConfig = getCurrentServerConfig();
        if (!serverConfig) {
            Toasts.show({
                message: `User ${state.userId} is on ban list but no server config found`,
                id: "multi-ban-no-config",
                type: Toasts.Type.FAILURE,
                options: {
                    position: Toasts.Position.BOTTOM
                }
            });
            return;
        }
        if (!hasPermissionInServer(serverConfig.serverId, serverConfig.requireBanPermission)) {
            Toasts.show({
                message: `User ${state.userId} joined but you lack permission to ban (missing Ban Members permission)`,
                id: "multi-ban-no-permission",
                type: Toasts.Type.FAILURE,
                options: {
                    position: Toasts.Position.BOTTOM
                }
            });
            return;
        }
        Toasts.show({
            message: `Auto banning User ${state.userId} via multi-server system`,
            id: "multi-auto-ban-trigger",
            type: Toasts.Type.SUCCESS,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        // Send ban command with working logic from original
        const t = setTimeout(() => {
            pendingBanTimeouts.delete(t);
            if (!pluginActive)
                return;
            sendBanCommand(state.userId, serverConfig.channelId, serverConfig.voiceCommand, " (joined voice channel)");
        }, 100);
        pendingBanTimeouts.add(t);
    }
};
