/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import definePlugin from "@utils/types";
import { IconUtils, UserStore } from "@webpack/common";

export default definePlugin({
    name: "AvatarGrabber",
    description: "/avatar grabs the full-resolution avatar of any user (or yourself).",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Commands", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "avatar",
            description: "Get a user's full-size avatar",
            options: [
                { name: "user", description: "Whose avatar (defaults to you)", type: ApplicationCommandOptionType.USER }
            ],
            execute: (opts, ctx) => {
                const userId = findOption<string>(opts, "user") ?? UserStore.getCurrentUser()?.id;
                const user = userId ? UserStore.getUser(userId) : null;
                if (!user) {
                    sendBotMessage(ctx.channel.id, { content: "Couldn't find that user." });
                    return;
                }
                const url = IconUtils.getUserAvatarURL(user, true, 1024);
                return { content: url };
            }
        }
    ]
});
