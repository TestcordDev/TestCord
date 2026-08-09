/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize,openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { Button, ChannelStore, FluxDispatcher, Forms, GuildMemberStore,GuildStore, Menu, React, RestAPI, TextInput, Toasts, UserStore } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
let isCurrentlyVcOwner = false;
let currentVcChannel: string | null = null;
let currentVcGuild: string | null = null;
let pluginActive = false;
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

function scheduleTimeout(callback: () => void, ms: number) {
    const timeout = setTimeout(() => {
        pendingTimeouts.delete(timeout);
        if (pluginActive) callback();
    }, ms);
    pendingTimeouts.add(timeout);
}

const settings = definePluginSettings({
    users: {
        type: OptionType.STRING,
        description: "User list separated by /",
        default: "",
    },
    store: {
        type: OptionType.STRING,
        description: "Reasons storage",
        default: "",
    },
    autoBanDelay: {
        type: OptionType.NUMBER,
        description: "Delay before auto-banning (seconds)",
        default: 2,
    },
    showVcOwnerStatus: {
        type: OptionType.BOOLEAN,
        description: "Show VC owner status notifications",
        default: true,
    },
    enableBulkAutoban: {
        type: OptionType.BOOLEAN,
        description: "Enable Bulk Autoban options in context menu",
        default: true,
    },
});

function toBigIntSafe(value: any): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    if (typeof value === "string") return BigInt(value.replace(/n$/, "").trim());
    return BigInt(0);
}

function isValidJson(data: string): any[] {
    try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

// Core VC owner detection - simplified but comprehensive
function isVoiceChannelOwner(guildId: string, channelId: string): boolean {
    if (!guildId || !channelId) return false;

    const currentUserId = UserStore.getCurrentUser().id;

    try {
        // Method 1: Check vcOwnerDetector plugin flag
        const vcOwnerPlugin = Vencord?.Plugins?.plugins?.vcOwnerDetector;
        if (vcOwnerPlugin?.settings?.store?.amivcowner) {
            return true;
        }

        const channel = ChannelStore.getChannel(channelId);
        if (!channel) return false;

        // Method 2: Check permission overwrites for VC owner permissions
        if (channel.permissionOverwrites) {
            const permissions = Object.values(channel.permissionOverwrites);
            const vcOwnerPerms = [0x10n, 0x10000000n, 0x400000n, 0x800000n, 0x1000000n];

            for (const perm of permissions) {
                const { id, allow } = perm;
                if (id === currentUserId) {
                    const allowBigInt = toBigIntSafe(allow);
                    for (const requiredPerm of vcOwnerPerms) {
                        if ((allowBigInt & requiredPerm) === requiredPerm) {
                            return true;
                        }
                    }
                }
            }
        }

        // Method 3: Check vcOwnerDetector guild settings
        if (vcOwnerPlugin?.settings?.store?.guildidetectionslol) {
            const guildSettings = isValidJson(vcOwnerPlugin.settings.store.guildidetectionslol);
            const guildSetting = guildSettings.find(g => g.name === guildId);

            if (guildSetting?.permrequirements && channel.permissionOverwrites) {
                const permissions = Object.values(channel.permissionOverwrites);
                for (const perm of permissions) {
                    const { id, allow } = perm;
                    if (id === currentUserId) {
                        const allowBigInt = toBigIntSafe(allow);
                        const reqBigInt = toBigIntSafe(guildSetting.permrequirements);
                        if (allowBigInt === reqBigInt) {
                            return true;
                        }
                    }
                }
            }
        }

        // Method 4: Check if guild owner or admin
        const guild = GuildStore.getGuild(guildId);
        if (guild?.ownerId === currentUserId) return true;

        const member = GuildMemberStore.getMember(guildId, currentUserId);
        if (member?.roles) {
            for (const roleId of member.roles) {
                const role = (guild as any)?.roles?.[roleId];
                if (role?.permissions) {
                    const rolePerms = toBigIntSafe(role.permissions);
                    if ((rolePerms & 0x8n) === 0x8n) return true;
                }
            }
        }

        return false;
    } catch (e) {
        console.error("VC owner check error:", e);
        return false;
    }
}

function forceCheckVcOwnership(guildId?: string, channelId?: string): boolean {
    const currentUserId = UserStore.getCurrentUser().id;

    if (!guildId || !channelId) {
        const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
        if (currentVoiceState?.channelId) {
            channelId = currentVoiceState.channelId;
            const channel = ChannelStore.getChannel(channelId!);
            guildId = channel?.guild_id;
        }
    }

    if (!guildId || !channelId) return false;

    const isOwner = isVoiceChannelOwner(guildId, channelId);

    isCurrentlyVcOwner = isOwner;
    currentVcChannel = channelId;
    currentVcGuild = guildId;

    return isOwner;
}

function checkVcOwnershipStatus() {
    const currentUserId = UserStore.getCurrentUser().id;
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);

    if (!currentVoiceState?.channelId) {
        if (isCurrentlyVcOwner || currentVcChannel || currentVcGuild) {
            isCurrentlyVcOwner = false;
            currentVcChannel = null;
            currentVcGuild = null;
        }
        return;
    }

    const channel = ChannelStore.getChannel(currentVoiceState.channelId);
    if (!channel?.guild_id) return;

    const wasOwner = isCurrentlyVcOwner;
    const actuallyIsOwner = forceCheckVcOwnership(channel.guild_id, currentVoiceState.channelId);

    if (settings.store.showVcOwnerStatus && wasOwner !== actuallyIsOwner) {
        if (actuallyIsOwner) {
            Toasts.show({
                message: "🟢 You are now the VC owner",
                type: Toasts.Type.SUCCESS,
                options: { position: Toasts.Position.BOTTOM, duration: 3000 }
            });
        } else {
            Toasts.show({
                message: "🔴 Not the VC owner",
                type: Toasts.Type.MESSAGE,
                options: { position: Toasts.Position.BOTTOM, duration: 3000 }
            });
        }
    }
}

