/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings, PlainSettings, SettingsStore } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { QuestButtonSetting } from "../components/questButtonSettings";
import { QuestFeaturesSetting } from "../components/questFeaturesSetting";
import { QuestNotificationsSetting } from "../components/questNotificationsSetting";
import { QuestTilesSetting } from "../components/questTilesSetting";
import { ReorderQuestsSetting } from "../components/reorderQuestsSetting";
import { defaultAcknowledgedNotices, defaultAllowChangingDangerousSettings, defaultAutoCompleteQuestsSimultaneously, defaultAutoCompleteQuestTypes, defaultClaimedSubsort, defaultCompleteVideoQuestsQuicker, defaultDisableAccountPanelPromo, defaultDisableAccountPanelQuestProgress, defaultDisableFriendsListPromo, defaultDisableMembersListPromo, defaultDisableOrbsAndQuestsBadges, defaultDisableQuestsEverything, defaultDisableRelocationNotices, defaultDisableSponsoredBanner, defaultExpiredSubsort, defaultIgnoredQuestIDs, defaultIgnoredSubsort, defaultIsOnQuestsPage, defaultLastQuestPageFilters, defaultLastQuestPageSort, defaultLeftClickAction, defaultMakeMobileVideoQuestsDesktopCompatible, defaultMiddleClickAction, defaultNewExcludedQuestAlertSound, defaultNewExcludedQuestAlertVolume, defaultNewQuestAlertSound, defaultNewQuestAlertVolume, defaultNotifyOnNewExcludedQuests, defaultNotifyOnNewQuests, defaultNotifyOnQuestComplete, defaultPreventVideoQuestsPausing, defaultQuestButtonBadgeColor, defaultQuestButtonBadgeCount, defaultQuestButtonDisplay, defaultQuestButtonIncludedTypes, defaultQuestButtonIndicator, defaultQuestCompletedAlertSound, defaultQuestCompletedAlertVolume, defaultQuestFetchInterval, defaultQuestOrder, defaultQuestTileClaimedColorSetting, defaultQuestTileExpiredColorSetting, defaultQuestTileGradient, defaultQuestTileIgnoredColorSetting, defaultQuestTilePreload, defaultQuestTileUnclaimedColorSetting, defaultRememberQuestPageFilters, defaultRememberQuestPageSort, defaultResumeInterruptedQuests, defaultResumeQuestIDs, defaultRightClickAction, defaultUnclaimedSubsort } from "./def";
const MIGRATION_TARGET = 1;
const CURRENT_SETTINGS = PlainSettings.plugins.Questify;
if (CURRENT_SETTINGS) {
    let migrationVersion = CURRENT_SETTINGS.migrationVersion ?? 0;
    // 0 -> 1: Reset Settings
    if (migrationVersion === 0) {
        PlainSettings.plugins.Questify = { enabled: CURRENT_SETTINGS.enabled, migrationVersion: 1 };
        migrationVersion = 1;
    }
    if (migrationVersion !== CURRENT_SETTINGS.migrationVersion) {
        SettingsStore.markAsChanged();
    }
}
export const settings = definePluginSettings({
    migrationVersion: {
        type: 1 /* OptionType.NUMBER */,
        description: "The current migration version of the settings.",
        default: MIGRATION_TARGET,
        hidden: true,
    },
    acknowledgedNotices: {
        type: 7 /* OptionType.CUSTOM */,
        description: "One-time notices that the user has acknowledged.",
        default: { ...defaultAcknowledgedNotices },
        hidden: true,
    },
    questFeatures: {
        type: 6 /* OptionType.COMPONENT */,
        component: ErrorBoundary.wrap(QuestFeaturesSetting),
        description: "Select which Quest features to disable.",
    },
    disableQuestsEverything: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable all Quest features.",
        default: defaultDisableQuestsEverything,
        restartNeeded: true,
        hidden: true,
    },
    disableRelocationNotices: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable Quest relocation notices in the Discovery page.",
        default: defaultDisableRelocationNotices,
        restartNeeded: true,
        hidden: true,
    },
    disableSponsoredBanner: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable the sponsored banner on the Quest page.",
        default: defaultDisableSponsoredBanner,
        restartNeeded: true,
        hidden: true,
    },
    disableAccountPanelPromo: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable the promoted Quest popup above your account panel.",
        default: defaultDisableAccountPanelPromo,
        restartNeeded: true,
        hidden: true,
    },
    disableAccountPanelQuestProgress: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable active and completed Quest progress above your account panel.",
        default: defaultDisableAccountPanelQuestProgress,
        restartNeeded: true,
        hidden: true,
    },
    disableOrbsAndQuestsBadges: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable the Quest badge on user profiles.",
        default: defaultDisableOrbsAndQuestsBadges,
        restartNeeded: true,
        hidden: true,
    },
    disableFriendsListPromo: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable the promotion of Quests for games played by friends.",
        default: defaultDisableFriendsListPromo,
        restartNeeded: true,
        hidden: true,
    },
    disableMembersListPromo: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Disable the actively playing icon in members list items.",
        default: defaultDisableMembersListPromo,
        restartNeeded: true,
        hidden: true,
    },
    allowChangingDangerousSettings: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Allow changing dangerous settings.",
        default: defaultAllowChangingDangerousSettings,
        hidden: true,
    },
    resumeInterruptedQuests: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Resume auto-completing Quests after a reload or restart.",
        default: defaultResumeInterruptedQuests,
        restartNeeded: true,
        hidden: true,
    },
    makeMobileVideoQuestsDesktopCompatible: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Make mobile-only Video Quests compatible with desktop.",
        default: defaultMakeMobileVideoQuestsDesktopCompatible,
        restartNeeded: true,
        hidden: true,
    },
    autoCompleteQuestsSimultaneously: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Complete Quests simultaneously rather than sequentially.",
        default: defaultAutoCompleteQuestsSimultaneously,
        restartNeeded: true,
        hidden: true,
    },
    completeVideoQuestsQuicker: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Use Discord's progress leeway and elapsed enrollment time for Video Quest auto-completion.",
        default: defaultCompleteVideoQuestsQuicker,
        restartNeeded: true,
        hidden: true,
    },
    preventVideoQuestsPausing: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Prevent pausing the video when the Quest modal loses focus.",
        default: defaultPreventVideoQuestsPausing,
        restartNeeded: true,
        hidden: true,
    },
    autoCompleteQuestTypes: {
        type: 7 /* OptionType.CUSTOM */,
        description: "Which types of Quests to auto-complete in the background.",
        default: defaultAutoCompleteQuestTypes,
        restartNeeded: true,
        hidden: true,
    },
    questButton: {
        type: 6 /* OptionType.COMPONENT */,
        component: ErrorBoundary.wrap(QuestButtonSetting),
        description: "Customize the Quest button in the server list.",
    },
    questButtonDisplay: {
        type: 7 /* OptionType.CUSTOM */,
        description: "Which display type to use for the Quest button in the server list.",
        default: defaultQuestButtonDisplay,
        restartNeeded: true,
        hidden: true,
    },
    questButtonIncludedTypes: {
        type: 7 /* OptionType.CUSTOM */,
        description: "Which reward types and Quest types to include when displaying Quest counts on the Quest button.",
        default: defaultQuestButtonIncludedTypes,
        hidden: true,
    },
    questButtonIndicator: {
        type: 7 /* OptionType.CUSTOM */,
        description: "Which display type to use for the unclaimed indicator on the Quest button in the server list.",
        default: defaultQuestButtonIndicator,
        hidden: true,
    },
    questButtonBadgeCount: {
        type: 1 /* OptionType.NUMBER */,
        description: "The current number of relevant unclaimed Quests.",
        default: defaultQuestButtonBadgeCount,
        hidden: true,
    },
    questButtonBadgeColor: {
        type: 1 /* OptionType.NUMBER */ | 7 /* OptionType.CUSTOM */,
        description: "The color of the Quest button badge in the server list.",
        default: defaultQuestButtonBadgeColor,
        hidden: true,
    },
    questButtonLeftClickAction: {
        type: 7 /* OptionType.CUSTOM */,
        description: "The action to perform when left-clicking the Quest button in the server list.",
        default: defaultLeftClickAction,
        hidden: true,
    },
    questButtonMiddleClickAction: {
        type: 7 /* OptionType.CUSTOM */,
        description: "The action to perform when middle-clicking the Quest button in the server list.",
        default: defaultMiddleClickAction,
        hidden: true,
    },
    questButtonRightClickAction: {
        type: 7 /* OptionType.CUSTOM */,
        description: "The action to perform when right-clicking the Quest button in the server list.",
        default: defaultRightClickAction,
        hidden: true,
    },
    questNotifications: {
        type: 6 /* OptionType.COMPONENT */,
        component: ErrorBoundary.wrap(QuestNotificationsSetting),
        description: "Configure Quest completed and new Quest detected notifications.",
    },
    notifyOnQuestComplete: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a notification when a Quest is completed.",
        default: defaultNotifyOnQuestComplete,
        hidden: true,
    },
    notifyOnNewQuests: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a notification when new Quests are detected.",
        default: defaultNotifyOnNewQuests,
        hidden: true,
    },
    notifyOnNewExcludedQuests: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a notification when new excluded Quests are detected.",
        default: defaultNotifyOnNewExcludedQuests,
        hidden: true,
    },
    questCompletedAlertSound: {
        type: 0 /* OptionType.STRING */ | 7 /* OptionType.CUSTOM */,
        description: "The sound to play when a Quest is completed.",
        default: defaultQuestCompletedAlertSound,
        hidden: true,
    },
    questCompletedAlertVolume: {
        type: 1 /* OptionType.NUMBER */,
        description: "The volume for the Quest completed alert sound.",
        default: defaultQuestCompletedAlertVolume,
        hidden: true,
    },
    questFetchInterval: {
        type: 1 /* OptionType.NUMBER */,
        description: "The interval in seconds to fetch Quests from Discord.",
        default: defaultQuestFetchInterval,
        hidden: true,
    },
    newQuestAlertSound: {
        type: 0 /* OptionType.STRING */ | 7 /* OptionType.CUSTOM */,
        description: "The sound to play when new Quests are detected.",
        default: defaultNewQuestAlertSound,
        hidden: true,
    },
    newQuestAlertVolume: {
        type: 1 /* OptionType.NUMBER */,
        description: "The volume for the new Quest alert sound.",
        default: defaultNewQuestAlertVolume,
        hidden: true,
    },
    newExcludedQuestAlertSound: {
        type: 0 /* OptionType.STRING */ | 7 /* OptionType.CUSTOM */,
        description: "The sound to play when new excluded Quests are detected.",
        default: defaultNewExcludedQuestAlertSound,
        hidden: true,
    },
    newExcludedQuestAlertVolume: {
        type: 1 /* OptionType.NUMBER */,
        description: "The volume for the new excluded Quest alert sound.",
        default: defaultNewExcludedQuestAlertVolume,
        hidden: true,
    },
    questTiles: {
        type: 6 /* OptionType.COMPONENT */,
        component: ErrorBoundary.wrap(QuestTilesSetting),
        description: "Customize the appearance of Quest tiles in the Quests page.",
    },
    questTileUnclaimedColor: {
        type: 7 /* OptionType.CUSTOM */,
        description: "The color of unclaimed Quest tiles in the Quests page.",
        default: { ...defaultQuestTileUnclaimedColorSetting },
        hidden: true,
    },
    questTileClaimedColor: {
        type: 7 /* OptionType.CUSTOM */,
        description: "The color of claimed Quest tiles in the Quests page.",
        default: { ...defaultQuestTileClaimedColorSetting },
        hidden: true,
    },
    questTileIgnoredColor: {
        type: 7 /* OptionType.CUSTOM */,
        description: "The color of ignored Quest tiles in the Quests page.",
        default: { ...defaultQuestTileIgnoredColorSetting },
        hidden: true,
    },
    questTileExpiredColor: {
        type: 7 /* OptionType.CUSTOM */,
        description: "The color of expired Quest tiles in the Quests page.",
        default: { ...defaultQuestTileExpiredColorSetting },
        hidden: true,
    },
    questTileGradient: {
        type: 0 /* OptionType.STRING */,
        description: "Style of the gradient used in the Quest tiles.",
        default: defaultQuestTileGradient,
        hidden: true,
    },
    questTilePreload: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Attempt to preload the assets for the Quest tiles.",
        default: defaultQuestTilePreload,
        hidden: true,
    },
    reorderQuests: {
        type: 6 /* OptionType.COMPONENT */,
        description: "Sort Quests by their status.",
        component: ErrorBoundary.wrap(ReorderQuestsSetting),
    },
    questOrder: {
        type: 7 /* OptionType.CUSTOM */,
        description: "Sort order for Quest status groups.",
        default: Array.from(defaultQuestOrder),
        hidden: true,
    },
    unclaimedSubsort: {
        type: 0 /* OptionType.STRING */,
        description: "Subsort method for unclaimed Quests.",
        default: defaultUnclaimedSubsort,
        hidden: true,
    },
    claimedSubsort: {
        type: 0 /* OptionType.STRING */,
        description: "Subsort method for claimed Quests.",
        default: defaultClaimedSubsort,
        hidden: true,
    },
    ignoredSubsort: {
        type: 0 /* OptionType.STRING */,
        description: "Subsort method for ignored Quests.",
        default: defaultIgnoredSubsort,
        hidden: true,
    },
    expiredSubsort: {
        type: 0 /* OptionType.STRING */,
        description: "Subsort method for expired Quests.",
        default: defaultExpiredSubsort,
        hidden: true,
    },
    isOnQuestsPage: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Whether the user is currently on the Quests page.",
        default: defaultIsOnQuestsPage,
        hidden: true,
    },
    rememberQuestPageSort: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Remember the last used sort on the Quests page.",
        default: defaultRememberQuestPageSort,
        hidden: true,
    },
    rememberQuestPageFilters: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Remember the last used filters on the Quests page.",
        default: defaultRememberQuestPageFilters,
        hidden: true,
    },
    lastQuestPageSort: {
        type: 0 /* OptionType.STRING */,
        description: "Remember the last used sort on the Quests page.",
        default: defaultLastQuestPageSort,
        hidden: true,
    },
    lastQuestPageFilters: {
        type: 7 /* OptionType.CUSTOM */,
        description: "Remember the last used filters on the Quests page.",
        default: defaultLastQuestPageFilters,
        hidden: true,
    },
    ignoredQuestIDs: {
        type: 7 /* OptionType.CUSTOM */,
        description: "An array of Quest IDs that are ignored.",
        default: defaultIgnoredQuestIDs,
        hidden: true,
    },
    resumeQuestIDs: {
        type: 7 /* OptionType.CUSTOM */,
        description: "An array of Quest IDs that are being or are queued to be auto-completed in the background.",
        default: defaultResumeQuestIDs,
        hidden: true,
    },
});
