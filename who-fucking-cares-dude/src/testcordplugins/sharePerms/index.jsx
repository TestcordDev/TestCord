/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { sendBotMessage } from "@api/Commands";
import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { FolderIcon as VFolderIcon, SafetyIcon as VSafetyIcon } from "@components/Icons";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Avatar, Button, ChannelStore, FluxDispatcher, Forms, GuildStore, IconUtils, React, RelationshipStore, RestAPI, ScrollerThin, SearchableSelect, Select, showToast, Text, Toasts, useMemo, UserStore } from "@webpack/common";
const ShieldIcon = (props) => <VSafetyIcon width={props.width || 24} height={props.height || 24} {...props}/>;
const GuildMemberActions = findByPropsLazy("setCommunicationDisabledUntil", "kickUser", "banUser", "setNickname");
const VoiceActions = findByPropsLazy("setChannel", "setServerMute");
const MemberRoleActions = findByPropsLazy("updateMemberRoles");
const MessageActions = findByPropsLazy("deleteMessages", "sendMessage");
const MessageStore = findByPropsLazy("getMessages");
const UserProfileActions = findByPropsLazy("openUserProfileModal", "closeUserProfileModal");
const InviteActions = findByPropsLazy("resolveInvite");
const PrivateChannelActions = findByPropsLazy("ensurePrivateChannel");
const VoiceStateStore = findByPropsLazy("getVoiceState");
const MemberStore = findByPropsLazy("getMember");
const settings = definePluginSettings({
    sharedUsers: {
        type: 0 /* OptionType.STRING */,
        description: "Internal: list of shared users",
        default: "[]",
        hidden: true
    },
    logs: {
        type: 0 /* OptionType.STRING */,
        description: "Internal: logs of actions",
        default: "[]",
        hidden: true
    }
});
function parseDuration(str) {
    const match = str.match(/^(\d+)([smhdwy]?)$/);
    if (!match)
        return 0;
    const val = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
        case "s": return val * 1000;
        case "m": return val * 60 * 1000;
        case "h": return val * 60 * 60 * 1000;
        case "d": return val * 24 * 60 * 60 * 1000;
        case "w": return val * 7 * 24 * 60 * 60 * 1000;
        case "y": return val * 365 * 24 * 60 * 60 * 1000;
        default: return val * 1000;
    }
}
function getSharedUsers() {
    try {
        return JSON.parse(settings.store.sharedUsers);
    }
    catch {
        return [];
    }
}
function saveSharedUsers(users) {
    settings.store.sharedUsers = JSON.stringify(users);
}
function getLogs() {
    try {
        return JSON.parse(settings.store.logs);
    }
    catch {
        return [];
    }
}
function saveLog(log) {
    const logs = getLogs();
    logs.unshift(log);
    settings.store.logs = JSON.stringify(logs.slice(0, 50)); // Keep last 50
}
function InternalFolderIcon(props) {
    return (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M12 8v4"/>
            <path d="M12 16h.01"/>
        </svg>);
}
function SharePermsButton() {
    return (<HeaderBarButton icon={InternalFolderIcon} tooltip="SharePerms Manager" onClick={() => openModal(props => <SharePermsModal rootProps={props}/>)}/>);
}
function formatTimeLeft(ms) {
    if (ms === Infinity)
        return "Permanent";
    if (ms <= 0)
        return "Expired";
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const parts = [];
    if (days > 0)
        parts.push(days + "d");
    if (hours > 0)
        parts.push(hours + "h");
    if (minutes > 0)
        parts.push(minutes + "m");
    if (seconds > 0 || parts.length === 0)
        parts.push(seconds + "s");
    return parts.join(" ");
}
function SharePermsModal({ rootProps }) {
    const [users, setUsers] = React.useState(getSharedUsers());
    const [logs, setLogs] = React.useState(getLogs());
    const [newUserIds, setNewUserIds] = React.useState([]);
    const [newGuildId, setNewGuildId] = React.useState("");
    const [newChannelId, setNewChannelId] = React.useState("");
    const [newDuration, setNewDuration] = React.useState("1d");
    const [newMaxUses, setNewMaxUses] = React.useState("0"); // 0 = unlimited
    const [newPerms, setNewPerms] = React.useState(["all"]);
    const [now, setNow] = React.useState(Date.now());
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const friends = useMemo(() => RelationshipStore.getFriendIDs().map((id) => UserStore.getUser(id)).filter(Boolean), []);
    const guilds = useMemo(() => Object.values(GuildStore.getGuilds()), []);
    const addUser = async () => {
        if (newUserIds.length === 0 || !newGuildId)
            return;
        const updated = [...users];
        for (const userId of newUserIds) {
            const newUser = {
                id: userId,
                guildId: newGuildId,
                channelId: newChannelId,
                permissions: newPerms.join(","),
                validUntil: newDuration,
                startTime: Date.now(),
                prefix: "+",
                maxUses: parseInt(newMaxUses) || 0,
                uses: 0,
                usesMap: {}
            };
            updated.push(newUser);
            // Notify via DM
            try {
                const guild = GuildStore.getGuild(newGuildId);
                const channelInfo = newChannelId ? `only in <#${newChannelId}>` : "anywhere";
                const usesInfo = newUser.maxUses > 0 ? `${newUser.maxUses} times` : "Unlimited";
                const messageContent = "🛡 **Nightcord Permission Access Granted**\n\n" +
                    "Hello! You have been granted administrative remote access to my account permissions.\n\n" +
                    "**Details:**\n" +
                    `- **Server:** ${guild?.name || "Unknown Server"} (${newGuildId})\n` +
                    `- **Channel:** ${channelInfo}\n` +
                    `- **Validity:** ${newDuration === "0" ? "Permanent" : newDuration}\n` +
                    `- **Usage Limit:** ${usesInfo}\n` +
                    `- **Permissions:** ${newPerms.map(p => p.replace("_", " ").toUpperCase()).join(", ")}\n\n` +
                    "**Available Commands:**\n" +
                    "`+timeout <ID/@user> <duration>` - Timeout a user\n" +
                    "`+kick <ID/@user>` - Kick a user\n" +
                    "`+ban <ID/@user>` - Ban a user\n" +
                    "`+clear <amount>` - Delete messages\n" +
                    "`+rename <ID/@user> <name>` - Rename a user\n" +
                    "`+addrole <ID/@user> <RoleID>` - Add a role\n" +
                    "`+mute <ID/@user>` - Server mute in voice\n" +
                    "`+disconnect <ID/@user>` - Disconnect from voice\n" +
                    "`+move <ID/@user>` - Move user to your voice channel\n\n" +
                    "*Please use these permissions responsibly.*";
                // Final fix for DM: Use RestAPI with the most direct format to avoid group creation
                try {
                    // Try to find if we already have a DM channel
                    const channels = Object.values(ChannelStore.getMutablePrivateChannels());
                    let dmChannelId = channels.find((c) => c.type === 1 && c.recipients?.includes(userId))?.id;
                    if (!dmChannelId) {
                        // Create it via API if not found
                        const resp = await RestAPI.post({
                            url: "/users/@me/channels",
                            body: { recipient_id: userId }
                        });
                        dmChannelId = resp.body?.id;
                    }
                    if (dmChannelId) {
                        await RestAPI.post({
                            url: `/channels/${dmChannelId}/messages`,
                            body: {
                                content: messageContent,
                                flags: 0,
                                tts: false
                            }
                        });
                    }
                }
                catch (e) {
                    console.error("DM Error:", e);
                }
            }
            catch (e) {
                console.error("Failed to send DM to " + userId, e);
            }
        }
        setUsers(updated);
        saveSharedUsers(updated);
        setNewUserIds([]);
        showToast("Access granted and users notified", Toasts.Type.SUCCESS);
    };
    const removeUser = async (index) => {
        const userToRemove = users[index];
        const updated = [...users];
        updated.splice(index, 1);
        setUsers(updated);
        saveSharedUsers(updated);
        // Notify via DM
        if (userToRemove) {
            try {
                const guild = GuildStore.getGuild(userToRemove.guildId);
                const messageContent = "🛡 **Nightcord Permission Access Revoked**\n\n" +
                    "Your administrative remote access has been revoked.\n\n" +
                    "**Details:**\n" +
                    `- **Server:** ${guild?.name || "Unknown Server"} (${userToRemove.guildId})\n` +
                    "- **Status:** Access Terminated\n\n" +
                    "*If you believe this is an error, please contact the account owner.*";
                // Reuse the DM logic
                const channels = Object.values(ChannelStore.getMutablePrivateChannels());
                let dmChannelId = channels.find((c) => c.type === 1 && c.recipients?.includes(userToRemove.id))?.id;
                if (!dmChannelId) {
                    const resp = await RestAPI.post({
                        url: "/users/@me/channels",
                        body: { recipient_id: userToRemove.id }
                    });
                    dmChannelId = resp.body?.id;
                }
                if (dmChannelId) {
                    await RestAPI.post({
                        url: `/channels/${dmChannelId}/messages`,
                        body: {
                            content: messageContent,
                            flags: 0,
                            tts: false
                        }
                    });
                }
            }
            catch (e) {
                console.error("Failed to send revocation DM to " + userToRemove.id, e);
            }
        }
    };
    const permOptions = [
        { label: "Full Access", value: "all" },
        { label: "Rename User", value: "rename_user" },
        { label: "Ban", value: "ban" },
        { label: "Kick", value: "kick" },
        { label: "Timeout", value: "timeout" },
        { label: "Add Role", value: "add_role" },
        { label: "Mute Voice", value: "mute_voice" },
        { label: "Disconnect Voice", value: "disconnect_voice" },
        { label: "Move Voice", value: "move_voice" }
    ];
    return (<ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                    <VFolderIcon width={24} height={24}/>
                    <Text variant="heading-lg/semibold" color="header-primary" style={{ color: "#FFFFFF" }}>SharePerms Manager</Text>
                </div>
                <ModalCloseButton onClick={rootProps.onClose}/>
            </ModalHeader>
            <ModalContent style={{ padding: 20 }}>
                <div style={{ marginBottom: 20 }}>
                    <Text variant="heading-md/bold" style={{ marginBottom: 15, color: "#FFFFFF" }}>Add New Access</Text>

                    <Forms.FormTitle style={{ color: "#FFFFFF", marginBottom: 8 }}>Target Users (Friends)</Forms.FormTitle>
                    <SearchableSelect options={friends.map((f) => ({
            label: f.globalName || f.username,
            value: f.id
        }))} value={newUserIds} onChange={(val) => setNewUserIds(val)} placeholder="Select friends" multi={true} {...{
        renderOption: (opt) => {
            const user = UserStore.getUser(opt.value);
            return (<div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px" }}>
                                        <Avatar src={IconUtils.getUserAvatarURL(user)} size={"SIZE_48"}/>
                                        <Text color="header-primary" style={{ fontSize: "20px", fontWeight: "600" }}>{opt.label}</Text>
                                    </div>);
        },
        renderOptionLabel: (opt) => {
            const user = UserStore.getUser(opt.value);
            return (<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px" }}>
                                        <Avatar src={IconUtils.getUserAvatarURL(user)} size={"SIZE_24"}/>
                                        <Text color="header-primary" style={{ fontSize: "16px", fontWeight: "500" }}>{opt.label}</Text>
                                    </div>);
        }
    }}/>

                    <Forms.FormTitle style={{ color: "#FFFFFF", marginBottom: 8, marginTop: 15 }}>Server (Guild)</Forms.FormTitle>
                    <SearchableSelect options={guilds.map((g) => ({
            label: g.name,
            value: g.id
        }))} value={newGuildId} onChange={(val) => setNewGuildId(val)} placeholder="Select a server"/>

                    <div style={{ display: "flex", gap: 15, marginTop: 15 }}>
                        <div style={{ flex: 1 }}>
                            <Forms.FormTitle style={{ color: "#FFFFFF", marginBottom: 8 }}>Duration</Forms.FormTitle>
                            <Select options={[
            { label: "1 Hour", value: "1h" },
            { label: "6 Hours", value: "6h" },
            { label: "12 Hours", value: "12h" },
            { label: "1 Day", value: "1d" },
            { label: "1 Week", value: "1w" },
            { label: "Permanent", value: "0" }
        ]} isSelected={(val) => newDuration === val} select={(val) => setNewDuration(val)} serialize={(val) => val}/>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Forms.FormTitle style={{ color: "#FFFFFF", marginBottom: 8 }}>Max Uses</Forms.FormTitle>
                            <Select options={[
            { label: "Unlimited", value: "0" },
            { label: "1 Use", value: "1" },
            { label: "3 Uses", value: "3" },
            { label: "5 Uses", value: "5" },
            { label: "10 Uses", value: "10" },
            { label: "25 Uses", value: "25" },
            { label: "50 Uses", value: "50" }
        ]} isSelected={(val) => newMaxUses === val} select={(val) => setNewMaxUses(val)} serialize={(val) => val}/>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Forms.FormTitle style={{ color: "#FFFFFF", marginBottom: 8 }}>Permissions</Forms.FormTitle>
                            <SearchableSelect options={permOptions} value={newPerms} onChange={(val) => {
            if (val.includes("all") && !newPerms.includes("all")) {
                setNewPerms(["all"]);
            }
            else {
                setNewPerms(val.filter(p => p !== "all" || val.length === 1));
            }
        }} multi={true} wrapperClassName="shareperms-select"/>
                            <style>{`
                                .shareperms-select input {
                                    display: none !important;
                                }
                                .shareperms-select [role="combobox"] {
                                    cursor: pointer !important;
                                }
                            `}</style>
                        </div>
                    </div>
                    <Button onClick={addUser} color={Button.Colors.BRAND} style={{ marginTop: 20, width: "100%" }}>Grant Access</Button>
                </div>

                <Text variant="heading-md/bold" style={{ marginBottom: 15, marginTop: 25, color: "#FFFFFF" }}>Active Permissions</Text>
                <div className="shareperms-list">
                    {users.length === 0 ? (<Text style={{ color: "#FFFFFF", opacity: 0.6 }}>No one has access yet.</Text>) : users.map((u, index) => {
            const user = UserStore.getUser(u.id);
            const duration = parseDuration(u.validUntil);
            const timeLeft = duration ? Math.max(0, u.startTime + duration - now) : Infinity;
            return (<div key={`${u.id}-${index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "var(--background-secondary)", borderRadius: 8, marginBottom: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    <Avatar src={IconUtils.getUserAvatarURL(user || { id: u.id, avatar: null })} size={"SIZE_40"}/>
                                    <div>
                                        <Text variant="text-md/semibold" style={{ color: "#FFFFFF" }}>{user?.globalName || user?.username || u.id}</Text>
                                        <Text variant="text-xs/normal" style={{ color: "#FFFFFF", opacity: 0.7, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {u.permissions.split(",").map(p => p.replace("_", " ").toUpperCase()).join(", ")}
                                        </Text>
                                        <div style={{ display: "flex", gap: 10 }}>
                                            <Text variant="text-xs/bold" style={{ color: timeLeft < 300000 ? "#FF4444" : "#44FF44" }}>
                                                {formatTimeLeft(timeLeft)}
                                            </Text>
                                            {u.maxUses > 0 && (<Text variant="text-xs/bold" style={{ color: (u.maxUses - u.uses) <= 1 ? "#FF4444" : "#44FF44" }}>
                                                    {u.uses}/{u.maxUses} Uses
                                                </Text>)}
                                        </div>
                                    </div>
                                </div>
                                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => removeUser(index)}>
                                    Revoke
                                </Button>
                            </div>);
        })}
                </div>
                <Text variant="heading-md/bold" style={{ marginBottom: 15, marginTop: 25, color: "#FFFFFF", display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldIcon width={20} height={20}/> Action Logs
                </Text>
                <ScrollerThin style={{ maxHeight: 250, background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "12px 16px", border: "1px solid rgba(255,255,255,0.1)" }}>
                    {logs.length === 0 ? (<div style={{ padding: "20px 0", textAlign: "center" }}>
                            <Text style={{ color: "#FFFFFF", opacity: 0.4, fontStyle: "italic" }}>No actions logged yet.</Text>
                        </div>) : logs.map((log, i) => {
            const user = UserStore.getUser(log.userId);
            const isSuccess = log.success;
            return (<div key={i} style={{
                    marginBottom: 10,
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 8,
                    borderLeft: `4px solid ${isSuccess ? "#43b581" : "#f04747"}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4
                }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <Avatar src={IconUtils.getUserAvatarURL(user || { id: log.userId, avatar: null })} size={"SIZE_20"}/>
                                        <Text variant="text-sm/bold" style={{ color: "#FFFFFF" }}>
                                            {user?.globalName || user?.username || log.userId}
                                        </Text>
                                        <Text variant="text-xs/normal" style={{ color: "rgba(255,255,255,0.6)" }}>
                                            executed
                                        </Text>
                                        <div style={{
                    padding: "2px 6px",
                    background: "rgba(255,255,255,0.1)",
                    borderRadius: 4,
                    fontSize: "10px",
                    fontWeight: "800",
                    color: "#fff",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px"
                }}>
                                            {log.command}
                                        </div>
                                    </div>
                                    <Text variant="text-xxs/medium" style={{ color: "rgba(255,255,255,0.4)" }}>
                                        {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                    </Text>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 28 }}>
                                    <Text variant="text-xs/medium" style={{ color: "rgba(255,255,255,0.7)" }}>
                                        Target:
                                    </Text>
                                    <Text variant="text-xs/semibold" style={{ color: "#FFFFFF" }}>
                                        {log.targetId.startsWith("<@") ? log.targetId : (UserStore.getUser(log.targetId)?.username || log.targetId)}
                                    </Text>
                                    <div style={{
                    marginLeft: "auto",
                    fontSize: "9px",
                    fontWeight: "700",
                    color: isSuccess ? "#43b581" : "#f04747",
                    padding: "1px 6px",
                    borderRadius: 10,
                    border: `1px solid ${isSuccess ? "#43b581" : "#f04747"}`,
                    textTransform: "uppercase"
                }}>
                                        {isSuccess ? "Success" : "Failed"}
                                    </div>
                                </div>
                            </div>);
        })}
                </ScrollerThin>
            </ModalContent>
        </ModalRoot>);
}
function resolveId(arg) {
    if (!arg)
        return "";
    // Match <@123>, <@!123>, or just 123
    const match = arg.match(/<@!?(\d+)>/);
    return match ? match[1] : arg;
}
export default definePlugin({
    name: "SharePerms",
    description: "Multi-user permission sharing with interactive UI.",
    tags: ["Roles", "Utility", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["HeaderBarAPI"],
    settings,
    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", this.onMessage);
        // Adding the button to the header bar (HeaderBar)
        addHeaderBarButton("shareperms-manager", () => <SharePermsButton />, 6);
    },
    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.onMessage);
        removeHeaderBarButton("shareperms-manager");
    },
    onMessage: async ({ message }) => {
        if (!message || !message.content)
            return;
        const users = getSharedUsers();
        const configIndex = users.findIndex(u => u.id === message.author.id);
        if (configIndex === -1)
            return;
        const config = users[configIndex];
        const duration = parseDuration(config.validUntil);
        if (duration !== 0 && Date.now() > config.startTime + duration)
            return;
        // Restriction check: Commands only in DM OR in the specified server's channels
        const channel = ChannelStore.getChannel(message.channel_id);
        const isDM = channel?.type === 1; // Type 1 = DM
        const isTargetGuild = channel?.guild_id === config.guildId;
        if (!isDM && !isTargetGuild)
            return;
        const { prefix } = config;
        if (!message.content.startsWith(prefix))
            return;
        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();
        if (!command)
            return;
        // Check command-specific quota
        if (config.maxUses > 0) {
            const currentUses = config.usesMap?.[command] || 0;
            if (currentUses >= config.maxUses) {
                sendBotMessage(message.channel_id, { content: `❌ Error: You have reached your limit of ${config.maxUses} uses for the \`${command}\` command.` });
                return;
            }
        }
        const { guildId } = config;
        const permsList = config.permissions.split(",");
        const hasAll = permsList.includes("all");
        const channelId = message.channel_id;
        let success = false;
        let targetId = "";
        try {
            if (command === "tempmute" || command === "timeout") {
                if (!hasAll && !permsList.includes("timeout"))
                    return;
                targetId = resolveId(args[0]);
                const durationStr = args[1] || "10m";
                const d = parseDuration(durationStr);
                const until = new Date(Date.now() + d).toISOString();
                await RestAPI.patch({
                    url: `/guilds/${guildId}/members/${targetId}`,
                    body: { communication_disabled_until: until }
                });
                sendBotMessage(channelId, { content: `✅ User <@${targetId}> timed out until ${new Date(until).toLocaleString()} (API).` });
                success = true;
            }
            else if (command === "kick") {
                if (!hasAll && !permsList.includes("kick"))
                    return;
                targetId = resolveId(args[0]);
                await RestAPI.del({
                    url: `/guilds/${guildId}/members/${targetId}`,
                    reason: args.slice(1).join(" ") || "."
                });
                sendBotMessage(channelId, { content: `✅ User <@${targetId}> kicked (API).` });
                success = true;
            }
            else if (command === "ban") {
                if (!hasAll && !permsList.includes("ban"))
                    return;
                targetId = resolveId(args[0]);
                const reason = args.slice(1).join(" ") || ".";
                await RestAPI.put({
                    url: `/guilds/${guildId}/bans/${targetId}`,
                    body: { delete_message_seconds: 0, reason }
                });
                sendBotMessage(channelId, { content: `✅ User <@${targetId}> banned (API).` });
                success = true;
            }
            else if (command === "unmute") {
                if (!hasAll && !permsList.includes("mute_voice"))
                    return;
                targetId = resolveId(args[0]);
                await VoiceActions.setServerMute(guildId, targetId, false);
                sendBotMessage(channelId, { content: `✅ User <@${targetId}> server unmuted.` });
                success = true;
            }
            else if (command === "untimeout") {
                if (!hasAll && !permsList.includes("timeout"))
                    return;
                targetId = resolveId(args[0]);
                await RestAPI.patch({
                    url: `/guilds/${guildId}/members/${targetId}`,
                    body: { communication_disabled_until: null }
                });
                sendBotMessage(channelId, { content: `✅ User <@${targetId}> timeout removed.` });
                success = true;
            }
            else if (command === "unban") {
                if (!hasAll && !permsList.includes("ban"))
                    return;
                targetId = resolveId(args[0]);
                await RestAPI.del({
                    url: `/guilds/${guildId}/bans/${targetId}`
                });
                sendBotMessage(channelId, { content: `✅ User <@${targetId}> unbanned.` });
                success = true;
            }
            else if (command === "rename") {
                if (!hasAll && !permsList.includes("rename_user"))
                    return;
                targetId = resolveId(args[0]);
                const newName = args.slice(1).join(" ");
                try {
                    await RestAPI.patch({
                        url: `/guilds/${guildId}/members/${targetId}`,
                        body: { nick: newName }
                    });
                    sendBotMessage(channelId, { content: `✅ User <@${targetId}> renamed to ${newName} via API.` });
                    success = true;
                }
                catch (apiErr) {
                    console.error("Rename API Error:", apiErr);
                    // Fallback to internal action if API fails
                    await GuildMemberActions.setNickname(guildId, targetId, newName, "SharePerms: Remote Rename");
                    sendBotMessage(channelId, { content: `✅ User <@${targetId}> renamed to ${newName}.` });
                    success = true;
                }
            }
            else if (command === "addrole") {
                if (!hasAll && !permsList.includes("add_role"))
                    return;
                targetId = resolveId(args[0]);
                const roleId = resolveId(args[1]);
                const member = MemberStore.getMember(guildId, targetId);
                const roles = new Set([...(member?.roles || []), roleId]);
                await MemberRoleActions.updateMemberRoles(guildId, targetId, Array.from(roles));
                sendBotMessage(channelId, { content: `✅ Role <@&${roleId}> added to <@${targetId}>.` });
                success = true;
            }
            else if (command === "mute") {
                if (!hasAll && !permsList.includes("mute_voice"))
                    return;
                targetId = resolveId(args[0]);
                await VoiceActions.setServerMute(guildId, targetId, true);
                sendBotMessage(channelId, { content: `✅ User <@${targetId}> server muted.` });
                success = true;
            }
            else if (command === "disconnect") {
                if (!hasAll && !permsList.includes("disconnect_voice"))
                    return;
                targetId = resolveId(args[0]);
                await VoiceActions.setChannel(guildId, targetId, null);
                sendBotMessage(channelId, { content: `✅ User <@${targetId}> disconnected from voice.` });
                success = true;
            }
            else if (command === "move") {
                if (!hasAll && !permsList.includes("move_voice"))
                    return;
                targetId = resolveId(args[0]);
                // Get author's current voice channel
                const authorVoiceState = VoiceStateStore.getVoiceState(guildId, message.author.id);
                const destChannelId = authorVoiceState?.channelId;
                if (!destChannelId) {
                    sendBotMessage(channelId, { content: "❌ Error: You must be in a voice channel to move someone." });
                    return;
                }
                await VoiceActions.setChannel(guildId, targetId, destChannelId);
                sendBotMessage(channelId, { content: `✅ User <@${targetId}> moved to your channel <#${destChannelId}>.` });
                success = true;
            }
            if (success) {
                if (!config.usesMap)
                    config.usesMap = {};
                config.usesMap[command] = (config.usesMap[command] || 0) + 1;
                config.uses++; // Still increment global for UI reference
                users[configIndex] = config;
                saveSharedUsers(users);
                saveLog({
                    userId: message.author.id,
                    command,
                    targetId,
                    timestamp: Date.now(),
                    success: true
                });
            }
        }
        catch (e) {
            console.error("SharePerms Command Error:", e);
            const errorMsg = e.body?.message || e.message || JSON.stringify(e);
            sendBotMessage(channelId, { content: `❌ Error: ${errorMsg}` });
            saveLog({
                userId: message.author.id,
                command: command || "unknown",
                targetId: targetId || "unknown",
                timestamp: Date.now(),
                success: false
            });
        }
    },
    headerBarButtons: []
});
