/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findByCodeLazy, findByPropsLazy,findStoreLazy } from "@webpack";
import { Button, ChannelStore, Menu, React, RestAPI, Toasts, Tooltip, UserStore } from "@webpack/common";

export const cl = classNameFactory("vc-voice-channel-log-");
const createBotMessage = findByCodeLazy('username:"Clyde"');
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const sessionStore = findByPropsLazy("getSessionId");

const currentVcOwners: Map<string, string> = new Map();
let pluginActive = false;
let pluginGeneration = 0;
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

function scheduleTimeout(callback: () => void, ms: number) {
    const timeout = setTimeout(() => {
        pendingTimeouts.delete(timeout);
        if (pluginActive) callback();
    }, ms);
    pendingTimeouts.add(timeout);
}

const settings = definePluginSettings({
    allowedguilds: {
        type: OptionType.STRING,
        description: "allowed guilds separated by /",
        default: "319560327719026709",
    },
    autoClaimEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable automatic claiming when VC owner leaves",
        default: true,
    },
    claimOnJoinUnowned: {
        type: OptionType.BOOLEAN,
        description: "Auto-claim when joining a VC with no owner present",
        default: true,
    },
    autoClaimOnTransfer: {
        type: OptionType.BOOLEAN,
        description: "Auto-claim when transferred owner leaves while you're in VC",
        default: true,
    },
});

interface VoiceState {
    guildId?: string;
    channelId?: string;
    oldChannelId?: string;
    user: User;
    userId: string;
}

function toBigIntSafe(value: any): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    if (typeof value === "string") return BigInt(value.replace(/n$/, "").trim());
    throw new Error(`cannot convert ${value} to bigint`);
}

function isCustomVoiceChannel(channelId: string): boolean {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel || !channel.name) return false;

    const channelName = channel.name.trim();

    // Remove all infinity symbols, pipe symbols, and spaces from the start
    const cleanedName = channelName.replace(/^[\u221E|\s]+/, "");

    // Check if what remains matches "VC [number]"
    const vcPattern = /^VC\s+\d+$/;
    const isDefaultVc = vcPattern.test(cleanedName);

    console.log(`Channel ${channelId} name: "${channelName}"`);
    console.log(`Cleaned name: "${cleanedName}"`);
    console.log(`VC pattern test: ${isDefaultVc}`);
    console.log(`isCustomVoiceChannel returning: ${!isDefaultVc}`);

    return !isDefaultVc;
}

function detectVcOwner(channelId: string): string | null {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel || !channel.permissionOverwrites) return null;

    const permRequirement = "1049600n";

    for (const [id, overwrite] of Object.entries(channel.permissionOverwrites)) {
        try {
            const { allow, type } = overwrite as any;
            if (type === 1 && allow) {
                if (toBigIntSafe(allow) === toBigIntSafe(permRequirement)) {
                    console.log(`Detected VC owner: ${id} in channel ${channelId}`);
                    return id;
                }
            }
        } catch (error) {
            console.error("Error checking permissions for", id, error);
        }
    }

    return null;
}

function isOwnerInChannel(channelId: string, ownerId: string): boolean {
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId);
    if (!voiceStates) return false;

    return Object.keys(voiceStates).includes(ownerId);
}

function updateVcOwnerTracking(channelId: string) {
    if (!channelId) return;

    const previousOwner = currentVcOwners.get(channelId);
    const newOwner = detectVcOwner(channelId);

    if (newOwner) {
        if (previousOwner !== newOwner) {
            console.log(`VC ownership changed in channel ${channelId}: ${previousOwner || "none"} -> ${newOwner}`);
            if (previousOwner) {
                console.log(`Detected VC transfer from ${previousOwner} to ${newOwner}`);
            }
        }
        currentVcOwners.set(channelId, newOwner);
        console.log(`Tracking VC owner ${newOwner} for channel ${channelId}`);
    } else {
        if (previousOwner) {
            console.log(`No VC owner detected for channel ${channelId} (previously ${previousOwner})`);
            currentVcOwners.delete(channelId);
        }
    }
}

