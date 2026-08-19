/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelRouter, UserStore } from "@webpack/common";
export default definePlugin({
    name: "AutoJumpToMention",
    description: "Automatically takes you to the message when someone mentions you",
    tags: ["Utility"],
    authors: [TestcordDevs.SirPhantom89],
    patches: [],
    flux: {
        MESSAGE_CREATE({ message }) {
            if (!message?.content)
                return;
            const me = UserStore.getCurrentUser();
            if (!me)
                return;
            const isDirectlyMentioned = message.mentions?.some((u) => u.id === me.id);
            if (!isDirectlyMentioned)
                return;
            if (message.author?.id === me.id)
                return;
            try {
                ChannelRouter.transitionToChannel(message.channel_id, message.id);
            }
            catch (e) {
                ChannelRouter.transitionTo(`/channels/${message.guild_id || "@me"}/${message.channel_id}/${message.id}`);
            }
        }
    },
    start() {
        console.log("[AutoJumpToMention] ✅ Started (Original Logic with Dual Authors)");
    },
    stop() {
        console.log("[AutoJumpToMention] Stopped");
    },
});
