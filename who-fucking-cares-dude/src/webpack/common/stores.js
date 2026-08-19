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
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { waitForStore } from "./internal";
export const Flux = findByPropsLazy("connectStores");
export const DraftType = findByPropsLazy("ChannelMessage", "SlashCommand");
export let MessageStore;
export let PermissionStore;
export let GuildChannelStore;
export let ReadStateStore;
export let PresenceStore;
export let AccessibilityStore;
export let PendingReplyStore;
export let GuildStore;
export let GuildRoleStore;
export let GuildScheduledEventStore;
export let GuildMemberCountStore;
export let GuildMemberStore;
export let UserStore;
export let AuthenticationStore;
export let ApplicationStore;
export let UserProfileStore;
export let SelectedChannelStore;
export let SelectedGuildStore;
export let ChannelStore;
export let TypingStore;
export let RelationshipStore;
export let VoiceStateStore;
export let EmojiStore;
export let StickersStore;
export let ThemeStore;
export let WindowStore;
export let DraftStore;
export let StreamerModeStore;
export let SpotifyStore;
export let MediaEngineStore;
export let NotificationSettingsStore;
export let SpellCheckStore;
export let UploadAttachmentStore;
export let OverridePremiumTypeStore;
export let RunningGameStore;
export let ActiveJoinedThreadsStore;
export let UserGuildSettingsStore;
export let UserSettingsProtoStore;
export let CallStore;
export let ChannelRTCStore;
export let FriendsStore;
export let InstantInviteStore;
export let InviteStore;
export let LocaleStore;
export let RTCConnectionStore;
export let SoundboardStore;
export let PopoutWindowStore;
export let ApplicationCommandIndexStore;
export let EditMessageStore;
export let QuestStore;
export let ExperimentStore;
export let UserAffinitiesStore;
export let ApplicationStreamingStore;
export let ApplicationStreamPreviewStore;
export let SortedGuildStore;
export let JoinedThreadsStore;
export let SafetyHubStore;
export let PrivateChannelSortStore;
export let ApplicationStreamingSettingsStore;
export let UserProfileSettingsStore;
export let AuthorizedAppsStore;
export let ChannelSectionStore;
export let ExpandedGuildFolderStore;
export let AuthSessionsStore;
export let ClientThemesBackgroundStore;
export let ConnectedAccountsStore;
export let ChannelMemberStore;
export let ThreadMemberListStore;
export let CollapsedVoiceChannelStore;
export let ReferencedMessageStore;
export let SessionsStore;
export let GuildAvailabilityStore;
export let UserGuildJoinRequestStore;
export let BasicGuildStore;
/**
 * @see jsdoc of {@link t.useStateFromStores}
 */
