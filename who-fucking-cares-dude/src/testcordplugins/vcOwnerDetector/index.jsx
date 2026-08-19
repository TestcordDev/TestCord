/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { getCurrentGuild } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Button, ChannelStore, FluxDispatcher, Forms, Menu, React, TextInput, Toasts, UserStore } from "@webpack/common";
const logger = new Logger("vcOwnerDetector");
const Flex = ({ children, style, ...props }) => (<div style={{ display: "flex", ...style }} {...props}>{children}</div>);
const vc = findStoreLazy("VoiceStateStore");
const voiceshit = findByPropsLazy("getVoiceChannelId");
const veryimportantmap = new Set();
let checkInterval = null;
let ownerCheckTimeout = null;
const settings = definePluginSettings({
    guildidetectionslol: {
        description: "Guild detection data",
        type: 0 /* OptionType.STRING */,
        default: "",
    },
    amivcowner: {
        description: "Am I the VC owner",
        type: 3 /* OptionType.BOOLEAN */,
        default: false,
    },
});
function checkvcownerlol(guildId, channelId) {
    if (!guildId || !channelId) {
        Toasts.show({
            message: "No guild or channel found!",
            id: `atticus-error-${Date.now()}`,
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM,
                duration: 2000
            }
        });
        return;
    }
    const guildDetectionSettings = isValidJson(settings.store.guildidetectionslol);
    const guildSetting = guildDetectionSettings.find(g => g.name === guildId);
    if (!guildSetting) {
        Toasts.show({
            message: "This guild is not configured for VC owner detection!",
            id: `atticus-not-configured-${Date.now()}`,
            type: Toasts.Type.MESSAGE,
            options: {
                position: Toasts.Position.BOTTOM,
                duration: 2000
            }
        });
        return;
    }
    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.permissionOverwrites) {
        Toasts.show({
            message: "No permission overwrites found in this channel!",
            id: `atticus-no-perms-${Date.now()}`,
            type: Toasts.Type.MESSAGE,
            options: {
                position: Toasts.Position.BOTTOM,
                duration: 2000
            }
        });
        return;
    }
    const permissions = Object.values(channel.permissionOverwrites);
    const currentUserId = UserStore.getCurrentUser().id;
    const permRequirement = guildSetting.permrequirements;
    let ownerFound = false;
    let ownerName = "";
    permissions.forEach((perm) => {
        const { id, allow } = perm;
        try {
            const allowBigInt = toBigIntSafe(allow);
            const reqBigInt = toBigIntSafe(permRequirement);
            if (allowBigInt === reqBigInt) {
                const user = UserStore.getUser(id);
                if (user) {
                    ownerFound = true;
                    // Try to get guild member info for server nickname
                    const guild = getCurrentGuild();
                    let memberInfo = null;
                    if (guild) {
                        try {
                            // Try to get guild member store
                            const GuildMemberStore = findStoreLazy("GuildMemberStore");
                            memberInfo = GuildMemberStore?.getMember(guild.id, id);
                        }
                        catch (e) {
                            logger.warn("Could not get guild member info");
                        }
                    }
                    // Priority: server nickname > global display name > username
                    ownerName = memberInfo?.nick || user.globalName || user.username || "Unknown User";
                    const cleanId = id.toString().replace(/[^0-9]/g, "");
                    veryimportantmap.add(cleanId);
                    if (id === currentUserId) {
                        settings.store.amivcowner = true;
                    }
                    Toasts.show({
                        message: `Current VC Owner: ${ownerName}`,
                        id: `atticus-owner-found-${Date.now()}`,
                        type: Toasts.Type.SUCCESS,
                        options: {
                            position: Toasts.Position.BOTTOM,
                            duration: 2000
                        }
                    });
                }
            }
        }
        catch (e) {
            logger.error("Permission conversion error:", e);
        }
    });
    if (!ownerFound) {
        Toasts.show({
            message: "No VC owner found with the configured permissions!",
            id: `atticus-no-owner-${Date.now()}`,
            type: Toasts.Type.MESSAGE,
            options: {
                position: Toasts.Position.BOTTOM,
                duration: 2000
            }
        });
    }
}
function toBigIntSafe(value) {
    if (typeof value === "bigint")
        return value;
    if (typeof value === "number")
        return BigInt(value);
    if (typeof value === "string")
        return BigInt(value.replace(/n$/, "").trim());
    return BigInt(0);
}
function ChannelMenuItem(guildId, channelId) {
    return (<Menu.MenuItem id="Check-Owner" label="Check VC Owner" color="brand" action={() => {
            checkvcownerlol(guildId, channelId);
        }}/>);
}
function ChannelMakeContextMenuPatch() {
    return (children, props) => {
        if (!props?.guild?.id || !props?.channel?.id)
            return;
        const group = findGroupChildrenByChildId(["mark-channel-read"], children);
        if (!group)
            return;
        const vcownercheck = ChannelMenuItem(props.guild.id, props.channel.id);
        group.push(vcownercheck);
    };
}
function Kbind(e) {
    if (e.altKey && e.key.toLowerCase() === "v") {
        openModal((modalProps) => <EncModals modalProps={modalProps}/>);
    }
}
let clientOldChannelId;
export default definePlugin({
    name: "vcOwnerDetector",
    description: "Tools to detect the owner of VC",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.dot],
    settings,
    contextMenus: {
        "channel-context": ChannelMakeContextMenuPatch(),
    },
    start() {
        try {
            FluxDispatcher.subscribe("VOICE_STATE_UPDATES", this.handleVoiceStateUpdate);
            document.addEventListener("keydown", Kbind);
            this.initializePlugin();
        }
        catch (e) {
            logger.error("Plugin start error:", e);
        }
    },
    stop() {
        try {
            FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", this.handleVoiceStateUpdate);
            document.removeEventListener("keydown", Kbind);
            if (checkInterval) {
                clearInterval(checkInterval);
                checkInterval = null;
            }
            if (ownerCheckTimeout) {
                clearTimeout(ownerCheckTimeout);
                ownerCheckTimeout = null;
            }
        }
        catch (e) {
            logger.error("Plugin stop error:", e);
        }
    },
    handleVoiceStateUpdate({ voiceStates }) {
        const clientUserId = UserStore.getCurrentUser().id;
        voiceStates.forEach(state => {
            const { userId, channelId, guildId } = state;
            let { oldChannelId } = state;
            if (userId === clientUserId && channelId !== clientOldChannelId) {
                oldChannelId = clientOldChannelId;
                clientOldChannelId = channelId;
                // User joined a new VC or switched channels - trigger owner check notification
                if (channelId && oldChannelId !== channelId) {
                    if (ownerCheckTimeout)
                        clearTimeout(ownerCheckTimeout);
                    ownerCheckTimeout = setTimeout(() => {
                        ownerCheckTimeout = null;
                        checkvcownerlol(guildId, channelId);
                    }, 1000); // Small delay to ensure everything is loaded
                }
            }
            if (oldChannelId === channelId)
                return;
            if (veryimportantmap.has(userId)) {
                veryimportantmap.delete(userId);
            }
            if ((oldChannelId && !channelId) && (userId === clientUserId)) {
                if (settings.store.amivcowner) {
                    logger.info("You (owner) left VC");
                    settings.store.amivcowner = false;
                }
            }
        });
    },
    initializePlugin() {
        settings.store.amivcowner = false;
        // Check VC ownership periodically (but don't show toasts)
        if (checkInterval)
            clearInterval(checkInterval);
        checkInterval = setInterval(() => {
            try {
                const guild = getCurrentGuild();
                if (!guild)
                    return;
                const voiceState = vc?.getVoiceStateForUser?.(UserStore.getCurrentUser().id);
                if (!voiceState?.channelId)
                    return;
                // Silent check - only update internal state, no toasts
                this.silentOwnerCheck(guild.id, voiceState.channelId);
            }
            catch (e) {
                logger.error("Periodic check error:", e);
            }
        }, 2000);
    },
    silentOwnerCheck(guildId, channelId) {
        if (!guildId || !channelId)
            return;
        const guildDetectionSettings = isValidJson(settings.store.guildidetectionslol);
        const guildSetting = guildDetectionSettings.find(g => g.name === guildId);
        if (guildSetting) {
            const channel = ChannelStore.getChannel(channelId);
            if (!channel?.permissionOverwrites)
                return;
            const permissions = Object.values(channel.permissionOverwrites);
            const currentUserId = UserStore.getCurrentUser().id;
            const permRequirement = guildSetting.permrequirements;
            permissions.forEach((perm) => {
                const { id, allow } = perm;
                try {
                    const allowBigInt = toBigIntSafe(allow);
                    const reqBigInt = toBigIntSafe(permRequirement);
                    if (allowBigInt === reqBigInt) {
                        const cleanId = id.toString().replace(/[^0-9]/g, "");
                        veryimportantmap.add(cleanId);
                        if (id === currentUserId) {
                            settings.store.amivcowner = true;
                        }
                    }
                }
                catch (e) {
                    logger.error("Permission conversion error:", e);
                }
            });
        }
    },
    patches: [
        {
            find: ".usernameSpeaking",
            replacement: {
                match: /(className:)([^,}]+)(username[^,}]*)/,
                replace: "$1$self.addOwnerClass($2$3)"
            }
        }
    ],
    addOwnerClass(originalClass) {
        const currentUser = UserStore.getCurrentUser();
        if (!currentUser)
            return originalClass;
        const isOwner = veryimportantmap.has(currentUser.id);
        return isOwner ? `${originalClass} vc-owner-yellow` : originalClass;
    }
});
function isValidJson(data) {
    try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (e) {
        return [];
    }
}
function EncModals({ modalProps }) {
    const [guildidetectionslol, setguildidetectionslol] = React.useState(isValidJson(settings.store.guildidetectionslol));
    const [guildids, setguildids] = React.useState("");
    const [permrequirements, setpermrequirements] = React.useState("");
    const handleAddGuild = () => {
        if (!guildids.trim())
            return;
        const newGuild = {
            name: guildids.trim(),
            permrequirements: permrequirements.trim()
        };
        const newList = [...guildidetectionslol, newGuild];
        setguildidetectionslol(newList);
        settings.store.guildidetectionslol = JSON.stringify(newList);
        setguildids("");
        setpermrequirements("");
    };
    const handleUpdateGuild = (index, field, value) => {
        const updatedList = [...guildidetectionslol];
        updatedList[index][field] = value;
        setguildidetectionslol(updatedList);
        settings.store.guildidetectionslol = JSON.stringify(updatedList);
    };
    const handleRemoveGuild = (index) => {
        const filteredList = guildidetectionslol.filter((_, i) => i !== index);
        setguildidetectionslol(filteredList);
        settings.store.guildidetectionslol = JSON.stringify(filteredList);
    };
    return (<ModalRoot {...modalProps} size={"large" /* ModalSize.LARGE */}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">VC Owner Detection Settings</Forms.FormTitle>
            </ModalHeader>

            <ModalContent>
                <Flex style={{ gap: "10px", marginBottom: "20px", flexDirection: "column" }}>
                    <Forms.FormTitle tag="h5">Add New Guild</Forms.FormTitle>
                    <Flex style={{ gap: "10px", flexDirection: "row" }}>
                        <TextInput value={guildids} placeholder="Guild ID" onChange={setguildids}/>
                        <TextInput value={permrequirements} placeholder="Permission Requirements" onChange={setpermrequirements}/>
                        <Button onClick={handleAddGuild}>
                            Add Guild
                        </Button>
                    </Flex>
                </Flex>

                {guildidetectionslol.length > 0 && (<Flex style={{ flexDirection: "column" }}>
                        <Forms.FormTitle tag="h5">Current Guilds</Forms.FormTitle>
                        {guildidetectionslol.map((guild, index) => (<Flex key={index} style={{ gap: "10px", flexDirection: "row", marginBottom: "10px", alignItems: "center" }}>
                                <TextInput value={guild.name} placeholder="Guild ID" onChange={(value) => handleUpdateGuild(index, "name", value)}/>
                                <TextInput value={guild.permrequirements} placeholder="Permission Requirements" onChange={(value) => handleUpdateGuild(index, "permrequirements", value)}/>
                                <Button color={Button.Colors.RED} onClick={() => handleRemoveGuild(index)}>
                                    Remove
                                </Button>
                            </Flex>))}
                    </Flex>)}
            </ModalContent>

            <ModalFooter>
                <Button color={Button.Colors.GREEN} onClick={modalProps.onClose}>
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>);
}
