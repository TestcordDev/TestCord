/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, Menu, React, RestAPI, Toasts,UserStore } from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable ShareBanPerm plugin",
        default: true,
    },
    commandPrefix: {
        type: OptionType.STRING,
        description: "Command prefix to listen for (e.g., !vb)",
        default: "!vb",
    },
    voiceBanCommand: {
        type: OptionType.STRING,
        description: "Voice ban command to execute (e.g., !voice-ban)",
        default: "!voice-ban",
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Delay before executing voice ban command (milliseconds)",
        default: 1000,
        validators: [value => value >= 500 && value <= 10000]
    },
    spamProtectionWindow: {
        type: OptionType.NUMBER,
        description: "Time window for spam protection (seconds)",
        default: 30,
        validators: [value => value >= 10 && value <= 300]
    },
    maxCommandsPerWindow: {
        type: OptionType.NUMBER,
        description: "Maximum commands allowed per time window",
        default: 3,
        validators: [value => value >= 1 && value <= 10]
    },
    showStatusMessages: {
        type: OptionType.BOOLEAN,
        description: "Show status messages for command execution",
        default: true,
    },
    requireVoiceChannel: {
        type: OptionType.BOOLEAN,
        description: "Only allow commands from voice channel text chats",
        default: true,
    }
});

interface AuthorizedUser {
    userId: string;
    username: string;
    grantedBy: string;
    grantedAt: number;
}

interface CommandExecution {
    timestamp: number;
    userId: string;
    targetUserId: string;
}

class SpamProtection {
    private commandHistory: CommandExecution[] = [];

    public canExecuteCommand(userId: string, targetUserId: string): boolean {
        const now = Date.now();
        const windowMs = settings.store.spamProtectionWindow * 1000;

        this.commandHistory = this.commandHistory.filter(
            entry => now - entry.timestamp < windowMs
        );

        const recentCommands = this.commandHistory.filter(
            entry => entry.userId === userId
        );

        if (recentCommands.length >= settings.store.maxCommandsPerWindow) {
            console.log(`Rate limit exceeded for user ${userId}`);
            return false;
        }

        const duplicateTarget = recentCommands.find(
            entry => entry.targetUserId === targetUserId
        );

        if (duplicateTarget) {
            console.log(`Duplicate target ${targetUserId} blocked`);
            return false;
        }

        this.commandHistory.push({
            timestamp: now,
            userId,
            targetUserId
        });

        return true;
    }

    public getRemainingCooldown(userId: string): number {
        const now = Date.now();
        const windowMs = settings.store.spamProtectionWindow * 1000;

        const recentCommands = this.commandHistory.filter(
            entry => entry.userId === userId && now - entry.timestamp < windowMs
        );

        if (recentCommands.length === 0) return 0;

        const oldestCommand = Math.min(...recentCommands.map(cmd => cmd.timestamp));
        const cooldownEnd = oldestCommand + windowMs;

        return Math.max(0, Math.ceil((cooldownEnd - now) / 1000));
    }
}

class ShareBanManager {
    private authorizedUsers = new Map<string, AuthorizedUser>();
    private spamProtection = new SpamProtection();
    private commandQueue: Array<{ channelId: string, command: string, delay: number; }> = [];
    private isProcessing = false;
    private queueProcessor: NodeJS.Timeout | null = null;

    constructor() {
        this.startQueueProcessor();
    }

    public addAuthorizedUser(userId: string, username: string, grantedBy: string): boolean {
        if (userId === UserStore.getCurrentUser()?.id) {
            console.log("Cannot authorize yourself!");
            return false;
        }

        this.authorizedUsers.set(userId, {
            userId,
            username,
            grantedBy,
            grantedAt: Date.now()
        });

        console.log(`✅ Authorized ${username} (${userId}) for voice ban permissions`);
        return true;
    }

    public removeAuthorizedUser(userId: string): boolean {
        const user = this.authorizedUsers.get(userId);
        if (user) {
            this.authorizedUsers.delete(userId);
            console.log(`❌ Removed authorization for ${user.username}`);
            return true;
        }
        return false;
    }

    public toggleAuthorization(userId: string, username: string): boolean {
        if (this.authorizedUsers.has(userId)) {
            return this.removeAuthorizedUser(userId);
        } else {
            const currentUser = UserStore.getCurrentUser();
            return this.addAuthorizedUser(userId, username, currentUser?.username || "Unknown");
        }
    }

    public isUserAuthorized(userId: string): boolean {
        return this.authorizedUsers.has(userId);
    }

    public handleMessage(message: any) {
        if (!settings.store.enabled) return;

        if (!this.isUserAuthorized(message.author.id)) return;

        if (message.author.bot || message.type !== 0) return;

        const content = message.content?.trim();
        if (!content || !content.startsWith(settings.store.commandPrefix)) return;

        if (settings.store.requireVoiceChannel && !this.isVoiceChannelTextChat(message.channel_id)) {
            this.showError("Voice ban commands can only be used in voice channel text chats!");
            return;
        }

        const args = content.split(/\s+/);
        if (args.length < 2) {
            this.showError("Usage: " + settings.store.commandPrefix + " <user_id>");
            return;
        }

        const targetUserId = args[1].replace(/[<@!>]/g, "");

        if (!/^\d{17,19}$/.test(targetUserId)) {
            this.showError("Invalid user ID format!");
            return;
        }

        if (!this.spamProtection.canExecuteCommand(message.author.id, targetUserId)) {
            const cooldown = this.spamProtection.getRemainingCooldown(message.author.id);
            this.showError(`Rate limited! Please wait ${cooldown} seconds before using this command again.`);
            return;
        }

        const voiceBanCommand = `${settings.store.voiceBanCommand} ${targetUserId}`;
        this.queueCommand(message.channel_id, voiceBanCommand);

        if (settings.store.showStatusMessages) {
            this.showSuccess(`Executing voice ban on user ${targetUserId}...`);
        }

        console.log(`Queued voice ban command for ${targetUserId} requested by ${message.author.username}`);
    }

