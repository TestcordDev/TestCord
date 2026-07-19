/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildMemberStore } from "@webpack/common";

const settings = definePluginSettings({
    indicatorStyle: {
        type: OptionType.SELECT,
        description: "How to indicate dead members",
        options: [
            { label: "Strikethrough", value: "strikethrough", default: true },
            { label: "Badge", value: "badge" },
        ],
    },
});

export default definePlugin({
    name: "DeadMembers",
    description: "Shows when the sender of a message has left the guild",
    authors: [Devs.Kyuuhachi],
    tags: ["Servers", "Utility"],
    enabledByDefault: false,
    settings,

    patches: [
        {
            find: '"data-username-has-gradient"',
            replacement: {
                match: /(?<=onContextMenu:\i,children:)(.{0,300}?)(?=,"data-text":)/,
                replace: "$self.wrapMessageAuthor(arguments[0],$&)"
            }
        },
    ],

    wrapMessageAuthor({ message }: any, text: any) {
        const channel = ChannelStore.getChannel(message.channel_id);
        if (message.webhookId) return text;
        return (
            <DeadIndicator
                channel={channel}
                userId={message.author.id}
                text={text}
            />
        );
    },
});

const DeadIndicator = ErrorBoundary.wrap(function DeadIndicator({ channel, userId, text }: { channel: any; userId: string; text: any; }) {
    const guildId = channel?.guild_id;
    if (!guildId) return text;

    const isMember = GuildMemberStore.isMember(guildId, userId);
    if (isMember) return text;

    if (settings.store.indicatorStyle === "badge") {
        return <span className="c98-author-dead-badge">{text}</span>;
    }
    return <s className="c98-author-dead">{text}</s>;
}, { noop: true });
