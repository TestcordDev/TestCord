/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { classes } from "@utils/misc";
import { closeModal, ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { Avatar, Button, ChannelStore, GuildMemberStore, Menu, PermissionsBits, PermissionStore, React, RestAPI, Text, Toasts, UserStore, VoiceStateStore } from "@webpack/common";
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '"top"===c');
function Icon({ height = 24, width = 24, className, children, viewBox, ...svgProps }) {
    return (<svg className={classes(className, "vc-icon")} role="img" width={width} height={height} viewBox={viewBox} {...svgProps}>
            {children}
        </svg>);
}
function DisconnectIcon(props) {
    return (<Icon {...props} viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </Icon>);
}
function MuteIcon(props) {
    return (<Icon {...props} viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-12c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
        </Icon>);
}
function DeafenIcon(props) {
    return (<Icon {...props} viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
        </Icon>);
}
let _userActionsCache = null;
let _userActionsRaw = null;
function getParsedUserActions() {
    const raw = settings.store.userActions || "{}";
    if (raw === _userActionsRaw && _userActionsCache)
        return _userActionsCache;
    try {
        _userActionsCache = JSON.parse(raw);
    }
    catch {
        _userActionsCache = {};
    }
    _userActionsRaw = raw;
    return _userActionsCache;
}
function invalidateUserActionsCache() {
    _userActionsCache = null;
    _userActionsRaw = null;
}
export const settings = definePluginSettings({
    userActions: {
        type: 0 /* OptionType.STRING */,
        description: "JSON object mapping user IDs to their actions (disconnect, mute, deafen)",
        restartNeeded: false,
        hidden: true,
        default: "{}",
    },
});
const Auth = findByPropsLazy("getToken");
// Global state to track the modal
let currentModalKey = null;
function getUserActions(userId) {
    const actions = getParsedUserActions();
    return actions[userId] || { disconnect: false, mute: false, deafen: false };
}
function getAllUserActions() {
    return getParsedUserActions();
}
function setUserActions(userId, actions) {
    const allActions = getParsedUserActions();
    if (actions.disconnect || actions.mute || actions.deafen) {
        allActions[userId] = actions;
    }
    else {
        delete allActions[userId];
    }
    settings.store.userActions = JSON.stringify(allActions);
    invalidateUserActionsCache();
}
async function disconnectGuildMember(guildId, userId) {
    const token = Auth?.getToken?.();
    if (!token)
        return false;
    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { channel_id: null }
        });
        return response.ok !== false;
    }
    catch {
        return false;
    }
}
async function muteGuildMember(guildId, userId, mute) {
    const token = Auth?.getToken?.();
    if (!token)
        return false;
    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { mute }
        });
        return response.ok !== false;
    }
    catch {
        return false;
    }
}
async function deafenGuildMember(guildId, userId, deaf) {
    const token = Auth?.getToken?.();
    if (!token)
        return false;
    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { deaf }
        });
        return response.ok !== false;
    }
    catch {
        return false;
    }
}
function getGuildIdFromChannel(channelId) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel)
        return undefined;
    return channel.guild_id ?? channel.guildId ?? undefined;
}
function getActiveUsers() {
    const allActions = getParsedUserActions();
    const out = [];
    for (const [userId, actions] of Object.entries(allActions)) {
        const a = actions;
        if (a && (a.disconnect || a.mute || a.deafen)) {
            out.push({ userId, actions: a });
        }
    }
    return out;
}
function disableUserTools(userId, currentGuildId) {
    const actions = getUserActions(userId);
    // Find guildId from voice state if not provided
    let guildId = currentGuildId;
    if (!guildId) {
        const voiceState = VoiceStateStore.getVoiceStateForUser(userId);
        if (voiceState?.channelId) {
            guildId = getGuildIdFromChannel(voiceState.channelId);
        }
    }
    // Reverse any active actions before disabling
    if (guildId) {
        if (actions.mute) {
            void muteGuildMember(guildId, userId, false);
        }
        if (actions.deafen) {
            void deafenGuildMember(guildId, userId, false);
        }
    }
    // Disable all actions
    setUserActions(userId, { disconnect: false, mute: false, deafen: false });
    const user = UserStore.getUser(userId);
    const userName = user ? (user.globalName || user.username) : userId;
    Toasts.show({
        message: `UserTools disabled for ${userName}`,
        id: Toasts.genId(),
        type: Toasts.Type.SUCCESS
    });
}
function ActiveUsersSubMenu({ guildId }) {
    const activeUsers = getActiveUsers();
    if (activeUsers.length === 0) {
        return (<Menu.MenuItem id="user-tools-no-active" label="No active users" disabled={true}/>);
    }
    return (<>
            {activeUsers.map(({ userId, actions }) => {
            const user = UserStore.getUser(userId);
            if (!user)
                return null;
            const displayName = guildId
                ? (GuildMemberStore.getNick(guildId, userId) || user.globalName || user.username)
                : (user.globalName || user.username);
            const actionLabels = [];
            if (actions.disconnect)
                actionLabels.push("Disconnect");
            if (actions.mute)
                actionLabels.push("Mute");
            if (actions.deafen)
                actionLabels.push("Deafen");
            return (<Menu.MenuItem key={`active-user-${userId}`} id={`user-tools-active-${userId}`} label={<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <Avatar src={user.getAvatarURL(guildId || null, 20, false)} size="SIZE_20"/>
                                <span>{displayName}</span>
                                {actionLabels.length > 0 && (<span style={{
                            fontSize: "11px",
                            color: "var(--text-muted)",
                            marginLeft: "4px"
                        }}>
                                        ({actionLabels.join(", ")})
                                    </span>)}
                            </div>} action={() => {
                    disableUserTools(userId, guildId);
                }}/>);
        })}
        </>);
}
function ActiveUsersModal({ modalProps }) {
    const activeUsers = getActiveUsers();
    return (<ModalRoot {...modalProps} size={"medium" /* ModalSize.MEDIUM */}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" tag="h1">Active Users</Text>
                <ModalCloseButton onClick={modalProps.onClose}/>
            </ModalHeader>
            <ModalContent>
                {activeUsers.length === 0 ? (<div style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100px",
                color: "var(--text-muted)"
            }}>
                        No active users
                    </div>) : (<div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                        {activeUsers.map(({ userId, actions }) => {
                const user = UserStore.getUser(userId);
                if (!user)
                    return null;
                const displayName = user.globalName || user.username;
                const actionLabels = [];
                if (actions.disconnect)
                    actionLabels.push("Disconnect");
                if (actions.mute)
                    actionLabels.push("Mute");
                if (actions.deafen)
                    actionLabels.push("Deafen");
                return (<div key={userId} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px",
                        borderRadius: "4px",
                        backgroundColor: "var(--background-secondary)",
                    }}>
                                    <Avatar src={user.getAvatarURL(null, 40, false)} size="SIZE_40"/>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 500 }}>
                                            {displayName}
                                        </div>
                                        {actionLabels.length > 0 && (<div style={{
                            fontSize: "12px",
                            color: "var(--text-muted)"
                        }}>
                                                {actionLabels.join(", ")}
                                            </div>)}
                                    </div>
                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => {
                        disableUserTools(userId);
                    }}>
                                        Disable
                                    </Button>
                                </div>);
            })}
                    </div>)}
            </ModalContent>
        </ModalRoot>);
}
async function openUserToolsModal() {
    // If modal is already open, close it first
    if (currentModalKey) {
        closeModal(currentModalKey);
        currentModalKey = null;
    }
    // If desktop, open in separate window instead of modal
    if (IS_DISCORD_DESKTOP) {
        try {
            const { ipcRenderer } = await import("electron");
            await ipcRenderer.invoke("OPEN_USER_TOOLS_WINDOW");
            return; // Don't open modal in main window
        }
        catch (e) {
            console.error("Failed to open user tools window:", e);
            // Fall through to open modal as fallback
        }
    }
    // Open new modal (web or fallback)
    currentModalKey = openModal((props) => (<ActiveUsersModal modalProps={{
            ...props,
            onClose: () => {
                currentModalKey = null;
                props.onClose();
            }
        }}/>));
}
const UserContext = (children, { user, guildId }) => {
    if (!user || user.id === UserStore.getCurrentUser().id)
        return;
    if (!guildId)
        return; // Only work in guilds
    const allActions = getAllUserActions();
    const actions = allActions[user.id] ?? { disconnect: false, mute: false, deafen: false };
    const hasActiveUsers = Object.values(allActions).some(actions => actions.disconnect || actions.mute || actions.deafen);
    children.splice(-1, 0, (<Menu.MenuGroup key="user-tools-group">
            <Menu.MenuItem id="user-tools-header" label="UserTools" disabled={true}/>
            <Menu.MenuCheckboxItem id="user-tools-disconnect" label="Disconnect" checked={actions.disconnect} action={() => {
            const newActions = { ...actions, disconnect: !actions.disconnect };
            setUserActions(user.id, newActions);
            if (newActions.disconnect) {
                const channel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                if (channel) {
                    const gId = getGuildIdFromChannel(channel);
                    if (gId)
                        void disconnectGuildMember(gId, user.id);
                }
            }
        }}/>
            <Menu.MenuCheckboxItem id="user-tools-mute" label="Server Mute" checked={actions.mute} action={() => {
            const newActions = { ...actions, mute: !actions.mute };
            setUserActions(user.id, newActions);
            if (newActions.mute) {
                const channel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                if (channel) {
                    const gId = getGuildIdFromChannel(channel);
                    if (gId)
                        void muteGuildMember(gId, user.id, true);
                }
            }
            else if (guildId) {
                void muteGuildMember(guildId, user.id, false);
            }
        }}/>
            <Menu.MenuCheckboxItem id="user-tools-deafen" label="Server Deafen" checked={actions.deafen} action={() => {
            const newActions = { ...actions, deafen: !actions.deafen };
            setUserActions(user.id, newActions);
            if (newActions.deafen) {
                const channel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                if (channel) {
                    const gId = getGuildIdFromChannel(channel);
                    if (gId)
                        void deafenGuildMember(gId, user.id, true);
                }
            }
            else if (guildId) {
                void deafenGuildMember(guildId, user.id, false);
            }
        }}/>
            {hasActiveUsers && (<Menu.MenuItem id="user-tools-active-users" label="Active Users" renderSubmenu={() => (<Menu.Menu navId="user-tools-active-users-menu" onClose={() => { }}>
                            <ActiveUsersSubMenu guildId={guildId}/>
                        </Menu.Menu>)}/>)}
        </Menu.MenuGroup>));
};
const handleOpenUserTools = () => {
    openUserToolsModal();
};
export default definePlugin({
    name: "UserTools",
    description: "Adds context menu options to continuously disconnect, mute, or deafen users in guilds",
    tags: ["Utility", "Customisation"],
    authors: [TestcordDevs.x2b],
    settings,
    patches: [
        {
            find: "toolbar:function",
            replacement: {
                match: /(function\s+[A-Za-z_$][\w$]*\(\i\)\{)([\s\S]{1,600}?toolbar[\s\S]{1,300}?mobileToolbar)/,
                replace: "$1$self.addIconToToolBar(arguments[0]);$2",
                noWarn: true
            }
        },
    ],
    contextMenus: {
        "user-context": UserContext
    },
    start() {
        // Listen for custom event from separate window
        window.addEventListener("vencord:openUserTools", handleOpenUserTools);
    },
    stop() {
        window.removeEventListener("vencord:openUserTools", handleOpenUserTools);
    },
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            try {
                const allActions = getParsedUserActions();
                for (const { userId, channelId, oldChannelId } of voiceStates) {
                    const actions = allActions[userId];
                    if (!actions || (!actions.disconnect && !actions.mute && !actions.deafen))
                        continue;
                    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
                    if (!channel)
                        continue;
                    const guildId = getGuildIdFromChannel(channelId);
                    if (!guildId)
                        continue;
                    // Check permissions
                    const canMove = PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel);
                    const canMute = PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel);
                    const canDeafen = PermissionStore.can(PermissionsBits.DEAFEN_MEMBERS, channel);
                    if (actions.disconnect && channelId && canMove) {
                        // User joined a voice channel, disconnect them
                        void disconnectGuildMember(guildId, userId);
                    }
                    // Continuously apply mute/deafen
                    const voiceState = VoiceStateStore.getVoiceStateForUser(userId);
                    if (voiceState) {
                        if (actions.mute && canMute && !voiceState.mute) {
                            void muteGuildMember(guildId, userId, true);
                        }
                        if (actions.deafen && canDeafen && !voiceState.deaf) {
                            void deafenGuildMember(guildId, userId, true);
                        }
                    }
                }
            }
            catch (e) {
                console.error("UserTools: Error in VOICE_STATE_UPDATES:", e);
            }
        },
    },
    UserToolsIndicator() {
        try {
            const allActions = getParsedUserActions();
            const activeUsers = Object.keys(allActions).filter(userId => {
                const actions = allActions[userId];
                return actions && (actions.disconnect || actions.mute || actions.deafen);
            });
            if (activeUsers.length === 0)
                return null;
            const firstUser = UserStore.getUser(activeUsers[0]);
            const tooltip = activeUsers.length === 1
                ? `UserTools: ${firstUser?.username ?? activeUsers[0]} (right-click to disable)`
                : `UserTools: ${activeUsers.length} active users (right-click to disable)`;
            return (<HeaderBarIcon tooltip={tooltip} icon={DisconnectIcon} className="vc-plugin-icon-button" iconClassName="vc-plugin-icon-button" onClick={() => openUserToolsModal()} onContextMenu={e => {
                    e.preventDefault();
                    settings.store.userActions = "{}";
                    invalidateUserActionsCache();
                    Toasts.show({
                        message: "All UserTools actions disabled",
                        id: Toasts.genId(),
                        type: Toasts.Type.SUCCESS
                    });
                }}/>);
        }
        catch {
            return null;
        }
    },
    addIconToToolBar(e) {
        const icon = (<ErrorBoundary noop={true} key="user-tools-indicator">
                <this.UserToolsIndicator />
            </ErrorBoundary>);
        if (Array.isArray(e.toolbar)) {
            e.toolbar.push(icon);
        }
        else {
            e.toolbar = [icon, e.toolbar];
        }
    },
});