    private isVoiceChannelTextChat(channelId: string): boolean {
        const channel = ChannelStore.getChannel(channelId);
        return channel && (channel.type === 2 || channel.parent_id !== null);
    }

    private queueCommand(channelId: string, command: string) {
        this.commandQueue.push({
            channelId,
            command,
            delay: settings.store.delay
        });
    }

    private startQueueProcessor() {
        this.queueProcessor = setInterval(async () => {
            if (this.isProcessing || this.commandQueue.length === 0) return;

            this.isProcessing = true;

            while (this.commandQueue.length > 0) {
                const cmd = this.commandQueue.shift()!;

                try {
                    await this.sendCommand(cmd.channelId, cmd.command);
                    console.log(`📤 Executed command: "${cmd.command}"`);
                } catch (error) {
                    console.error("❌ Failed to execute command:", error);
                }

                await sleep(cmd.delay + Math.random() * 500 + 200);
            }

            this.isProcessing = false;
        }, 100);
    }

    private async sendCommand(channelId: string, command: string): Promise<boolean> {
        try {
            await RestAPI.post({
                url: `/channels/${channelId}/messages`,
                body: {
                    content: command,
                    tts: false,
                    flags: 0
                }
            });
            return true;
        } catch (error) {
            console.error("Failed to send command via API:", error);
            return false;
        }
    }

    private showError(message: string) {
        if (!settings.store.showStatusMessages) return;

        Toasts.show({
            message: `❌ ${message}`,
            id: "share-ban-perm-error",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM,
            }
        });
    }

    private showSuccess(message: string) {
        if (!settings.store.showStatusMessages) return;

        Toasts.show({
            message: `✅ ${message}`,
            id: "share-ban-perm-success",
            type: Toasts.Type.SUCCESS,
            options: {
                position: Toasts.Position.BOTTOM,
            }
        });
    }

    public clearQueue() {
        this.commandQueue = [];
        this.isProcessing = false;
    }

    public clearAllAuthorizations() {
        this.authorizedUsers.clear();
        this.clearQueue();
    }

    public getAuthorizedUsers(): AuthorizedUser[] {
        return Array.from(this.authorizedUsers.values());
    }

    public stopQueueProcessor() {
        if (this.queueProcessor) {
            clearInterval(this.queueProcessor);
            this.queueProcessor = null;
        }
    }
}

const shareBanManager = new ShareBanManager();

const UserContext: NavContextMenuPatchCallback = (children, props) => {
    if (!settings.store.enabled) return;

    const { user } = props;
    if (!user) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || user.id === currentUser.id) return;

    const isAuthorized = shareBanManager.isUserAuthorized(user.id);

    children.splice(-1, 0,
        <Menu.MenuGroup>
            <Menu.MenuCheckboxItem
                id="share-ban-perm"
                label="Share Ban Permission"
                checked={isAuthorized}
                action={async () => {
                    const wasAuthorized = shareBanManager.isUserAuthorized(user.id);
                    const success = shareBanManager.toggleAuthorization(user.id, user.username);

                    if (success) {
                        if (settings.store.showStatusMessages) {
                            const statusMessage = wasAuthorized
                                ? `❌ Removed voice ban permission from **${user.username}**`
                                : `✅ Granted voice ban permission to **${user.username}**`;

                            Toasts.show({
                                message: statusMessage,
                                id: "share-ban-perm-status",
                                type: wasAuthorized ? Toasts.Type.MESSAGE : Toasts.Type.SUCCESS,
                                options: {
                                    position: Toasts.Position.BOTTOM,
                                }
                            });
                        }
                    } else {
                        Toasts.show({
                            message: "❌ Failed to toggle authorization",
                            id: "share-ban-perm-error",
                            type: Toasts.Type.FAILURE,
                            options: {
                                position: Toasts.Position.BOTTOM,
                            }
                        });
                    }
                }}
            />
        </Menu.MenuGroup>
    );
};

function handleMessageCreate(data: any) {
    if (!settings.store.enabled) return;

    const { message } = data;
    if (!message?.author || !message.id || !message.channel_id) return;

    shareBanManager.handleMessage(message);
}

export default definePlugin({
    name: "ShareBanPerm",
    description: "Allow VC owners to trigger voice ban commands with spam protection",
    tags: ["Servers", "Voice"],
    authors: [TestcordDevs.dot],

    settings,

    contextMenus: {
        "user-context": UserContext
    },

    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
        console.log("plugin started successfully");
        console.log(`scanning for "${settings.store.commandPrefix} <user_id>" commands`);
        console.log(`auto responds with "${settings.store.voiceBanCommand} <user_id>" in same channel`);
        console.log(`spam protection: max ${settings.store.maxCommandsPerWindow} commands per ${settings.store.spamProtectionWindow} seconds`);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageCreate);
        shareBanManager.clearQueue();
        shareBanManager.stopQueueProcessor();
        console.log("Plugin stopped");
    },
});
