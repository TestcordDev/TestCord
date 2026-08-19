/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { showNotification } from "@api/Notifications";
import { definePluginSettings, Settings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelStore, MessageStore, NavigationRouter, UserStore } from "@webpack/common";
let reactions = {};
let timeoutId = null;
const settings = definePluginSettings({
    delay: {
        type: 1 /* OptionType.NUMBER */,
        description: "Delay between notifications in seconds (the lower the more notifications will be sent)",
        default: 15,
    },
    ignoreSelf: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Ignores yourself from being logged",
        default: true,
    }
});
export default definePlugin({
    name: "ReactionLogger",
    description: "Get notified when a user reacts to your messages",
    tags: ["Reactions", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    flux: {
        MESSAGE_REACTION_ADD({ optimistic, type, guildId, messageId, channelId, userId, emoji }) {
            if (type !== "MESSAGE_REACTION_ADD" && !optimistic)
                return;
            const message = MessageStore.getMessage(channelId, messageId);
            if (!message)
                return;
            // we don't want to get notified for reactions on polls
            // if (message?.poll) return;
            // idk how to check for a poll so ¯\_(ツ)_/¯
            const currentUser = UserStore.getCurrentUser();
            if (!currentUser)
                return;
            if (message.author.id !== currentUser.id)
                return;
            if (Settings.plugins.ReactionLogger.ignoreSelf && userId === currentUser.id)
                return;
            const name = emoji.name.toLowerCase();
            const reactedUser = UserStore.getUser(userId);
            reactions[name] = (reactions[name] || []).concat(reactedUser);
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(() => {
                const reactionEntries = Object.entries(reactions);
                reactionEntries.forEach(([emojiName, users]) => {
                    if (Array.isArray(users)) {
                        const notificationBody = users.length > 1
                            ? `You received ${users.length} reactions of ${emojiName}`
                            : `${users[0].username} reacted with ${emojiName} to your message`;
                        showNotification({
                            title: "Reaction Logger",
                            body: notificationBody,
                            icon: users[0].getAvatarURL(),
                            onClick: () => {
                                if (!ChannelStore.hasChannel(channelId))
                                    return;
                                NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}`);
                            }
                        });
                    }
                });
                reactions = {};
                timeoutId = null;
            }, Settings.plugins.ReactionLogger.delay * 1000);
        },
    },
    stop() {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        reactions = {};
    }
});
