/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { getQuestifySettings, useQuestifySettings } from "../settings/access";
import { defaultQuestOrder } from "../settings/def";
import { rerenderQuests } from "../settings/rerender";
import { SettingsCard, SettingsDescription, SettingsHeader, SettingsRow, SettingsRowItem, SettingsSelect, SettingsSubheader, SettingsSubtleSwitch } from "./shared";
const questStatusOptions = [
    { label: "Unclaimed", value: "UNCLAIMED" },
    { label: "Claimed", value: "CLAIMED" },
    { label: "Ignored", value: "IGNORED" },
    { label: "Expired", value: "EXPIRED" },
];
const questStatusManaOptions = questStatusOptions.map(({ label, value }) => ({
    id: value,
    label,
    value,
}));
const baseSubsortOptions = [
    { label: "Added (Newest)", value: "Recent DESC" },
    { label: "Added (Oldest)", value: "Recent ASC" },
];
const expiringSubsortOptions = [
    ...baseSubsortOptions,
    { label: "Expiring (Soonest)", value: "Expiring ASC" },
    { label: "Expiring (Latest)", value: "Expiring DESC" },
];
const expiredSubsortOptions = [
    ...baseSubsortOptions,
    { label: "Expired (Most Recent)", value: "Expiring DESC" },
    { label: "Expired (Least Recent)", value: "Expiring ASC" },
];
const claimedSubsortOptions = [
    ...baseSubsortOptions,
    { label: "Claimed (Most Recent)", value: "Claimed DESC" },
    { label: "Claimed (Least Recent)", value: "Claimed ASC" },
];
function toManaOptions(options) {
    return options.map(({ label, value }) => ({
        id: value,
        label,
        value,
    }));
}
const unclaimedSubsortManaOptions = toManaOptions(expiringSubsortOptions);
const claimedSubsortManaOptions = toManaOptions(claimedSubsortOptions);
const ignoredSubsortManaOptions = toManaOptions(expiringSubsortOptions);
const expiredSubsortManaOptions = toManaOptions(expiredSubsortOptions);
const positionLabels = ["First", "Second", "Third", "Fourth"];
const subsortTooltips = {
    unclaimedSubsort: "Completed but unclaimed Quests stay below incomplete unclaimed Quests, then this subsort is applied within those groups.",
    claimedSubsort: "Claimed Quests can be sorted by claim time or by when the Quest was added.",
    ignoredSubsort: "Ignored Quests still keep their ignored group position, then this subsort controls their order inside that group.",
    expiredSubsort: "Expired Quests can be sorted by expiration time or by when the Quest was added.",
};
function sanitizeQuestOrder(order) {
    const validStatuses = new Set(defaultQuestOrder);
    const sanitized = Array.isArray(order)
        ? order.filter((status) => validStatuses.has(status))
        : [];
    for (const status of defaultQuestOrder) {
        if (!sanitized.includes(status)) {
            sanitized.push(status);
        }
    }
    return sanitized.slice(0, defaultQuestOrder.length);
}
export function ReorderQuestsSetting() {
    const reorderQuests = useQuestifySettings([
        "disableQuestsEverything",
        "questOrder",
        "unclaimedSubsort",
        "claimedSubsort",
        "ignoredSubsort",
        "expiredSubsort",
        "rememberQuestPageSort",
        "rememberQuestPageFilters",
    ]);
    const disabled = reorderQuests.disableQuestsEverything;
    const questOrder = sanitizeQuestOrder(reorderQuests.questOrder);
    function updateQuestOrder(index, value) {
        if (typeof value !== "string")
            return;
        const nextStatus = value;
        const nextOrder = [...questOrder];
        const previousStatus = nextOrder[index];
        const existingIndex = nextOrder.indexOf(nextStatus);
        if (existingIndex !== -1 && existingIndex !== index) {
            nextOrder[existingIndex] = previousStatus;
        }
        nextOrder[index] = nextStatus;
        getQuestifySettings().questOrder = nextOrder;
        rerenderQuests();
    }
    function updateSubsort(key, value) {
        if (typeof value !== "string")
            return;
        getQuestifySettings()[key] = value;
        rerenderQuests();
    }
    function updateRememberSetting(key, checked) {
        getQuestifySettings()[key] = checked;
    }
    return (<SettingsCard>
            <SettingsHeader> Reorder Quests </SettingsHeader>
            <SettingsDescription> Sort Quests by their status when the Questify sort option is selected on the Quests page. </SettingsDescription>
            <SettingsSubheader> Status Order </SettingsSubheader>
            <SettingsRow>
                {questOrder.map((status, index) => (<SettingsRowItem key={index}>
                        <SettingsSelect label={`${positionLabels[index]}:`} options={questStatusManaOptions} value={status} selectionMode="single" disabled={disabled} fullWidth={true} maxOptionsVisible={questStatusManaOptions.length} onSelectionChange={value => updateQuestOrder(index, value)} tooltip={{
                position: "top",
                text: "Each status can only appear once. Selecting a status already used in another position swaps the two positions."
            }}/>
                    </SettingsRowItem>))}
            </SettingsRow>
            <SettingsSubheader> Subsorts </SettingsSubheader>
            <SettingsRow>
                <SettingsRowItem>
                    <SettingsSelect label="Unclaimed Subsort:" options={unclaimedSubsortManaOptions} value={reorderQuests.unclaimedSubsort} selectionMode="single" disabled={disabled} fullWidth={true} maxOptionsVisible={unclaimedSubsortManaOptions.length} onSelectionChange={value => updateSubsort("unclaimedSubsort", value)} tooltip={{
            position: "top",
            text: subsortTooltips.unclaimedSubsort
        }}/>
                </SettingsRowItem>
                <SettingsRowItem>
                    <SettingsSelect label="Claimed Subsort:" options={claimedSubsortManaOptions} value={reorderQuests.claimedSubsort} selectionMode="single" disabled={disabled} fullWidth={true} maxOptionsVisible={claimedSubsortManaOptions.length} onSelectionChange={value => updateSubsort("claimedSubsort", value)} tooltip={{
            position: "top",
            text: subsortTooltips.claimedSubsort
        }}/>
                </SettingsRowItem>
            </SettingsRow>
            <SettingsRow>
                <SettingsRowItem>
                    <SettingsSelect label="Ignored Subsort:" options={ignoredSubsortManaOptions} value={reorderQuests.ignoredSubsort} selectionMode="single" disabled={disabled} fullWidth={true} maxOptionsVisible={ignoredSubsortManaOptions.length} onSelectionChange={value => updateSubsort("ignoredSubsort", value)} tooltip={{
            position: "top",
            text: subsortTooltips.ignoredSubsort
        }}/>
                </SettingsRowItem>
                <SettingsRowItem>
                    <SettingsSelect label="Expired Subsort:" options={expiredSubsortManaOptions} value={reorderQuests.expiredSubsort} selectionMode="single" disabled={disabled} fullWidth={true} maxOptionsVisible={expiredSubsortManaOptions.length} onSelectionChange={value => updateSubsort("expiredSubsort", value)} tooltip={{
            position: "top",
            text: subsortTooltips.expiredSubsort
        }}/>
                </SettingsRowItem>
            </SettingsRow>
            <SettingsSubheader> Quest Page Memory </SettingsSubheader>
            <SettingsSubtleSwitch checked={reorderQuests.rememberQuestPageSort} disabled={disabled} label="Remember the selected Quest page sort:" onChange={checked => updateRememberSetting("rememberQuestPageSort", checked)} bottomSpacing="5" tooltip={{
            position: "top",
            text: "When disabled, the Quests page opens with the Questify sort option each time."
        }}/>
            <SettingsSubtleSwitch checked={reorderQuests.rememberQuestPageFilters} disabled={disabled} label="Remember the selected Quest page filters:" onChange={checked => updateRememberSetting("rememberQuestPageFilters", checked)} tooltip={{
            position: "top",
            text: "When disabled, the Quests page opens without task or reward filters each time."
        }}/>
        </SettingsCard>);
}