function getAllUsersInVc(channelId: string): string[] {
    const currentUserId = UserStore.getCurrentUser().id;
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    return Object.keys(voiceStates).filter(userId => userId !== currentUserId);
}

function getAllUsersInCurrentVc(): string[] {
    const currentUserId = UserStore.getCurrentUser().id;
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);

    if (!currentVoiceState?.channelId) return [];

    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(currentVoiceState.channelId) ?? {};
    return Object.keys(voiceStates).filter(userId => userId !== currentUserId);
}

function banAllUsersInCurrentVc(): void {
    const usersInVc = getAllUsersInCurrentVc();
    if (usersInVc.length === 0) {
        Toasts.show({
            message: "No other users in current VC",
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    const currentBannedUsers = settings.store.users.split("/").filter(item => item !== "");
    const newUsers = usersInVc.filter(userId => !currentBannedUsers.includes(userId));

    if (newUsers.length === 0) {
        Toasts.show({
            message: "All users in VC are already on auto-ban list",
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    const allBannedUsers = [...currentBannedUsers, ...newUsers];
    settings.store.users = allBannedUsers.join("/");

    Toasts.show({
        message: `Added ${newUsers.length} users to auto-ban list`,
        type: Toasts.Type.SUCCESS,
        options: { position: Toasts.Position.BOTTOM }
    });

    const currentUserId = UserStore.getCurrentUser().id;
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    if (currentVoiceState?.channelId) {
        const channel = ChannelStore.getChannel(currentVoiceState.channelId);
        if (channel?.guild_id && forceCheckVcOwnership(channel.guild_id, currentVoiceState.channelId)) {
            newUsers.forEach((userId, index) => {
                scheduleTimeout(() => banninguser(userId), (index + 1) * Math.random() * 1000);
            });
        }
    }
}

function makeUserContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props) => {
        if (!props) return;
        const { id } = props.user;
        if (UserStore.getCurrentUser().id === id) return;

        const isChecked = settings.store.users.split("/").filter(item => item !== "").includes(id);
        children.splice(-1, 0,
            <Menu.MenuGroup>
                <Menu.MenuCheckboxItem
                    id="auto-ban"
                    label="Auto-Ban"
                    checked={isChecked}
                    action={async () => {
                        openModal(props => <EncModals {...props} userId={id} />);
                        const updatedList = [...settings.store.users.split("/").filter(item => item !== "")];
                        const index = updatedList.indexOf(id);
                        const wasAdded = index === -1;

                        if (index === -1) updatedList.push(id);
                        else updatedList.splice(index, 1);
                        settings.store.users = updatedList.join("/");

                        if (wasAdded) {
                            banninguser(id);
                        } else {
                            Toasts.show({
                                message: `Removed ${id} from Auto-Ban List`,
                                type: Toasts.Type.MESSAGE,
                                options: { position: Toasts.Position.BOTTOM }
                            });
                        }
                    }}
                />
            </Menu.MenuGroup>
        );
    };
}

function makeChannelContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props) => {
        if (!props || !props.channel || props.channel.type !== 2) return;

        if (settings.store.enableBulkAutoban) {
            const bulkAutoBanSubmenu = BulkAutoBanSubmenu();
            if (bulkAutoBanSubmenu) {
                children.splice(-1, 0, <Menu.MenuGroup>{bulkAutoBanSubmenu}</Menu.MenuGroup>);
            }
        }
    };
}

function BulkAutoBanSubmenu() {
    const currentUserId = UserStore.getCurrentUser().id;
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);

    if (!currentVoiceState?.channelId) return null;

    const usersInVc = getAllUsersInCurrentVc();
    const channel = ChannelStore.getChannel(currentVoiceState.channelId);
    const actuallyIsOwner = channel?.guild_id ? forceCheckVcOwnership(channel.guild_id, currentVoiceState.channelId) : false;
    const vcOwnerStatus = actuallyIsOwner ? "🟢 VC Owner" : "🔴 Not VC Owner";

    return (
        <Menu.MenuItem
            id="bulk-autoban-submenu"
            label="Bulk Autoban"
        >
            <Menu.MenuItem
                id="bulk-autoban-all-vc"
                label={`Ban All in VC (${usersInVc.length} users)`}
                color="danger"
                action={() => banAllUsersInCurrentVc()}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="bulk-autoban-status"
                label={vcOwnerStatus}
                disabled={true}
                color={actuallyIsOwner ? "brand" : "default"}
            />
        </Menu.MenuItem>
    );
}

function banninguser(id) {
    const currentUserId = UserStore.getCurrentUser().id;
    let channelId: string | null = null;
    let guildId: string | null = null;

    // Find current VC
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    if (currentVoiceState?.channelId) {
        channelId = currentVoiceState.channelId;
        const channel = ChannelStore.getChannel(channelId!);
        guildId = channel?.guild_id ?? null;
    }

    // Fallback to global tracking
    if (!channelId && currentVcChannel) {
        channelId = currentVcChannel;
        guildId = currentVcGuild;
    }

    if (!channelId || !guildId) {
        Toasts.show({
            message: `Not in voice channel - ${id} added to auto-ban list`,
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    // Check ownership
    const isOwner = forceCheckVcOwnership(guildId!, channelId!);

    if (!isOwner) {
        Toasts.show({
            message: `Not the VC owner - ${id} added to auto-ban list`,
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    // Check if target is in same VC
    const targetVoiceState = VoiceStateStore.getVoiceStateForUser(id);
    if (!targetVoiceState?.channelId || targetVoiceState.channelId !== channelId) {
        Toasts.show({
            message: `User ${id} not in your VC - added to auto-ban list`,
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    // Execute ban
    Toasts.show({
        message: `Added ${id} to Auto-Ban List & Auto-banning`,
        type: Toasts.Type.SUCCESS,
        options: { position: Toasts.Position.BOTTOM }
    });

    scheduleTimeout(() => {
        RestAPI.post({
            url: `/channels/${channelId}/messages`,
            body: { content: `!voice-ban ${id}`, nonce: (Math.floor(Math.random() * 10000000000000)) }
        });
    }, settings.store.autoBanDelay * 1000);
}

function checkExistingUsersInVC(channelId: string) {
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    const bannedUsers = settings.store.users.split("/").filter(item => item !== "");
    const currentUserId = UserStore.getCurrentUser().id;

    if (!Object.keys(voiceStates).includes(currentUserId)) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id || !forceCheckVcOwnership(channel.guild_id, channelId)) return;

    Object.keys(voiceStates).forEach((userId, index) => {
        if (userId === currentUserId || !bannedUsers.includes(userId)) return;

        Toasts.show({
            message: `Auto banning existing User ${userId}`,
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });

        scheduleTimeout(() => {
            RestAPI.post({
                url: `/channels/${channelId}/messages`,
                body: { content: `!voice-ban ${userId}`, nonce: (Math.floor(Math.random() * 10000000000000)) }
            });
        }, (index + 1) * settings.store.autoBanDelay * 1000);
    });
}

function EncModals(props) {
    const { userId } = props;
    const currentReasons = settings.store.store.split(".").filter(Boolean);
    const existingReasonEntry = currentReasons.find(entry => entry.startsWith(`${userId}/`));
    const existingReason = existingReasonEntry ? existingReasonEntry.split("/")[1] : "";
    const [reason, setReason] = React.useState(existingReason);

    return (
        <ModalRoot {...props} size={ModalSize.DYNAMIC}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">Autoban Reason</Forms.FormTitle>
            </ModalHeader>
            <ModalContent>
                <TextInput
                    style={{ marginBottom: "10px", minWidth: "600px" }}
                    value={reason}
                    placeholder="Enter the reason for banning this user"
                    onChange={setReason}
                />
            </ModalContent>
            <ModalFooter>
                <Button
                    color={Button.Colors.GREEN}
                    onClick={() => {
                        const updatedReasons = currentReasons.filter(entry => !entry.startsWith(`${userId}/`));
                        updatedReasons.push(`${userId}/${reason}`);
                        settings.store.store = updatedReasons.join(".");
                        settings.store.users = settings.store.users.includes(userId) ? settings.store.users : `${settings.store.users}/${userId}`;
                        props.onClose();
                    }}
                >
                    Confirm reason
                </Button>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    look={Button.Looks.LINK}
                    onClick={props.onClose}
                >
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "autoBan",
    description: "Tools to automatically ban users. Enhanced VC owner detection",
    tags: ["Servers", "Utility"],
    authors: [TestcordDevs.dot],
    settings,
    contextMenus: {
        "user-context": makeUserContextMenuPatch(),
        "channel-context": makeChannelContextMenuPatch()
    },
    start() {
        pluginActive = true;
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", cb);
        this.vcOwnershipInterval = setInterval(checkVcOwnershipStatus, 1500);
        scheduleTimeout(() => {
            checkVcOwnershipStatus();
            forceCheckVcOwnership();
        }, 1000);
    },

    stop() {
        pluginActive = false;
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", cb);
        if (this.vcOwnershipInterval) {
            clearInterval(this.vcOwnershipInterval);
        }
        for (const timeout of pendingTimeouts) clearTimeout(timeout);
        pendingTimeouts.clear();
    }
});

const cb = async e => {
    const state = e.voiceStates[0];
    if (!state?.channelId) return;

    const currentUserId = UserStore.getCurrentUser().id;
    const Cvcstates = VoiceStateStore.getVoiceStatesForChannel(state?.channelId) ?? {};

    // Handle current user VC changes
    if (state.userId === currentUserId) {
        if (state?.channelId !== state?.oldChannelId && state?.channelId) {
            scheduleTimeout(() => {
                const channel = ChannelStore.getChannel(state.channelId);
                if (channel?.guild_id) {
                    forceCheckVcOwnership(channel.guild_id, state.channelId);
                    checkExistingUsersInVC(state.channelId);
                }
            }, 750);
        }

        if (!state?.channelId && state?.oldChannelId) {
            isCurrentlyVcOwner = false;
            currentVcChannel = null;
            currentVcGuild = null;
        }
        return;
    }

    // Handle other users joining
    if (state?.channelId === state?.oldChannelId) return;
    if (!Object.keys(Cvcstates).includes(currentUserId)) return;

    if (state?.channelId && settings.store.users.split("/").filter(item => item !== "").includes(state.userId)) {
        const channel = ChannelStore.getChannel(state.channelId);
        if (!channel?.guild_id) return;

        const isOwner = forceCheckVcOwnership(channel.guild_id, state.channelId);

        if (!isOwner) {
            Toasts.show({
                message: `Not the VC owner - ${state.userId} already on auto-ban list`,
                type: Toasts.Type.MESSAGE,
                options: { position: Toasts.Position.BOTTOM }
            });
            return;
        }

        Toasts.show({
            message: `Auto banning User ${state.userId}`,
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });

        scheduleTimeout(() => {
            RestAPI.post({
                url: `/channels/${state.channelId}/messages`,
                body: { content: `!voice-ban ${state.userId}`, nonce: (Math.floor(Math.random() * 10000000000000)) }
            });
        }, settings.store.autoBanDelay * 1000);
    }
};
