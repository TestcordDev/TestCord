/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { Settings } from "@api/Settings";
import { ChannelStore, SelectedChannelStore, UserGuildSettingsStore, UserStore } from "@webpack/common";
import { settings } from "../index";
import { findLastIndex, getGuildIdByChannel } from "./misc";
export * from "./cleanUp";
export * from "./misc";
// stolen from mlv2
// https://github.com/1Lighty/BetterDiscordPlugins/blob/master/Plugins/MessageLoggerV2/MessageLoggerV2.plugin.js#L2367
export const DISCORD_EPOCH = 14200704e5;
export function reAddDeletedMessages(messages, deletedMessages, channelStart, channelEnd) {
    if (!messages.length || !deletedMessages?.length)
        return;
    // Build timestamp arrays for range computation (preserving original boundary logic)
    const IDs = [];
    const savedIDs = [];
    for (let i = 0; i < messages.length; i++) {
        const { id } = messages[i] || {};
        if (!id)
            continue;
        const parsedId = parseInt(id);
        if (isNaN(parsedId))
            continue;
        IDs.push({ id, time: (parsedId / 4194304) + DISCORD_EPOCH });
    }
    for (let i = 0; i < deletedMessages.length; i++) {
        const record = deletedMessages[i];
        if (!record || !record.id)
            continue;
        const parsedId = parseInt(record.id);
        if (isNaN(parsedId))
            continue;
        savedIDs.push({ id: record.id, time: (parsedId / 4194304) + DISCORD_EPOCH, message: record });
    }
    if (!IDs.length)
        return;
    savedIDs.sort((a, b) => a.time - b.time);
    if (!savedIDs.length)
        return;
    const { time: lowestTime } = IDs[IDs.length - 1];
    const [{ time: highestTime }] = IDs;
    const lowestIDX = channelEnd ? 0 : savedIDs.findIndex(e => e.time > lowestTime);
    if (lowestIDX === -1)
        return;
    const highestIDX = channelStart ? savedIDs.length - 1 : findLastIndex(savedIDs, e => e.time < highestTime);
    if (highestIDX === -1)
        return;
    // Extract message objects from the range, dedupe with Set (O(1) vs O(n) findIndex)
    const existingIds = new Set();
    for (let i = 0; i < messages.length; i++) {
        const mid = messages[i]?.id;
        if (mid)
            existingIds.add(mid);
    }
    const toInsert = [];
    for (let i = lowestIDX; i <= highestIDX; i++) {
        const entry = savedIDs[i];
        if (entry?.message && !existingIds.has(entry.id)) {
            toInsert.push(entry.message);
        }
    }
    if (!toInsert.length)
        return;
    // Build combined array sorted newest-first (fixes original splice-at-wrong-position bug)
    const combined = messages.concat(toInsert);
    combined.sort((a, b) => {
        const ta = a?.id ? (parseInt(a.id) / 4194304 + DISCORD_EPOCH) : 0;
        const tb = b?.id ? (parseInt(b.id) / 4194304 + DISCORD_EPOCH) : 0;
        return tb - ta;
    });
    // Assign back in-place
    messages.length = 0;
    for (let i = 0; i < combined.length; i++) {
        messages.push(combined[i]);
    }
}
const EPHEMERAL = 64;
/**
  * the function `shouldIgnore` evaluates whether a message should be ignored or kept, following a priority hierarchy: User > Channel > Server.
  * In this hierarchy, whitelisting takes priority; if any element (User, Channel, or Server) is whitelisted, the message is kept.
  * However, if a higher-priority element, like a User, is blacklisted, it will override the whitelisting status of a lower-priority element, such as a Server, causing the message to be ignored.
  * @param {ShouldIgnoreArguments} args - An object containing the message details.
  * @returns {boolean} - True if the message should be ignored, false if it should be kept.
*/
export function shouldIgnore({ channelId, authorId, guildId, flags, bot, ghostPinged, isCachedByUs, webhookId }) {
    const isEphemeral = ((flags ?? 0) & EPHEMERAL) === EPHEMERAL;
    if (isEphemeral)
        return true;
    if (channelId && guildId == null)
        guildId = getGuildIdByChannel(channelId);
    const myId = UserStore.getCurrentUser().id;
    const { ignoreUsers, ignoreChannels, ignoreGuilds } = Settings.plugins.MessageLogger;
    const { ignoreBots, ignoreSelf, ignoreWebhooks, whitelistedIds, blacklistedIds } = settings.store;
    const whitelistArr = whitelistedIds.split(",");
    const blacklistArr = [
        ...blacklistedIds.split(","),
        ...(ignoreUsers ?? []).split(","),
        ...(ignoreChannels ?? []).split(","),
        ...(ignoreGuilds ?? []).split(",")
    ];
    if (ignoreSelf && authorId === myId)
        return true;
    if (settings.store.alwaysLogDirectMessages && ChannelStore.getChannel(channelId ?? "-1")?.isDM?.())
        return false;
    const shouldLogCurrentChannel = settings.store.alwaysLogCurrentChannel && SelectedChannelStore.getChannelId() === channelId;
    const isAuthorWhitelisted = whitelistArr.includes(authorId);
    const isChannelWhitelisted = whitelistArr.includes(channelId);
    const isGuildWhitelisted = whitelistArr.includes(guildId);
    const ids = [authorId, channelId, guildId];
    const isWhitelisted = whitelistArr.some(e => ids.includes(e));
    const isAuthorBlacklisted = blacklistArr.includes(authorId);
    const isChannelBlacklisted = blacklistArr.includes(channelId);
    const isBlacklisted = blacklistArr.some(e => ids.includes(e));
    if ((ignoreBots && bot) && !isAuthorWhitelisted)
        return true;
    if ((ignoreWebhooks && webhookId) && !isAuthorWhitelisted)
        return true;
    if (ghostPinged)
        return false;
    if (isAuthorWhitelisted)
        return false;
    if (isAuthorBlacklisted)
        return true;
    if (isChannelWhitelisted)
        return false;
    if (isChannelBlacklisted)
        return true;
    if (shouldLogCurrentChannel)
        return false;
    if (isWhitelisted)
        return false;
    if (isCachedByUs && (!settings.store.cacheMessagesFromServers && guildId != null && !isGuildWhitelisted))
        return true;
    if (isBlacklisted && (!isAuthorWhitelisted || !isChannelWhitelisted))
        return true;
    if (guildId != null && settings.store.ignoreMutedGuilds && UserGuildSettingsStore.isMuted(guildId))
        return true;
    if (channelId != null && guildId != null && settings.store.ignoreMutedCategories && UserGuildSettingsStore.isCategoryMuted(guildId, channelId))
        return true;
    if (channelId != null && guildId != null && settings.store.ignoreMutedChannels && UserGuildSettingsStore.isChannelMuted(guildId, channelId))
        return true;
    return false;
}
export function addToXAndRemoveFromOpposite(list, id) {
    const oppositeListType = list === "blacklistedIds" ? "whitelistedIds" : "blacklistedIds";
    removeFromX(oppositeListType, id);
    addToX(list, id);
}
export function addToX(list, id) {
    const items = settings.store[list] ? settings.store[list].split(",") : [];
    if (!items.includes(id)) {
        items.push(id);
        settings.store[list] = items.join(",");
    }
}
export function removeFromX(list, id) {
    const items = settings.store[list] ? settings.store[list].split(",") : [];
    const index = items.indexOf(id);
    if (index !== -1) {
        items.splice(index, 1);
        settings.store[list] = items.join(",");
    }
}