function isGuildAllowed(guildId: string): boolean {
    const allowedGuilds = settings.store.allowedguilds.split("/").filter(item => item !== "");
    return allowedGuilds.includes(guildId);
}

function attemptClaim(channelId: string, reason: string, isManual: boolean = false) {
    const generation = pluginGeneration;
    if (!isManual && !settings.store.autoClaimEnabled) return;

    if (!isCustomVoiceChannel(channelId)) {
        console.log(`Skipping claim for channel ${channelId} - not a custom VC`);
        if (isManual) {
            Toasts.show({
                message: "Cannot claim default server voice channels",
                id: "not-custom-vc",
                type: Toasts.Type.FAILURE,
                options: {
                    position: Toasts.Position.BOTTOM
                }
            });
        }
        return;
    }

    // Check if client is already the owner
    const clientUserId = UserStore.getCurrentUser().id;
    const currentOwner = detectVcOwner(channelId);

    if (currentOwner === clientUserId) {
        console.log(`Skipping claim - client is already the owner of channel ${channelId}`);
        if (isManual) {
            Toasts.show({
                message: "You already own this voice channel!",
                id: "already-owner",
                type: Toasts.Type.MESSAGE,
                options: {
                    position: Toasts.Position.BOTTOM
                }
            });
        }
        return;
    }

    console.log(`${reason} - Attempting to claim channel ${channelId}`);

    RestAPI.post({
        url: `/channels/${channelId}/messages`,
        body: {
            content: "!voice-claim",
            nonce: Math.floor(Math.random() * 10000000000000).toString()
        }
    }).then(() => {
        if (!pluginActive || generation !== pluginGeneration) return;
        console.log(`Successfully ${isManual ? "manually" : "auto-"}claimed channel ${channelId}`);

        currentVcOwners.set(channelId, clientUserId);

        Toasts.show({
            message: `Successfully ${isManual ? "claimed" : "auto-claimed"} voice channel!`,
            id: isManual ? "manual-claim-success" : "auto-claim-success",
            type: Toasts.Type.SUCCESS,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
    }).catch(error => {
        if (!pluginActive || generation !== pluginGeneration) return;
        console.error("Failed to claim channel:", error);
        Toasts.show({
            message: `Failed to claim channel: ${error.message}`,
            id: isManual ? "manual-claim-error" : "auto-claim-error",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
    });
}

function startOwnershipMonitoring() {
    return setInterval(() => {
        const clientUserId = UserStore.getCurrentUser().id;
        const clientChannelId = VoiceStateStore.getVoiceStateForUser(clientUserId)?.channelId;

        if (clientChannelId && currentVcOwners.has(clientChannelId)) {
            const channel = ChannelStore.getChannel(clientChannelId);
            if (channel && channel.guild_id && isGuildAllowed(channel.guild_id) && isCustomVoiceChannel(clientChannelId)) {
                updateVcOwnerTracking(clientChannelId);
            }
        }
    }, 5000);
}

let ownershipMonitorInterval: NodeJS.Timeout | null = null;

function autoDetectVcOwnerOnJoin(channelId: string, guildId: string) {
    if (!channelId || !guildId || !isGuildAllowed(guildId)) return;

    if (!isCustomVoiceChannel(channelId)) {
        console.log(`Skipping auto-detection for channel ${channelId} - not a custom VC`);
        return;
    }

    scheduleTimeout(() => {
        updateVcOwnerTracking(channelId);
        const owner = currentVcOwners.get(channelId);
        const clientUserId = UserStore.getCurrentUser().id;

        if (owner === clientUserId) {
            console.log(`Client is already the VC owner for channel ${channelId}`);
            return; // Early return - don't attempt any claims
        }

        if (owner && owner !== clientUserId) {
            const ownerInChannel = isOwnerInChannel(channelId, owner);

            if (!ownerInChannel && settings.store.claimOnJoinUnowned && settings.store.autoClaimEnabled) {
                console.log(`VC owner ${owner} not present in channel ${channelId}, attempting auto-claim`);
                attemptClaim(channelId, "VC owner not present when joined");
            } else if (ownerInChannel) {
                console.log(`Auto-detected and tracking VC owner: ${owner} in channel ${channelId} (owner present)`);
            }
        } else if (!owner) {
            if (settings.store.claimOnJoinUnowned && settings.store.autoClaimEnabled) {
                console.log(`No VC owner detected for channel ${channelId}, attempting auto-claim`);
                attemptClaim(channelId, "No VC owner detected when joined");
            } else {
                console.log(`No VC owner detected for channel ${channelId}`);
            }
        }
    }, 1500);
}

function makeContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props) => {
        if (!props) return;
        if (settings.store.autoClaimEnabled) return;
        const claim = MenuItem(props.user.id);
        if (!claim) return;
        children.splice(-1, 0, <Menu.MenuGroup>{claim}</Menu.MenuGroup>);
    };
}

function MenuItem(id: string) {
    if (UserStore.getCurrentUser().id === id) return;

    return (
        <Menu.MenuItem
            id="manual-claim-vc"
            label="Claim Voice Channel"
            action={async () => {
                const currentChannelId = VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id)?.channelId;
                if (currentChannelId) {
                    updateVcOwnerTracking(currentChannelId);
                    attemptClaim(currentChannelId, "Manual claim requested", true);
                } else {
                    Toasts.show({
                        message: "You're not in a voice channel",
                        id: "not-in-vc",
                        type: Toasts.Type.FAILURE,
                        options: {
                            position: Toasts.Position.BOTTOM
                        }
                    });
                }
            }}
        />
    );
}

function ToolBarClaimIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            className={classes("vc-claim-icon")}
            viewBox="0 0 15 15"
        >
            <path
                fill="currentColor"
                d="M 11.54 11.92 L 13.32 12.9 L 12.46 14.48 L 10.52 13.04 A 6.252 6.252 0 0 1 9.322 13.823 A 7.504 7.504 0 0 1 8.78 14.07 Q 7.78 14.48 6.5 14.48 A 6.964 6.964 0 0 1 4.93 14.31 A 5.746 5.746 0 0 1 3.77 13.91 Q 2.56 13.34 1.72 12.35 A 6.826 6.826 0 0 1 0.526 10.285 A 7.857 7.857 0 0 1 0.44 10.04 Q 0 8.72 0 7.22 A 9.35 9.35 0 0 1 0.22 5.153 A 7.663 7.663 0 0 1 0.78 3.53 Q 1.56 1.9 3.01 0.95 A 5.732 5.732 0 0 1 5.225 0.102 A 7.655 7.655 0 0 1 6.5 0 A 7.084 7.084 0 0 1 8.07 0.168 A 5.816 5.816 0 0 1 9.23 0.56 Q 10.44 1.12 11.28 2.12 A 7.2 7.2 0 0 1 12.569 4.418 A 9.549 9.549 0 0 1 12.57 4.42 A 8.288 8.288 0 0 1 13.004 6.665 A 9.643 9.643 0 0 1 13.02 7.22 A 9.325 9.325 0 0 1 12.936 8.507 Q 12.841 9.186 12.64 9.766 A 5.548 5.548 0 0 1 12.58 9.93 Q 12.14 11.08 11.54 11.92 Z M 9.1 12.14 L 7.58 11.18 L 8.38 9.72 L 10.18 11.02 Q 10.66 10.24 10.87 9.31 A 8.288 8.288 0 0 0 11.034 8.257 A 11.143 11.143 0 0 0 11.08 7.22 Q 11.08 6.14 10.77 5.14 A 5.929 5.929 0 0 0 10.013 3.551 A 5.561 5.561 0 0 0 9.87 3.35 Q 9.28 2.56 8.43 2.1 A 3.833 3.833 0 0 0 6.97 1.663 A 4.738 4.738 0 0 0 6.5 1.64 A 4.737 4.737 0 0 0 5.262 1.795 A 3.768 3.768 0 0 0 4.04 2.37 A 4.51 4.51 0 0 0 2.661 3.979 A 5.506 5.506 0 0 0 2.48 4.36 A 6.618 6.618 0 0 0 2.01 6.114 A 8.493 8.493 0 0 0 1.94 7.22 Q 1.94 8.3 2.24 9.31 Q 2.54 10.32 3.12 11.12 Q 3.7 11.92 4.54 12.38 Q 5.38 12.84 6.46 12.84 A 5.835 5.835 0 0 0 7.289 12.784 A 4.587 4.587 0 0 0 7.95 12.64 Q 8.609 12.443 9.084 12.15 A 3.467 3.467 0 0 0 9.1 12.14 Z"
            />
        </svg>
    );
}

