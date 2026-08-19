/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export const defaultQuestTileUnclaimedColor = 2842239;
export const defaultQuestTileClaimedColor = 6105983;
export const defaultQuestTileIgnoredColor = 8334124;
export const defaultQuestTileExpiredColor = 2368553;
export const defaultQuestTileGradient = "intense";
export const defaultQuestTilePreload = true;
export const defaultQuestTileUnclaimedColorSetting = { enabled: true, color: defaultQuestTileUnclaimedColor };
export const defaultQuestTileClaimedColorSetting = { enabled: true, color: defaultQuestTileClaimedColor };
export const defaultQuestTileIgnoredColorSetting = { enabled: true, color: defaultQuestTileIgnoredColor };
export const defaultQuestTileExpiredColorSetting = { enabled: true, color: defaultQuestTileExpiredColor };
export const defaultQuestOrder = ["UNCLAIMED", "CLAIMED", "IGNORED", "EXPIRED"];
export const defaultQuestButtonBadgeColor = defaultQuestTileUnclaimedColor;
export const defaultQuestButtonDisplay = "always";
export const defaultQuestButtonIndicator = "both";
export const defaultLeftClickAction = "open-quests";
export const defaultMiddleClickAction = "plugin-settings";
export const defaultRightClickAction = "context-menu";
export const defaultDisableQuestsEverything = false;
export const defaultDisableRelocationNotices = true;
export const defaultDisableSponsoredBanner = false;
export const defaultDisableAccountPanelPromo = true;
export const defaultDisableAccountPanelQuestProgress = false;
export const defaultDisableOrbsAndQuestsBadges = false;
export const defaultDisableFriendsListPromo = true;
export const defaultDisableMembersListPromo = true;
export const defaultResumeInterruptedQuests = false;
export const defaultAllowChangingDangerousSettings = false; // true -> Risky
export const defaultAcknowledgedNotices = {};
export const defaultMakeMobileVideoQuestsDesktopCompatible = false; // true -> Risky
export const defaultCompleteVideoQuestsQuicker = false; // true -> Risky
export const defaultPreventVideoQuestsPausing = false; // true -> Risky
export const defaultAutoCompleteQuestsSimultaneously = false; // true -> Risky
export const defaultNotifyOnQuestComplete = true;
export const defaultNotifyOnNewQuests = true;
export const defaultNotifyOnNewExcludedQuests = false;
export const defaultQuestCompletedAlertSound = "bop_message1";
export const defaultQuestCompletedAlertVolume = 100;
const questTaskTypes = [
    "WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */,
    "WATCH_VIDEO_ON_MOBILE" /* QuestTaskType.WATCH_VIDEO_ON_MOBILE */,
    "ACHIEVEMENT_IN_ACTIVITY" /* QuestTaskType.ACHIEVEMENT_IN_ACTIVITY */,
    "ACHIEVEMENT_IN_GAME" /* QuestTaskType.ACHIEVEMENT_IN_GAME */,
    "PLAY_ACTIVITY" /* QuestTaskType.PLAY_ACTIVITY */,
    "PLAY_ON_DESKTOP" /* QuestTaskType.PLAY_ON_DESKTOP */,
    "PLAY_ON_DESKTOP_V2" /* QuestTaskType.PLAY_ON_DESKTOP_V2 */,
    "STREAM_ON_DESKTOP" /* QuestTaskType.STREAM_ON_DESKTOP */,
    "PLAY_ON_PLAYSTATION" /* QuestTaskType.PLAY_ON_PLAYSTATION */,
    "PLAY_ON_XBOX" /* QuestTaskType.PLAY_ON_XBOX */,
];
export const autoCompleteQuestTaskTypes = [
    "PLAY_ON_DESKTOP" /* QuestTaskType.PLAY_ON_DESKTOP */,
    "PLAY_ON_XBOX" /* QuestTaskType.PLAY_ON_XBOX */,
    "PLAY_ON_PLAYSTATION" /* QuestTaskType.PLAY_ON_PLAYSTATION */,
    "PLAY_ACTIVITY" /* QuestTaskType.PLAY_ACTIVITY */,
    "WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */,
    "WATCH_VIDEO_ON_MOBILE" /* QuestTaskType.WATCH_VIDEO_ON_MOBILE */,
    "ACHIEVEMENT_IN_ACTIVITY" /* QuestTaskType.ACHIEVEMENT_IN_ACTIVITY */,
];
const desktopOnlyAutoCompleteQuestTypes = new Set([
    "PLAY_ON_DESKTOP" /* QuestTaskType.PLAY_ON_DESKTOP */,
    "PLAY_ON_PLAYSTATION" /* QuestTaskType.PLAY_ON_PLAYSTATION */,
    "PLAY_ON_XBOX" /* QuestTaskType.PLAY_ON_XBOX */,
    "PLAY_ACTIVITY" /* QuestTaskType.PLAY_ACTIVITY */,
]);
export function isDesktopCompatible(questType) {
    return IS_DISCORD_DESKTOP || !desktopOnlyAutoCompleteQuestTypes.has(questType);
}
export const defaultAutoCompleteQuestTypes = Object.fromEntries(autoCompleteQuestTaskTypes.map(questType => [questType, false]));
export const defaultQuestButtonIncludedTypes = {
    ...Object.fromEntries(questTaskTypes.map(questType => [questType, true])),
    [1 /* QuestRewardType.REWARD_CODE */]: true,
    [2 /* QuestRewardType.IN_GAME */]: true,
    [3 /* QuestRewardType.COLLECTIBLE */]: true,
    [4 /* QuestRewardType.VIRTUAL_CURRENCY */]: true,
    [5 /* QuestRewardType.FRACTIONAL_PREMIUM */]: true,
};
export const defaultQuestButtonBadgeCount = 0;
export const defaultQuestFetchInterval = 2700;
export const defaultNewQuestAlertSound = "discodo";
export const defaultNewQuestAlertVolume = 100;
export const defaultNewExcludedQuestAlertSound = null;
export const defaultNewExcludedQuestAlertVolume = 100;
export const defaultUnclaimedSubsort = "Expiring ASC";
export const defaultClaimedSubsort = "Claimed DESC";
export const defaultIgnoredSubsort = "Recent DESC";
export const defaultExpiredSubsort = "Expiring DESC";
export const defaultIsOnQuestsPage = false;
export const defaultRememberQuestPageSort = true;
export const defaultRememberQuestPageFilters = true;
export const defaultLastQuestPageSort = "questify";
export const defaultLastQuestPageFilters = {};
export const ignoredQuestIDsKey = "questIDs";
export const defaultIgnoredQuestIDs = { [ignoredQuestIDsKey]: [] };
export const defaultResumeQuestIDs = {};
