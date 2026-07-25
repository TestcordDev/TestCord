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

import * as t from "@vencord/discord-types";
import { findByCodeLazy, findByPropsLazy, waitFor } from "@webpack";

export const Flux: t.Flux = findByPropsLazy("connectStores");

export type GenericStore = t.FluxStore & Record<string, any>;

export const DraftType = findByPropsLazy("ChannelMessage", "SlashCommand");

export let MessageStore: Omit<t.MessageStore, "getMessages"> & GenericStore & {
    getMessages(chanId: string): any;
};

export let PermissionStore: t.PermissionStore;
export let GuildChannelStore: t.GuildChannelStore;
export let ReadStateStore: t.ReadStateStore;
export let PresenceStore: t.PresenceStore;
export let AccessibilityStore: t.AccessibilityStore;
export let PendingReplyStore: t.PendingReplyStore;

export let GuildStore: t.GuildStore;
export let GuildRoleStore: t.GuildRoleStore;
export let GuildScheduledEventStore: t.GuildScheduledEventStore;
export let GuildMemberCountStore: t.GuildMemberCountStore;
export let GuildMemberStore: t.GuildMemberStore;
export let UserStore: t.UserStore;
export let AuthenticationStore: t.AuthenticationStore;
export let ApplicationStore: t.ApplicationStore;
export let UserProfileStore: t.UserProfileStore;
export let SelectedChannelStore: t.SelectedChannelStore;
export let SelectedGuildStore: t.SelectedGuildStore;
export let ChannelStore: t.ChannelStore;
export let TypingStore: t.TypingStore;
export let RelationshipStore: t.RelationshipStore;
export let VoiceStateStore: t.VoiceStateStore;

export let EmojiStore: t.EmojiStore;
export let StickersStore: t.StickersStore;
export let ThemeStore: t.ThemeStore;
export let WindowStore: t.WindowStore;
export let DraftStore: t.DraftStore;
export let StreamerModeStore: t.StreamerModeStore;
export let SpotifyStore: t.SpotifyStore;

export let MediaEngineStore: t.MediaEngineStore;
export let NotificationSettingsStore: t.NotificationSettingsStore;
export let SpellCheckStore: t.SpellCheckStore;
export let UploadAttachmentStore: t.UploadAttachmentStore;
export let OverridePremiumTypeStore: t.OverridePremiumTypeStore;
export let RunningGameStore: t.RunningGameStore;
export let ActiveJoinedThreadsStore: t.ActiveJoinedThreadsStore;
export let UserGuildSettingsStore: t.UserGuildSettingsStore;
export let UserSettingsProtoStore: t.UserSettingsProtoStore;
export let CallStore: t.CallStore;
export let ChannelRTCStore: t.ChannelRTCStore;
export let FriendsStore: t.FriendsStore;
export let InstantInviteStore: t.InstantInviteStore;
export let InviteStore: t.InviteStore;
export let LocaleStore: t.LocaleStore;
export let RTCConnectionStore: t.RTCConnectionStore;
export let SoundboardStore: t.SoundboardStore;
export let PopoutWindowStore: t.PopoutWindowStore;
export let ApplicationCommandIndexStore: t.ApplicationCommandIndexStore;
export let EditMessageStore: t.EditMessageStore;
export let QuestStore: t.QuestStore;
export let ExperimentStore: t.ExperimentStore;
export let UserAffinitiesStore: t.UserAffinitiesStore;
export let ApplicationStreamingStore: t.ApplicationStreamingStore;
export let ApplicationStreamPreviewStore: t.ApplicationStreamPreviewStore;

/**
 * @see jsdoc of {@link t.useStateFromStores}
 */
export const useStateFromStores: t.useStateFromStores = findByCodeLazy("useStateFromStores");

const storeAssignments: Record<string, (s: any) => void> = {
    AccessibilityStore: s => AccessibilityStore = s,
    ApplicationStore: s => ApplicationStore = s,
    AuthenticationStore: s => AuthenticationStore = s,
    DraftStore: s => DraftStore = s,
    UserStore: s => UserStore = s,
    UserProfileStore: m => UserProfileStore = m,
    ChannelStore: m => ChannelStore = m,
    SelectedChannelStore: m => SelectedChannelStore = m,
    SelectedGuildStore: m => SelectedGuildStore = m,
    GuildStore: m => GuildStore = m,
    GuildMemberStore: m => GuildMemberStore = m,
    RelationshipStore: m => RelationshipStore = m,
    MediaEngineStore: m => MediaEngineStore = m,
    NotificationSettingsStore: m => NotificationSettingsStore = m,
    SpellcheckStore: m => SpellCheckStore = m,
    PermissionStore: m => PermissionStore = m,
    PresenceStore: m => PresenceStore = m,
    ReadStateStore: m => ReadStateStore = m,
    GuildChannelStore: m => GuildChannelStore = m,
    GuildRoleStore: m => GuildRoleStore = m,
    GuildScheduledEventStore: m => GuildScheduledEventStore = m,
    GuildMemberCountStore: m => GuildMemberCountStore = m,
    MessageStore: m => MessageStore = m,
    WindowStore: m => WindowStore = m,
    EmojiStore: m => EmojiStore = m,
    StickersStore: m => StickersStore = m,
    ThemeStore: m => ThemeStore = m,
    TypingStore: m => TypingStore = m,
    VoiceStateStore: m => VoiceStateStore = m,
    StreamerModeStore: m => StreamerModeStore = m,
    SpotifyStore: m => SpotifyStore = m,
    OverridePremiumTypeStore: m => OverridePremiumTypeStore = m,
    UploadAttachmentStore: m => UploadAttachmentStore = m,
    RunningGameStore: m => RunningGameStore = m,
    ActiveJoinedThreadsStore: m => ActiveJoinedThreadsStore = m,
    UserGuildSettingsStore: m => UserGuildSettingsStore = m,
    UserSettingsProtoStore: m => UserSettingsProtoStore = m,
    CallStore: m => CallStore = m,
    ChannelRTCStore: m => ChannelRTCStore = m,
    FriendsStore: m => FriendsStore = m,
    InstantInviteStore: m => InstantInviteStore = m,
    InviteStore: m => InviteStore = m,
    LocaleStore: m => LocaleStore = m,
    RTCConnectionStore: m => RTCConnectionStore = m,
    SoundboardStore: m => SoundboardStore = m,
    PopoutWindowStore: m => PopoutWindowStore = m,
    PendingReplyStore: m => PendingReplyStore = m,
    ApplicationCommandIndexStore: m => ApplicationCommandIndexStore = m,
    EditMessageStore: m => EditMessageStore = m,
    ExperimentStore: m => ExperimentStore = m,
    QuestStore: m => QuestStore = m,
    UserAffinitiesV2Store: m => UserAffinitiesStore = m,
    ApplicationStreamingStore: m => ApplicationStreamingStore = m,
    ApplicationStreamPreviewStore: m => ApplicationStreamPreviewStore = m,
};

const storeNames = Object.keys(storeAssignments);
const unassignedStores = new Set(storeNames);

waitFor(m => {
    const name = m.constructor?.displayName as string;
    if (name && unassignedStores.has(name)) {
        storeAssignments[name](m);
        unassignedStores.delete(name);
        if (name === "ThemeStore") {
            (Vencord as any).QuickCss?.initQuickCssThemeStore();
        }
    }
    return unassignedStores.size === 0;
}, () => {});
