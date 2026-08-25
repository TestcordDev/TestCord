/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, GuildStore } from "@webpack/common";

import { LogRecord, LogStatus } from "./types";

interface SearchTerm {
    key: string;
    value: string;
    negated: boolean;
}

function parseSearch(query: string): SearchTerm[] {
    return (query.match(/(?:-?[\w-]+:)?"[^"]*"|-?\S+/g) ?? []).map(rawTerm => {
        const negated = rawTerm.startsWith("-");
        const term = (negated ? rawTerm.slice(1) : rawTerm).replace(/^"|"$/g, "");
        const separator = term.indexOf(":");

        return separator === -1
            ? { key: "text", value: term.toLowerCase(), negated }
            : { key: term.slice(0, separator).toLowerCase(), value: term.slice(separator + 1).replace(/^"|"$/g, "").toLowerCase(), negated };
    }).filter(term => term.value.length > 0);
}

export function createSearchMatcher(query: string) {
    const terms = parseSearch(query.trim());
    const channelNames = new Map<string, string>();
    const guildNames = new Map<string, string>();

    return (record: LogRecord) => {
        const { message } = record;
        const authorName = (message.author.global_name ?? message.author.globalName ?? message.author.username ?? "").toLowerCase();
        const guildId = message.guild_id ?? message.guildId ?? ChannelStore.getChannel(message.channel_id)?.guild_id;

        let channelName = channelNames.get(message.channel_id);
        if (channelName === undefined) {
            channelName = ChannelStore.getChannel(message.channel_id)?.name?.toLowerCase() ?? "";
            channelNames.set(message.channel_id, channelName);
        }

        let guildName = guildNames.get(guildId ?? "");
        if (guildName === undefined) {
            guildName = GuildStore.getGuild(guildId)?.name.toLowerCase() ?? "";
            guildNames.set(guildId ?? "", guildName);
        }

        return terms.every(term => {
            const { value } = term;
            let matches: boolean;

            switch (term.key) {
                case "from":
                case "user":
                    matches = message.author.id === value || authorName.includes(value);
                    break;
                case "channel":
                case "in":
                    matches = message.channel_id === value || channelName.includes(value);
                    break;
                case "guild":
                case "server":
                    matches = guildId === value || guildName.includes(value);
                    break;
                case "id":
                case "message":
                    matches = message.id === value;
                    break;
                case "before": {
                    const time = Date.parse(value);
                    matches = !Number.isNaN(time) && Date.parse(message.timestamp) < time;
                    break;
                }
                case "after": {
                    const time = Date.parse(value);
                    matches = !Number.isNaN(time) && Date.parse(message.timestamp) > time;
                    break;
                }
                case "has":
                    matches = value === "attachment" && message.attachments.length > 0
                        || value === "embed" && message.embeds.length > 0
                        || value === "edit" && !!message.editHistory?.length
                        || value === "link" && /(?:https?:\/\/|www\.)/i.test(message.content);
                    break;
                case "is":
                    matches = value === "protected" && !!record.protected
                        || value === "deleted" && record.status === LogStatus.DELETED
                        || value === "edited" && record.status === LogStatus.EDITED
                        || ["ghost", "ghostping", "ghost-ping"].includes(value) && record.status === LogStatus.GHOST_PINGED;
                    break;
                case "text":
                case "content":
                    matches = [message.content ?? "", authorName, channelName, guildName, message.id]
                        .some(candidate => candidate.toLowerCase().includes(value));
                    break;
                default:
                    matches = false;
            }

            return term.negated ? !matches : matches;
        });
    };
}