let clientOldChannelId: string | undefined;

export default definePlugin({
    name: "AutoClaim",
    description: "Automatically claims a vc after the owner of it leaves or when joining unowned VCs (custom VCs only)",
    tags: ["Utility", "Servers"],
    authors: [TestcordDevs.dot],
    settings,

    start() {
        pluginActive = true;
        pluginGeneration++;
        if (ownershipMonitorInterval) {
            clearInterval(ownershipMonitorInterval);
            ownershipMonitorInterval = null;
        }
    },

    stop() {
        pluginActive = false;
        pluginGeneration++;
        if (ownershipMonitorInterval) {
            clearInterval(ownershipMonitorInterval);
            ownershipMonitorInterval = null;
            console.log("Stopped VC ownership monitoring");
        }
        for (const timeout of pendingTimeouts) clearTimeout(timeout);
        pendingTimeouts.clear();
        currentVcOwners.clear();
    },

    contextMenus: {
        "user-context": makeContextMenuPatch()
    },

    patches: [
        {
            find: "\"invite-button\"",
            replacement: {
                match: /(\i\.Fragment,{children:)(\i\i)/,
                replace: "$1[$self.renderClaimButton(),...$2]"
            }
        },
    ],

    renderClaimButton() {
        if (settings.store.autoClaimEnabled) return null;

        return (
            <Tooltip text="Claim Voice Channel">
                {tooltipProps => (
                    <Button
                        style={{ backgroundColor: "transparent" }}
                        {...tooltipProps}
                        size={"25"}
                        className={"vc-manual-claim-btn"}
                        onClick={() => {
                            const currentChannelId = VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id)?.channelId;
                            if (currentChannelId) {
                                updateVcOwnerTracking(currentChannelId);
                                attemptClaim(currentChannelId, "Manual claim from toolbar", true);
                            } else {
                                Toasts.show({
                                    message: "You're not in a voice channel",
                                    id: "not-in-vc-toolbar",
                                    type: Toasts.Type.FAILURE,
                                    options: {
                                        position: Toasts.Position.BOTTOM
                                    }
                                });
                            }
                        }}
                    >
                        <ToolBarClaimIcon />
                    </Button>
                )}
            </Tooltip>
        );
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const clientUserId = UserStore.getCurrentUser().id;

            voiceStates.forEach(state => {
                const { userId, channelId, guildId } = state;
                const user = UserStore.getUser(userId) as User & { globalName: string; };
                let { oldChannelId } = state;

                // Handle client's own voice state changes
                if (userId === clientUserId && channelId !== clientOldChannelId) {
                    oldChannelId = clientOldChannelId;
                    clientOldChannelId = channelId;

                    // Client joined a new channel
                    if (channelId && guildId && isGuildAllowed(guildId)) {
                        autoDetectVcOwnerOnJoin(channelId, guildId);
                    }

                    // Client left a channel completely
                    if (oldChannelId && !channelId) {
                        currentVcOwners.delete(oldChannelId);
                        console.log(`Cleaned up tracking for channel ${oldChannelId} - client left`);

                        if (!channelId && ownershipMonitorInterval) {
                            clearInterval(ownershipMonitorInterval);
                            ownershipMonitorInterval = null;
                            console.log("Stopped VC ownership monitoring - left all VCs");
                        }
                    }

                    // Client switched channels
                    if (oldChannelId && channelId) {
                        currentVcOwners.delete(oldChannelId);
                        console.log(`Cleaned up tracking for channel ${oldChannelId} - client switched VCs`);
                    }
                }

                // Skip if no actual channel change for other users
                if (oldChannelId === channelId) return;
                if (userId === clientUserId) return;

                // Handle when someone leaves a channel (potential ownership reclaim)
                if (oldChannelId && !channelId) {
                    const trackedOwner = currentVcOwners.get(oldChannelId);
                    const clientCurrentChannel = VoiceStateStore.getVoiceStateForUser(clientUserId)?.channelId;

                    // Check if this was the tracked owner leaving
                    if (trackedOwner && trackedOwner === userId) {
                        console.log(`VC owner ${userId} left channel ${oldChannelId}`);

                        if (clientCurrentChannel === oldChannelId && guildId && isGuildAllowed(guildId) && isCustomVoiceChannel(oldChannelId)) {
                            console.log("Client is still in the custom VC after owner left, attempting auto-claim");

                            // Clear the old owner from tracking
                            currentVcOwners.delete(oldChannelId);

                            // Check if client is already the new owner before attempting claim
                            scheduleTimeout(() => {
                                const newOwner = detectVcOwner(oldChannelId);
                                if (newOwner === clientUserId) {
                                    console.log("Client is already the new owner, no claim needed");
                                    currentVcOwners.set(oldChannelId, clientUserId);
                                    return;
                                }
                                attemptClaim(oldChannelId, "Original VC owner left");
                            }, 1000);

                            // Fallback attempt
                            scheduleTimeout(() => {
                                const newOwner = detectVcOwner(oldChannelId);
                                if (newOwner === clientUserId) {
                                    console.log("Client became owner naturally, updating tracking");
                                    currentVcOwners.set(oldChannelId, clientUserId);
                                    return;
                                }
                                // Only attempt if we still don't have an owner tracked
                                if (!currentVcOwners.has(oldChannelId)) {
                                    console.log("Fallback attempt - no owner detected after delay");
                                    attemptClaim(oldChannelId, "Fallback claim after owner left");
                                }
                            }, 3000);
                        } else {
                            currentVcOwners.delete(oldChannelId);
                        }
                    }
                    // Check if any other owner left while client is in the channel
                    else if (clientCurrentChannel === oldChannelId && guildId && isGuildAllowed(guildId) && isCustomVoiceChannel(oldChannelId)) {
                        // Update tracking to see if ownership changed
                        scheduleTimeout(() => {
                            const previousOwner = currentVcOwners.get(oldChannelId);
                            updateVcOwnerTracking(oldChannelId);
                            const newOwner = currentVcOwners.get(oldChannelId);

                            // If there's no owner now and someone just left, attempt to claim
                            if (!newOwner && settings.store.autoClaimOnTransfer && settings.store.autoClaimEnabled) {
                                console.log(`No owner after user ${userId} left channel ${oldChannelId}, attempting auto-claim`);
                                attemptClaim(oldChannelId, "Auto-claim after user left - no owner detected");
                            }
                            // If ownership transferred to someone else who just left
                            else if (newOwner && newOwner !== previousOwner && !isOwnerInChannel(oldChannelId, newOwner) && settings.store.autoClaimOnTransfer) {
                                console.log(`New owner ${newOwner} not in channel ${oldChannelId}, attempting auto-claim`);
                                attemptClaim(oldChannelId, "Auto-claim - transferred owner not present");
                            }
                        }, 1500);
                    }
                }

                // Handle when someone joins a channel (refresh ownership tracking)
                if (!oldChannelId && channelId) {
                    const clientCurrentChannel = VoiceStateStore.getVoiceStateForUser(clientUserId)?.channelId;

                    if (clientCurrentChannel === channelId && guildId && isGuildAllowed(guildId) && isCustomVoiceChannel(channelId)) {
                        scheduleTimeout(() => {
                            updateVcOwnerTracking(channelId);
                            console.log(`Refreshed VC owner tracking for channel ${channelId} - new user joined`);
                        }, 1000);
                    }
                }
            });
        },
    }
});
