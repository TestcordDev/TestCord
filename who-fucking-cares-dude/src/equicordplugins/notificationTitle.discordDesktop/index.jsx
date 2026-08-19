/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Devs } from "@utils/constants";
import { getIntlMessage } from "@utils/discord";
import definePlugin from "@utils/types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { ChannelStore, GuildStore, RelationshipStore, UserStore } from "@webpack/common";
const { getName } = findByPropsLazy("getName", "useName", "getNickname");
const computeChannelName = findByCodeLazy(".isThread())return`\"");
const ChannelTypes = findByPropsLazy("DM", "GUILD_TEXT", "PUBLIC_THREAD", "UNKNOWN");
const ChannelTypesSets = findByPropsLazy("THREADS", "GUILD_TEXTUAL", "ALL_DMS");
const MessageTypes = findByPropsLazy("REPLY", "STAGE_RAISE_HAND", "CHANNEL_NAME_CHANGE");
function toPlainString(val) {
    if (typeof val === "string")
        return val;
    if (val == null)
        return "";
    if (Array.isArray(val))
        return val.map(toPlainString).join("");
    if (typeof val === "object" && typeof val.toString === "function" && val.toString !== Object.prototype.toString) {
        return val.toString();
    }
    return String(val);
}
export default definePlugin({
    name: "NotificationTitle",
    description: "Makes desktop notifications more informative",
    tags: ["Appearance", "Notifications"],
    authors: [Devs.Kyuuhachi],
    patches: [
        {
            find: '"SystemMessageUtils.stringify(...) could not convert"',
            replacement: {
                match: /{icon:.{0,50}emoji:\i}/,
                replace: "($self.makeTitle($&,...arguments))",
            }
        },
    ],
    makeTitle(result, channel, message, user) {
        if (!result || typeof result !== "object")
            return result;
        try {
            const username = getName(channel?.guild_id, channel?.id, user) ?? user?.username ?? "";
            let title = toPlainString(username);
            if (message?.type === MessageTypes?.REPLY && message?.referenced_message?.author) {
                const replyUser = UserStore.getUser(message.referenced_message.author.id);
                const replyUsername = getName(channel?.guild_id, channel?.id, replyUser) ?? replyUser?.username ?? "";
                const replyLabel = getIntlMessage("CHANNEL_MESSAGE_REPLY_A11Y_LABEL", {
                    author: username,
                    repliedAuthor: replyUsername,
                });
                title = toPlainString(replyLabel) || `${username} replied to ${replyUsername}`;
            }
            const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
            const parent = channel?.parent_id ? ChannelStore.getChannel(channel.parent_id) : null;
            if (channel?.type !== ChannelTypes?.DM) {
                let where = ChannelTypesSets?.THREADS?.has?.(channel?.type)
                    ? `${channelName(channel)} in ${channelName(parent, true)}`
                    : `${channelName(channel, true)}`;
                if (guild != null && guild.name)
                    where += `, ${guild.name}`;
                title += `\n(${where})`;
            }
            result.title = toPlainString(title);
            if (result.body != null) {
                result.body = toPlainString(result.body);
            }
            return result;
        }
        catch {
            return result;
        }
    }
});
function channelName(channel, withPrefix = false) {
    if (!channel)
        return "";
    try {
        return computeChannelName(channel, UserStore, RelationshipStore, withPrefix) ?? "";
    }
    catch {
        return channel.name ?? "";
    }
}
