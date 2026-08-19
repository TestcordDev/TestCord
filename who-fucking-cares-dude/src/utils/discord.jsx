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
import { ChannelActionCreators, ChannelStore, ComponentDispatch, Constants, FluxDispatcher, GuildStore, i18n, InviteActions, MessageActions, openMediaModal, RestAPI, SelectedChannelStore, SelectedGuildStore, Toasts, UserProfileActions, UserProfileStore, UserSettingsActionCreators, UserUtils } from "@webpack/common";
import { copyToClipboard } from "./clipboard";
import { runtimeHashMessageKey } from "./intlHash";
import { Logger } from "./Logger";
const IntlManagerLogger = new Logger("IntlManager");
/**
 * Get an internationalized message from a non hashed key
 * @param key The plain message key
 * @param values The values to interpolate, if it's a rich message
 */
export function getIntlMessage(key, values) {
    return getIntlMessageFromHash(runtimeHashMessageKey(key), values, key);
}
/**
 * Get an internationalized message from a hashed key
 * @param hashedKey The hashed message key
 * @param values The values to interpolate, if it's a rich message
 */
export function getIntlMessageFromHash(hashedKey, values, originalKey) {
    try {
        return values == null ? i18n.intl.string(i18n.t[hashedKey]) : i18n.intl.format(i18n.t[hashedKey], values);
    }
    catch (e) {
        IntlManagerLogger.error(`Failed to get intl message for key: ${originalKey ?? hashedKey}`, e);
        return originalKey ?? "";
    }
}
/**
 * Open the invite modal
 * @param code The invite code
 * @returns Whether the invite was accepted
 */
export async function openInviteModal(code) {
    const { invite } = await InviteActions.resolveInvite(code, "Desktop Modal");
    if (!invite)
        throw new Error("Invalid invite: " + code);
    FluxDispatcher.dispatch({
        type: "INVITE_MODAL_OPEN",
        invite,
        code,
        context: "APP"
    });
    return new Promise(r => {
        let onClose, onAccept;
        let inviteAccepted = false;
        FluxDispatcher.subscribe("INVITE_ACCEPT", onAccept = () => {
            inviteAccepted = true;
        });
        FluxDispatcher.subscribe("INVITE_MODAL_CLOSE", onClose = () => {
            FluxDispatcher.unsubscribe("INVITE_MODAL_CLOSE", onClose);
            FluxDispatcher.unsubscribe("INVITE_ACCEPT", onAccept);
            r(inviteAccepted);
        });
    });
}
export function getCurrentChannel() {
    return ChannelStore.getChannel(SelectedChannelStore.getChannelId());
}
export function getCurrentGuild() {
    return GuildStore.getGuild(getCurrentChannel()?.guild_id);
}
export function openPrivateChannel(userId, navigateToChannel = true) {
    return ChannelActionCreators.openPrivateChannel({ recipientIds: [userId], navigateToChannel });
}
export function getTheme() {
    try {
        return UserSettingsActionCreators.PreloadedUserSettingsActionCreators.getCurrentValue()?.appearance?.theme;
    }
    catch {
        return 1 /* Theme.Dark */;
    }
}
export function insertTextIntoChatInputBox(text) {
    ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
        rawText: text,
        plainText: text
    });
}
export async function copyWithToast(text, toastMessage = "Copied to clipboard!") {
    await copyToClipboard(text);
    Toasts.show({
        message: toastMessage,
        id: Toasts.genId(),
        type: Toasts.Type.SUCCESS
    });
}
export function sendMessage(channelId, data, waitForChannelReady = true, options = {}) {
    const messageData = {
        content: "",
        invalidEmojis: [],
        tts: false,
        validNonShortcutEmojis: [],
        ...data
    };
    return MessageActions.sendMessage(channelId, messageData, waitForChannelReady, options);
}
/**
 * You must specify either height or width in the item
 */
export function openImageModal(item, mediaModalProps) {
    return openMediaModal({
        items: [{
                type: "IMAGE",
                original: item.original ?? item.url,
                ...item,
            }],
        ...mediaModalProps
    });
}
export async function openUserProfile(id) {
    const user = await UserUtils.getUser(id);
    if (!user)
        throw new Error("No such user: " + id);
    const guildId = SelectedGuildStore.getGuildId();
    UserProfileActions.openUserProfileModal({
        userId: id,
        guildId,
        channelId: SelectedChannelStore.getChannelId(),
        analyticsLocation: {
            page: guildId ? "Guild Channel" : "DM Channel",
            section: "Profile Popout"
        }
    });
}
/**
 * Fetch a user's profile
 */
export async function fetchUserProfile(id, options, cache = true) {
    const cached = UserProfileStore.getUserProfile(id);
    if (cached && cache)
        return cached;
    FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_START", userId: id });
    const { body } = await RestAPI.get({
        url: Constants.Endpoints.USER_PROFILE(id),
        query: {
            with_mutual_guilds: false,
            with_mutual_friends_count: false,
            ...options
        },
        oldFormErrors: true,
    });
    FluxDispatcher.dispatch({ type: "USER_UPDATE", user: body.user });
    await FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_SUCCESS", userProfile: body });
    if (options?.guild_id && body.guild_member)
        FluxDispatcher.dispatch({ type: "GUILD_MEMBER_PROFILE_UPDATE", guildId: options.guild_id, guildMember: body.guild_member });
    return UserProfileStore.getUserProfile(id);
}
/**
 * Get the unique username for a user. Returns user.username for pomelo people, user.tag otherwise
 */
export function getUniqueUsername(user) {
    return user.discriminator === "0" ? user.username : user.tag;
}
// Discord has a similar function in their code
export function getGuildAcronym(guild) {
    return guild.name
        .replaceAll("'s ", " ")
        .replace(/\w+/g, m => m[0])
        .replace(/\s/g, "");
}
export function hasGuildFeature(guild, feature) {
    return guild.features?.has(feature) ?? false;
}
