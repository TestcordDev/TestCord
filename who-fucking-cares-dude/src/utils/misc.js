/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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
import { ChannelStore, GuildMemberStore, IconUtils } from "@webpack/common";
import { EQUICORD_GUILD_ID, EQUICORD_HELPERS, EquicordDevsById, KNOWN_ISSUES_CHANNEL_ID, SUPPORT_CHANNEL_ID, TESTCORD_GUILD_ID, TestcordDevsById, VencordDevsById } from "./constants";
import { TestcordAdminsById } from "./testcordAdmins";
/**
 * Calls .join(" ") on the arguments
 * classes("one", "two") => "one two"
 */
export function classes(...classes) {
    return classes.filter(Boolean).join(" ");
}
/**
 * Returns a promise that resolves after the specified amount of time
 */
export function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
/**
 * Check if obj is a true object: of type "object" and not null or array
 */
export function isObject(obj) {
    return typeof obj === "object" && obj !== null && !Array.isArray(obj);
}
/**
 * Check if an object is empty or in other words has no own properties
 */
export function isObjectEmpty(obj) {
    for (const k in obj)
        if (Object.hasOwn(obj, k))
            return false;
    return true;
}
/**
 * Returns null if value is not a URL, otherwise return URL object.
 * Avoids having to wrap url checks in a try/catch
 */
export function parseUrl(urlString) {
    try {
        return new URL(urlString);
    }
    catch {
        return null;
    }
}
/**
 * Checks whether an element is on screen
 */
export const checkIntersecting = (el) => {
    const elementBox = el.getBoundingClientRect();
    const documentHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    return !(elementBox.bottom < 0 || elementBox.top - documentHeight >= 0);
};
export function identity(value) {
    return value;
}
export const isPluginDev = (id) => Object.hasOwn(VencordDevsById, id);
export const shouldShowContributorBadge = (id) => isPluginDev(id) && VencordDevsById[id].badge !== false;
export const isEquicordPluginDev = (id) => Object.hasOwn(EquicordDevsById, id);
export const shouldShowEquicordContributorBadge = (id) => isEquicordPluginDev(id) && EquicordDevsById[id].badge !== false;
export const isTestcordPluginDev = (id) => Object.hasOwn(TestcordDevsById, id);
export const shouldShowTestcordContributorBadge = (id) => isTestcordPluginDev(id) && TestcordDevsById[id].badge !== false;
export const isTestcordAdmin = (id) => Object.hasOwn(TestcordAdminsById, id);
export const shouldShowTestcordAdminBadge = (id) => isTestcordAdmin(id);
export const isAnyPluginDev = (id) => Object.hasOwn(VencordDevsById, id) || Object.hasOwn(EquicordDevsById, id) || Object.hasOwn(TestcordDevsById, id);
export function pluralise(amount, singular, plural = singular + "s") {
    return amount === 1 ? `${amount} ${singular}` : `${amount} ${plural}`;
}
export function interpolateIfDefined(strings, ...args) {
    if (args.some(arg => arg == null))
        return "";
    return String.raw({ raw: strings }, ...args);
}
export function tryOrElse(func, fallback) {
    try {
        const res = func();
        return res instanceof Promise
            ? res.catch(() => fallback)
            : res;
    }
    catch {
        return fallback;
    }
}
export function isEquicordGuild(id, isGuildId = false) {
    if (!id)
        return false;
    if (isGuildId)
        return id === EQUICORD_GUILD_ID;
    const channel = ChannelStore.getChannel(id);
    if (!channel)
        return false;
    return channel.guild_id === EQUICORD_GUILD_ID;
}
export function isTestCordGuild(id, isGuildId = false) {
    if (!id)
        return false;
    if (isGuildId)
        return id === TESTCORD_GUILD_ID;
    const channel = ChannelStore.getChannel(id);
    return channel?.guild_id === TESTCORD_GUILD_ID;
}
export function isSupportChannel(channelId) {
    if (!channelId)
        return false;
    return channelId === SUPPORT_CHANNEL_ID;
}
export function isKnownIssuesCategory(channelId) {
    if (!channelId)
        return false;
    return channelId === KNOWN_ISSUES_CHANNEL_ID;
}
export function isEquicordSupport(userId) {
    if (!userId)
        return false;
    const member = GuildMemberStore.getMember(EQUICORD_GUILD_ID, userId);
    if (!member)
        return false;
    return member.roles.includes(EQUICORD_HELPERS) || false;
}
export function removeFromArray(arr, predicate) {
    const idx = arr.findIndex(predicate);
    if (idx !== -1)
        arr.splice(idx, 1);
}
export function getUserAvatarUrl(user, guildId, canAnimate, size) {
    const memberAvatar = guildId ? GuildMemberStore.getMember(guildId, user.id)?.avatar || null : null;
    if (memberAvatar) {
        return IconUtils.getGuildMemberAvatarURLSimple({
            guildId: guildId,
            userId: user.id,
            avatar: memberAvatar,
            canAnimate,
            size
        });
    }
    return IconUtils.getUserAvatarURL(user, canAnimate, size) ?? IconUtils.getDefaultAvatarURL(user.id, user?.discriminator);
}