export const useStateFromStores = findByCodeLazy("useStateFromStores");
waitForStore("AccessibilityStore", s => AccessibilityStore = s);
waitForStore("ApplicationStore", s => ApplicationStore = s);
waitForStore("AuthenticationStore", s => AuthenticationStore = s);
waitForStore("DraftStore", s => DraftStore = s);
waitForStore("UserStore", s => UserStore = s);
waitForStore("UserProfileStore", m => UserProfileStore = m);
waitForStore("ChannelStore", m => ChannelStore = m);
waitForStore("SelectedChannelStore", m => SelectedChannelStore = m);
waitForStore("SelectedGuildStore", m => SelectedGuildStore = m);
waitForStore("GuildStore", m => GuildStore = m);
waitForStore("GuildMemberStore", m => GuildMemberStore = m);
waitForStore("RelationshipStore", m => RelationshipStore = m);
waitForStore("MediaEngineStore", m => MediaEngineStore = m);
waitForStore("NotificationSettingsStore", m => NotificationSettingsStore = m);
waitForStore("SpellcheckStore", m => SpellCheckStore = m);
waitForStore("PermissionStore", m => PermissionStore = m);
waitForStore("PresenceStore", m => PresenceStore = m);
waitForStore("ReadStateStore", m => ReadStateStore = m);
waitForStore("GuildChannelStore", m => GuildChannelStore = m);
waitForStore("GuildRoleStore", m => GuildRoleStore = m);
waitForStore("GuildScheduledEventStore", m => GuildScheduledEventStore = m);
waitForStore("GuildMemberCountStore", m => GuildMemberCountStore = m);
waitForStore("MessageStore", m => MessageStore = m);
waitForStore("WindowStore", m => WindowStore = m);
waitForStore("EmojiStore", m => EmojiStore = m);
waitForStore("StickersStore", m => StickersStore = m);
waitForStore("TypingStore", m => TypingStore = m);
waitForStore("VoiceStateStore", m => VoiceStateStore = m);
waitForStore("StreamerModeStore", m => StreamerModeStore = m);
waitForStore("SpotifyStore", m => SpotifyStore = m);
waitForStore("OverridePremiumTypeStore", m => OverridePremiumTypeStore = m);
waitForStore("UploadAttachmentStore", m => UploadAttachmentStore = m);
waitForStore("RunningGameStore", m => RunningGameStore = m);
waitForStore("ActiveJoinedThreadsStore", m => ActiveJoinedThreadsStore = m);
waitForStore("UserGuildSettingsStore", m => UserGuildSettingsStore = m);
waitForStore("UserSettingsProtoStore", m => UserSettingsProtoStore = m);
waitForStore("CallStore", m => CallStore = m);
waitForStore("ChannelRTCStore", m => ChannelRTCStore = m);
waitForStore("FriendsStore", m => FriendsStore = m);
waitForStore("InstantInviteStore", m => InstantInviteStore = m);
waitForStore("InviteStore", m => InviteStore = m);
waitForStore("LocaleStore", m => LocaleStore = m);
waitForStore("RTCConnectionStore", m => RTCConnectionStore = m);
waitForStore("SoundboardStore", m => SoundboardStore = m);
waitForStore("PopoutWindowStore", m => PopoutWindowStore = m);
waitForStore("PendingReplyStore", m => PendingReplyStore = m);
waitForStore("ApplicationCommandIndexStore", m => ApplicationCommandIndexStore = m);
waitForStore("EditMessageStore", m => EditMessageStore = m);
waitForStore("ExperimentStore", m => ExperimentStore = m);
waitForStore("QuestStore", m => QuestStore = m);
waitForStore("UserAffinitiesV2Store", m => UserAffinitiesStore = m);
waitForStore("ApplicationStreamingStore", m => ApplicationStreamingStore = m);
waitForStore("ApplicationStreamPreviewStore", m => ApplicationStreamPreviewStore = m);
waitForStore("SortedGuildStore", m => SortedGuildStore = m);
waitForStore("JoinedThreadsStore", m => JoinedThreadsStore = m);
waitForStore("SafetyHubStore", m => SafetyHubStore = m);
waitForStore("PrivateChannelSortStore", m => PrivateChannelSortStore = m);
waitForStore("ApplicationStreamingSettingsStore", m => ApplicationStreamingSettingsStore = m);
waitForStore("UserProfileSettingsStore", m => UserProfileSettingsStore = m);
waitForStore("AuthorizedAppsStore", m => AuthorizedAppsStore = m);
waitForStore("ChannelSectionStore", m => ChannelSectionStore = m);
waitForStore("ExpandedGuildFolderStore", m => ExpandedGuildFolderStore = m);
waitForStore("AuthSessionsStore", m => AuthSessionsStore = m);
waitForStore("ClientThemesBackgroundStore", m => ClientThemesBackgroundStore = m);
waitForStore("ConnectedAccountsStore", m => ConnectedAccountsStore = m);
waitForStore("ChannelMemberStore", m => ChannelMemberStore = m);
waitForStore("ThreadMemberListStore", m => ThreadMemberListStore = m);
waitForStore("CollapsedVoiceChannelStore", m => CollapsedVoiceChannelStore = m);
waitForStore("ReferencedMessageStore", m => ReferencedMessageStore = m);
waitForStore("SessionsStore", m => SessionsStore = m);
waitForStore("GuildAvailabilityStore", m => GuildAvailabilityStore = m);
waitForStore("UserGuildJoinRequestStore", m => UserGuildJoinRequestStore = m);
waitForStore("BasicGuildStore", m => BasicGuildStore = m);
waitForStore("ThemeStore", m => {
    ThemeStore = m;
    // Importing this directly causes all webpack commons to be imported, which can easily cause circular dependencies.
    // For this reason, use a non import access here.
    Vencord.Api.Themes.initQuickCssThemeStore(m);
});
