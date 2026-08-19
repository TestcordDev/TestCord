/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { enabledOnStartup } from "..";
import { getQuestifySettings, useQuestifySettings } from "../settings/access";
import { startAutoFetchingQuests } from "../settings/fetching";
import { validateIgnoredQuests } from "../settings/ignoredQuests";
import { canShowBadge, canShowButton, canShowPill } from "../utils/ui";
import { DummyQuestButton } from "./questButton";
import { SettingsCard, SettingsColorPicker, SettingsDescription, SettingsHeader, SettingsRow, SettingsRowItem, SettingsSelect, SettingsSubheader } from "./shared";
const questButtonDisplayOptions = [
    { label: "Always", value: "always" },
    { label: "Unclaimed", value: "unclaimed" },
    { label: "Never", value: "never" },
];
const questButtonIndicatorOptions = [
    { label: "Pill", value: "pill" },
    { label: "Badge", value: "badge" },
    { label: "Both", value: "both" },
    { label: "None", value: "none" },
];
const questButtonClickOptions = [
    { label: "Open Quests", value: "open-quests" },
    { label: "Context Menu", value: "context-menu" },
    { label: "Plugin Settings", value: "plugin-settings" },
    { label: "Nothing", value: "nothing" },
];
const questButtonRewardTypeOptions = [
    { label: "Orbs", value: 4 /* QuestRewardType.VIRTUAL_CURRENCY */ },
    { label: "Nitro Codes", value: 5 /* QuestRewardType.FRACTIONAL_PREMIUM */ },
    { label: "Reward Codes", value: 1 /* QuestRewardType.REWARD_CODE */ },
    { label: "In Game Items", value: 2 /* QuestRewardType.IN_GAME */ },
    { label: "Profile Collectibles", value: 3 /* QuestRewardType.COLLECTIBLE */ },
];
const questButtonQuestTypeOptions = [
    { label: "Watch Video", value: "WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */ },
    { label: "Watch Video on Mobile", value: "WATCH_VIDEO_ON_MOBILE" /* QuestTaskType.WATCH_VIDEO_ON_MOBILE */ },
    { label: "Achievement in Activity", value: "ACHIEVEMENT_IN_ACTIVITY" /* QuestTaskType.ACHIEVEMENT_IN_ACTIVITY */ },
    { label: "Achievement in Game", value: "ACHIEVEMENT_IN_GAME" /* QuestTaskType.ACHIEVEMENT_IN_GAME */ },
    { label: "Play Activity", value: "PLAY_ACTIVITY" /* QuestTaskType.PLAY_ACTIVITY */ },
    { label: "Play on Desktop", value: "PLAY_ON_DESKTOP" /* QuestTaskType.PLAY_ON_DESKTOP */ },
    { label: "Play on Desktop V2", value: "PLAY_ON_DESKTOP_V2" /* QuestTaskType.PLAY_ON_DESKTOP_V2 */ },
    { label: "Stream on Desktop", value: "STREAM_ON_DESKTOP" /* QuestTaskType.STREAM_ON_DESKTOP */ },
    { label: "Play on PlayStation", value: "PLAY_ON_PLAYSTATION" /* QuestTaskType.PLAY_ON_PLAYSTATION */ },
    { label: "Play on Xbox", value: "PLAY_ON_XBOX" /* QuestTaskType.PLAY_ON_XBOX */ },
];
function toManaOptions(options) {
    return options.map(({ label, value }) => ({
        id: String(value),
        label,
        value: String(value),
    }));
}
const questButtonDisplayManaOptions = toManaOptions(questButtonDisplayOptions);
const questButtonIndicatorManaOptions = toManaOptions(questButtonIndicatorOptions);
const questButtonClickManaOptions = toManaOptions(questButtonClickOptions);
const questButtonRewardTypeManaOptions = toManaOptions(questButtonRewardTypeOptions);
const questButtonQuestTypeManaOptions = toManaOptions(questButtonQuestTypeOptions);
export function QuestButtonSetting() {
    const questButton = useQuestifySettings([
        "disableQuestsEverything",
        "questButtonDisplay",
        "questButtonIncludedTypes",
        "questButtonIndicator",
        "questButtonBadgeCount",
        "questButtonBadgeColor",
        "questButtonLeftClickAction",
        "questButtonMiddleClickAction",
        "questButtonRightClickAction",
    ]);
    const disabled = questButton.disableQuestsEverything;
    const includedTypes = questButton.questButtonIncludedTypes;
    const selectedRewardTypes = questButtonRewardTypeOptions
        .filter(({ value }) => includedTypes[value])
        .map(({ value }) => String(value));
    const selectedQuestTypes = questButtonQuestTypeOptions
        .filter(({ value }) => includedTypes[value])
        .map(({ value }) => String(value));
    function updateQuestButtonDisplay(value) {
        if (typeof value !== "string")
            return;
        getQuestifySettings().questButtonDisplay = value;
        startAutoFetchingQuests(true);
    }
    function updateQuestButtonIndicator(value) {
        if (typeof value !== "string")
            return;
        getQuestifySettings().questButtonIndicator = value;
        startAutoFetchingQuests(true);
    }
    function updateQuestButtonAction(key, value) {
        if (typeof value !== "string")
            return;
        getQuestifySettings()[key] = value;
    }
    function updateBadgeColor(value) {
        getQuestifySettings().questButtonBadgeColor = value;
    }
    function updateIncludedTypes(options, value) {
        const selectedValues = new Set(Array.isArray(value) ? value : value ? [value] : []);
        const nextIncludedTypes = { ...getQuestifySettings().questButtonIncludedTypes };
        for (const option of options) {
            nextIncludedTypes[option.value] = selectedValues.has(String(option.value));
        }
        getQuestifySettings().questButtonIncludedTypes = nextIncludedTypes;
        validateIgnoredQuests();
    }
    return (<SettingsCard>
            <SettingsRow>
                <SettingsRowItem>
                    <SettingsHeader> Quest Button </SettingsHeader>
                    <SettingsDescription> Show a Quest Button in the server list with an optional indicator for unclaimed and unignored Quests. </SettingsDescription>
                </SettingsRowItem>
                {enabledOnStartup && <SettingsRowItem width="content">
                    <DummyQuestButton badgeColor={questButton.questButtonBadgeColor} leftClickAction={questButton.questButtonLeftClickAction} middleClickAction={questButton.questButtonMiddleClickAction} rightClickAction={questButton.questButtonRightClickAction} showBadge={canShowBadge(questButton.questButtonIndicator)} showPill={canShowPill(questButton.questButtonIndicator)} visible={canShowButton(questButton.questButtonDisplay)}/>
                </SettingsRowItem>}
            </SettingsRow>
            <SettingsSubheader className="no-top-margin"> Button Behavior </SettingsSubheader>
            <SettingsRow>
                <SettingsRowItem>
                    <SettingsSelect label="Left Click Action:" options={questButtonClickManaOptions} value={questButton.questButtonLeftClickAction} selectionMode="single" disabled={disabled} fullWidth={true} onSelectionChange={value => updateQuestButtonAction("questButtonLeftClickAction", value)}/>
                </SettingsRowItem>
                <SettingsRowItem>
                    <SettingsSelect label="Middle Click Action:" options={questButtonClickManaOptions} value={questButton.questButtonMiddleClickAction} selectionMode="single" disabled={disabled} fullWidth={true} onSelectionChange={value => updateQuestButtonAction("questButtonMiddleClickAction", value)}/>
                </SettingsRowItem>
                <SettingsRowItem>
                    <SettingsSelect label="Right Click Action:" options={questButtonClickManaOptions} value={questButton.questButtonRightClickAction} selectionMode="single" disabled={disabled} fullWidth={true} onSelectionChange={value => updateQuestButtonAction("questButtonRightClickAction", value)}/>
                </SettingsRowItem>
            </SettingsRow>
            <SettingsRow>
                <SettingsRowItem>
                    <SettingsSelect label="Button Visibility:" options={questButtonDisplayManaOptions} value={questButton.questButtonDisplay} selectionMode="single" disabled={disabled} fullWidth={true} onSelectionChange={updateQuestButtonDisplay} tooltip={{
            position: "top",
            text: "Always shows the Quest Button whenever this feature is enabled."
                + "\n\nUnclaimed only shows it while you have relevant unclaimed Quest rewards."
                + "\n\nNever hides the Quest Button."
        }}/>
                </SettingsRowItem>
                <SettingsRowItem>
                    <SettingsSelect label="Unclaimed Indicator:" options={questButtonIndicatorManaOptions} value={questButton.questButtonIndicator} selectionMode="single" disabled={disabled} fullWidth={true} onSelectionChange={updateQuestButtonIndicator} tooltip={{
            position: "top",
            text: "Pill shows Discord's unread-style marker beside the Quest Button."
                + "\n\nBadge shows the number of relevant unclaimed Quest rewards."
                + "\n\nBoth shows the pill and badge together."
                + "\n\nNone hides unclaimed indicators."
        }}/>
                </SettingsRowItem>
                <SettingsRowItem>
                    <SettingsColorPicker label="Badge Color:" className="quest-button-color-picker" color={questButton.questButtonBadgeColor} disabled={disabled} onChange={updateBadgeColor} showEyeDropper={true}/>
                </SettingsRowItem>
            </SettingsRow>
            <SettingsSubheader> Quest Relevancy </SettingsSubheader>
            <SettingsSelect label="Included Reward Types:" wrapTags={true} options={questButtonRewardTypeManaOptions} value={selectedRewardTypes} closeOnSelect={false} maxOptionsVisible={questButtonRewardTypeManaOptions.length} selectionMode="multiple" disabled={disabled} fullWidth={true} onSelectionChange={value => updateIncludedTypes(questButtonRewardTypeOptions, value)} tooltip={{
            position: "top",
            text: "Only count Quests with these reward types as unclaimed when determining button visibility, badge count, and alert behavior."
        }}/>
            <SettingsSelect label="Included Quest Types:" labelClassName="margin-top-9" wrapTags={true} options={questButtonQuestTypeManaOptions} value={selectedQuestTypes} closeOnSelect={false} maxOptionsVisible={questButtonQuestTypeManaOptions.length} selectionMode="multiple" disabled={disabled} fullWidth={true} onSelectionChange={value => updateIncludedTypes(questButtonQuestTypeOptions, value)} tooltip={{
            position: "top",
            text: "Only count Quests with these task types as unclaimed when determining button visibility, badge count, and alert behavior."
        }}/>
        </SettingsCard>);
}
