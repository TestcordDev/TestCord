/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { getQuestifySettings, useQuestifySettings } from "../settings/access";
import { defaultClaimedSubsort, defaultExpiredSubsort, defaultIgnoredSubsort, defaultQuestOrder, defaultUnclaimedSubsort } from "../settings/def";
import { getIgnoredQuestIDs } from "../settings/ignoredQuests";
import { getQuestStatus, QuestStatus } from "./questState";
import { adjustRGB, decimalToRGB, isDarkish, q } from "./ui";
export const desktopVideoCompatibilityQuestIds = new Set();
const customQuestTileClasses = [
    q("quest-item-restyle"),
    q("quest-item-intense-gradient"),
    q("quest-item-default-gradient"),
    q("quest-item-black-gradient"),
    q("quest-item-hide-gradient"),
    q("quest-item-contrast-logo"),
];
const sortFallbacks = {
    unclaimed: defaultUnclaimedSubsort,
    claimed: defaultClaimedSubsort,
    ignored: defaultIgnoredSubsort,
    expired: defaultExpiredSubsort,
};
const validSubsorts = new Set([
    "Recent ASC",
    "Recent DESC",
    "Expiring ASC",
    "Expiring DESC",
    "Claimed ASC",
    "Claimed DESC",
]);
function getTileColorSetting(status, colors) {
    switch (status) {
        case QuestStatus.Claimed:
            return colors.questTileClaimedColor;
        case QuestStatus.Unclaimed:
            return colors.questTileUnclaimedColor;
        case QuestStatus.Ignored:
            return colors.questTileIgnoredColor;
        case QuestStatus.Expired:
            return colors.questTileExpiredColor;
        default:
            return null;
    }
}
function getQuestTileColor(quest, colors) {
    const questStatus = getQuestStatus(quest, getIgnoredQuestIDs());
    const setting = quest.dummyColor ?? getTileColorSetting(questStatus, colors);
    if (!setting?.enabled) {
        return null;
    }
    return setting.color;
}
function getGradientClass(gradient) {
    if (gradient === "black")
        return q("quest-item-black-gradient");
    if (gradient === "hide")
        return q("quest-item-hide-gradient");
    if (gradient === "default")
        return q("quest-item-default-gradient");
    return q("quest-item-intense-gradient");
}
export function getQuestTileClasses(originalClasses, quest, gradientOverride) {
    const questTiles = useQuestifySettings([
        "disableQuestsEverything",
        "ignoredQuestIDs",
        "questTileUnclaimedColor",
        "questTileClaimedColor",
        "questTileIgnoredColor",
        "questTileExpiredColor",
        "questTileGradient",
    ]);
    const baseClasses = originalClasses
        .split(" ")
        .filter(cls => cls && !customQuestTileClasses.includes(cls));
    const colors = {
        questTileUnclaimedColor: questTiles.questTileUnclaimedColor,
        questTileClaimedColor: questTiles.questTileClaimedColor,
        questTileIgnoredColor: questTiles.questTileIgnoredColor,
        questTileExpiredColor: questTiles.questTileExpiredColor,
    };
    const color = !questTiles.disableQuestsEverything
        ? getQuestTileColor(quest, colors)
        : null;
    if (color == null) {
        return baseClasses.join(" ");
    }
    const returnClasses = [...baseClasses, q("quest-item-restyle")];
    const gradient = gradientOverride ?? questTiles.questTileGradient;
    const gradientClass = getGradientClass(gradient);
    if (gradientClass != null) {
        returnClasses.push(gradientClass);
    }
    if (gradient !== "black" && gradient !== "hide" && !isDarkish(decimalToRGB(color), 0.875)) {
        returnClasses.push(q("quest-item-contrast-logo"));
    }
    return returnClasses.join(" ");
}
export function getQuestTileStyle(quest) {
    const questTiles = useQuestifySettings([
        "disableQuestsEverything",
        "ignoredQuestIDs",
        "questTileUnclaimedColor",
        "questTileClaimedColor",
        "questTileIgnoredColor",
        "questTileExpiredColor",
    ]);
    const style = {};
    const colors = {
        questTileUnclaimedColor: questTiles.questTileUnclaimedColor,
        questTileClaimedColor: questTiles.questTileClaimedColor,
        questTileIgnoredColor: questTiles.questTileIgnoredColor,
        questTileExpiredColor: questTiles.questTileExpiredColor,
    };
    const themeColor = quest && !questTiles.disableQuestsEverything
        ? getQuestTileColor(quest, colors)
        : null;
    if (themeColor == null)
        return style;
    const rgb = decimalToRGB(themeColor);
    const darkish = isDarkish(rgb);
    const sign = darkish ? 1 : -1;
    const questNameColor = adjustRGB(rgb, 200 * sign);
    const rewardTitleColor = adjustRGB(rgb, 150 * sign);
    const rewardDescriptionColor = adjustRGB(rgb, 100 * sign);
    const buttonNormalColor = adjustRGB(rgb, 50 * sign);
    const buttonHoverColor = adjustRGB(rgb, 75 * sign);
    function toRGB(value) {
        return `rgb(${value.r}, ${value.g}, ${value.b})`;
    }
    style["--questify-color"] = toRGB(rgb);
    style["--questify-quest-name"] = toRGB(questNameColor);
    style["--questify-reward-title"] = toRGB(rewardTitleColor);
    style["--questify-reward-description"] = toRGB(rewardDescriptionColor);
    style["--questify-button-normal"] = toRGB(buttonNormalColor);
    style["--questify-button-hover"] = toRGB(buttonHoverColor);
    return style;
}
function createSortFunction(subsort) {
    switch (subsort) {
        case "Recent ASC":
            return (a, b) => new Date(a.config.startsAt).getTime() - new Date(b.config.startsAt).getTime();
        case "Recent DESC":
            return (a, b) => new Date(b.config.startsAt).getTime() - new Date(a.config.startsAt).getTime();
        case "Expiring ASC":
            return (a, b) => new Date(a.config.expiresAt).getTime() - new Date(b.config.expiresAt).getTime();
        case "Expiring DESC":
            return (a, b) => new Date(b.config.expiresAt).getTime() - new Date(a.config.expiresAt).getTime();
        case "Claimed ASC":
            return (a, b) => new Date(a.userStatus?.claimedAt || 0).getTime() - new Date(b.userStatus?.claimedAt || 0).getTime();
        case "Claimed DESC":
            return (a, b) => new Date(b.userStatus?.claimedAt || 0).getTime() - new Date(a.userStatus?.claimedAt || 0).getTime();
    }
}
function getValidSubsort(value, fallback) {
    return validSubsorts.has(value) ? value : fallback;
}
function getValidQuestOrder(value) {
    const validStatuses = new Set(defaultQuestOrder);
    const configuredOrder = Array.isArray(value)
        ? value
        : defaultQuestOrder;
    const order = configuredOrder.filter((status) => validStatuses.has(status));
    for (const status of defaultQuestOrder) {
        if (!order.includes(status)) {
            order.push(status);
        }
    }
    return order;
}
function injectDesktopVideoQuestTasks(quests) {
    for (const quest of quests) {
        const tasks = quest.config.taskConfigV2?.tasks;
        const mobileVideoTask = tasks?.["WATCH_VIDEO_ON_MOBILE" /* QuestTaskType.WATCH_VIDEO_ON_MOBILE */];
        if (!tasks || !mobileVideoTask || tasks["WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */]) {
            continue;
        }
        const desktopVideoTask = {
            ...mobileVideoTask,
            type: "WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */,
        };
        const reorderedTasks = {};
        for (const [taskType, task] of Object.entries(tasks)) {
            if (taskType === "WATCH_VIDEO_ON_MOBILE" /* QuestTaskType.WATCH_VIDEO_ON_MOBILE */) {
                reorderedTasks["WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */] = desktopVideoTask;
            }
            reorderedTasks[taskType] = task;
        }
        quest.config.taskConfigV2.tasks = reorderedTasks;
        desktopVideoCompatibilityQuestIds.add(quest.id);
    }
}
export function hasInjectedDesktopVideoCompatibility(quest) {
    return !quest ? false : desktopVideoCompatibilityQuestIds.has(typeof quest === "string" ? quest : quest.id);
}
export function sortQuests(quests, skip) {
    const questSorting = useQuestifySettings([
        "disableQuestsEverything",
        "ignoredQuestIDs",
        "makeMobileVideoQuestsDesktopCompatible",
        "completeVideoQuestsQuicker",
        "questOrder",
        "unclaimedSubsort",
        "claimedSubsort",
        "ignoredSubsort",
        "expiredSubsort",
        "autoCompleteQuestTypes",
    ]);
    if (questSorting.disableQuestsEverything) {
        return quests;
    }
    if (questSorting.makeMobileVideoQuestsDesktopCompatible || !!questSorting.autoCompleteQuestTypes.WATCH_VIDEO_ON_MOBILE) {
        injectDesktopVideoQuestTasks(quests);
    }
    if (skip) {
        return quests;
    }
    const ignoredQuestIds = getIgnoredQuestIDs();
    const questGroups = {
        claimed: [],
        expired: [],
        ignored: [],
        unclaimed: [],
        unknown: [],
    };
    for (const quest of quests) {
        switch (getQuestStatus(quest, ignoredQuestIds)) {
            case QuestStatus.Claimed:
                questGroups.claimed.push(quest);
                break;
            case QuestStatus.Unclaimed:
                questGroups.unclaimed.push(quest);
                break;
            case QuestStatus.Expired:
                questGroups.expired.push(quest);
                break;
            case QuestStatus.Ignored:
                questGroups.ignored.push(quest);
                break;
            default:
                questGroups.unknown.push(quest);
                break;
        }
    }
    const unclaimedSortFunction = createSortFunction(getValidSubsort(questSorting.unclaimedSubsort, sortFallbacks.unclaimed));
    questGroups.unclaimed.sort((a, b) => {
        const aCompleted = !!a.userStatus?.completedAt;
        const bCompleted = !!b.userStatus?.completedAt;
        if (aCompleted !== bCompleted) {
            return aCompleted ? 1 : -1;
        }
        return unclaimedSortFunction(a, b);
    });
    questGroups.claimed.sort(createSortFunction(getValidSubsort(questSorting.claimedSubsort, sortFallbacks.claimed)));
    questGroups.ignored.sort(createSortFunction(getValidSubsort(questSorting.ignoredSubsort, sortFallbacks.ignored)));
    questGroups.expired.sort(createSortFunction(getValidSubsort(questSorting.expiredSubsort, sortFallbacks.expired)));
    return [
        ...getValidQuestOrder(questSorting.questOrder).flatMap(status => questGroups[status.toLowerCase()]),
        ...questGroups.unknown,
    ];
}
export function shouldPreloadQuestAssets() {
    const settings = getQuestifySettings();
    return !settings.disableQuestsEverything && settings.questTilePreload;
}
export function getLastSortChoice() {
    const { rememberQuestPageSort, lastQuestPageSort } = getQuestifySettings();
    return rememberQuestPageSort ? lastQuestPageSort : "questify";
}
export function setLastSortChoice(sort) {
    getQuestifySettings().lastQuestPageSort = sort || "questify";
}
function getFilterChoiceKey({ group, filter }) {
    return JSON.stringify([group, filter]);
}
export function getLastFilterChoices() {
    const { rememberQuestPageFilters, lastQuestPageFilters } = getQuestifySettings();
    return rememberQuestPageFilters
        ? Object.values(lastQuestPageFilters).map(item => JSON.parse(JSON.stringify(item)))
        : null;
}
export function setLastFilterChoices(filters) {
    if (!filters?.length) {
        getQuestifySettings().lastQuestPageFilters = {};
        return;
    }
    if (!filters.every(filter => filter?.group && filter?.filter)) {
        return;
    }
    getQuestifySettings().lastQuestPageFilters = JSON.parse(JSON.stringify(filters)).reduce((acc, item) => {
        acc[getFilterChoiceKey(item)] = item;
        return acc;
    }, {});
}
