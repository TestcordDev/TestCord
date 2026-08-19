/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { QuestStore } from "@webpack/common";
import { getQuestifySettings, useQuestifySettings } from "../settings/access";
import { ignoredQuestIDsKey } from "../settings/def";
import { getActiveAutoCompletes, getAutoCompleteQuestTarget, getQuestAutoCompleteEntry } from "./completion";
import { questMatchesIncludedTypes } from "./filtering";
export var QuestStatus;
(function (QuestStatus) {
    QuestStatus["Claimed"] = "CLAIMED";
    QuestStatus["Unclaimed"] = "UNCLAIMED";
    QuestStatus["Ignored"] = "IGNORED";
    QuestStatus["Expired"] = "EXPIRED";
    QuestStatus["Unknown"] = "UNKNOWN";
})(QuestStatus || (QuestStatus = {}));
const showcaseSwitchLeewaySeconds = 3;
let showcasedAutoCompleteQuestId = null;
const questProgressTaskPriority = [
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
export function refreshQuest(quest) {
    return QuestStore.getQuest(quest.id) ?? quest;
}
export function isVideoQuestTask(taskType) {
    return taskType === "WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */ || taskType === "WATCH_VIDEO_ON_MOBILE" /* QuestTaskType.WATCH_VIDEO_ON_MOBILE */;
}
function getQuestTaskByType(quest, taskType) {
    const task = quest.config.taskConfigV2?.tasks[taskType];
    return task ?? null;
}
function getVideoQuestTask(quest) {
    return getQuestTaskByType(quest, "WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */)
        ?? getQuestTaskByType(quest, "WATCH_VIDEO_ON_MOBILE" /* QuestTaskType.WATCH_VIDEO_ON_MOBILE */);
}
function getProgressTimestamp(progress) {
    const timestamp = progress.heartbeat?.lastBeatAt ?? progress.updatedAt;
    const time = timestamp ? new Date(timestamp).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
}
function getLatestProgressTask(quest) {
    const progressEntries = Object.entries(quest.userStatus?.progress ?? {});
    progressEntries.sort(([, a], [, b]) => getProgressTimestamp(b) - getProgressTimestamp(a));
    for (const [fallbackTaskType, progress] of progressEntries) {
        const task = getQuestTaskByType(quest, progress.eventName ?? fallbackTaskType);
        if (task) {
            return task;
        }
    }
    return null;
}
function getQuestProgressTask(quest) {
    if (!quest.config.taskConfigV2?.tasks) {
        return null;
    }
    const progressTask = getLatestProgressTask(quest) ?? getVideoQuestTask(quest);
    if (progressTask) {
        return progressTask;
    }
    for (const taskType of questProgressTaskPriority) {
        const task = getQuestTaskByType(quest, taskType);
        if (task) {
            return task;
        }
    }
    return null;
}
export function getQuestStoredProgress(quest, task) {
    if (quest.userStatus?.completedAt) {
        return task.target;
    }
    const progressMap = quest.userStatus?.progress;
    if (!progressMap) {
        return null;
    }
    if (isVideoQuestTask(task.type)) {
        const watchProgress = progressMap.WATCH_VIDEO?.value;
        const mobileProgress = progressMap.WATCH_VIDEO_ON_MOBILE?.value;
        return watchProgress !== undefined || mobileProgress !== undefined
            ? Math.max(watchProgress ?? 0, mobileProgress ?? 0)
            : null;
    }
    return progressMap[task.type]?.value ?? null;
}
function getCurrentIgnoredQuestIds() {
    return Array.from(getQuestifySettings().ignoredQuestIDs[ignoredQuestIDsKey] ?? []);
}
function getAutoCompleteShowcaseQuest() {
    const entries = getActiveAutoCompletes();
    const runningEntries = entries.filter(entry => entry.status === "running");
    const showcaseEntries = runningEntries.length > 0 ? runningEntries : entries;
    let bestQuest = null;
    let bestTimeRemaining = Infinity;
    let currentQuest = null;
    let currentTimeRemaining = Infinity;
    for (const entry of showcaseEntries) {
        const quest = QuestStore.getQuest(entry.questId);
        if (!quest) {
            continue;
        }
        const progress = entry.progress ?? 0;
        const { adjusted: target } = getAutoCompleteQuestTarget(entry.task);
        const timeRemaining = Math.max(0, target - progress);
        if (entry.questId === showcasedAutoCompleteQuestId) {
            currentQuest = quest;
            currentTimeRemaining = timeRemaining;
        }
        if (timeRemaining < bestTimeRemaining) {
            bestQuest = quest;
            bestTimeRemaining = timeRemaining;
        }
    }
    if (!bestQuest) {
        showcasedAutoCompleteQuestId = null;
        return null;
    }
    if (currentQuest && bestQuest.id !== currentQuest.id && bestTimeRemaining >= currentTimeRemaining - showcaseSwitchLeewaySeconds) {
        return currentQuest;
    }
    showcasedAutoCompleteQuestId = bestQuest.id;
    return bestQuest;
}
function getMostRecentlyCompletedUnclaimedQuest() {
    return Array.from(QuestStore.quests.values())
        .filter(quest => (Boolean(quest.userStatus?.completedAt)
        && getQuestStatus(quest, getCurrentIgnoredQuestIds()) === QuestStatus.Unclaimed))
        .sort((a, b) => {
        const aTime = new Date(a.userStatus?.completedAt ?? 0).getTime();
        const bTime = new Date(b.userStatus?.completedAt ?? 0).getTime();
        return bTime - aTime;
    })[0] ?? null;
}
export function getQuestPanelOverride(quest) {
    const panelState = useQuestifySettings(["disableQuestsEverything", "disableAccountPanelPromo", "disableAccountPanelQuestProgress"]);
    if (panelState.disableQuestsEverything) {
        return null;
    }
    if (panelState.disableAccountPanelPromo && panelState.disableAccountPanelQuestProgress) {
        return null;
    }
    if (panelState.disableAccountPanelQuestProgress) {
        return quest;
    }
    const nextQuest = getAutoCompleteShowcaseQuest() ?? getMostRecentlyCompletedUnclaimedQuest();
    return nextQuest ?? (panelState.disableAccountPanelPromo ? null : quest);
}
export function shouldForceQuestPanelVisible(quest) {
    const settings = getQuestifySettings();
    if (!quest || settings.disableQuestsEverything || settings.disableAccountPanelQuestProgress) {
        return false;
    }
    return getQuestAutoCompleteEntry(refreshQuest(quest)) !== null;
}
export function getQuestPanelPercentComplete({ quest, percentCompleteText, }) {
    if (!quest) {
        return null;
    }
    const refreshedQuest = refreshQuest(quest);
    const activeAutoComplete = getQuestAutoCompleteEntry(refreshedQuest);
    const task = activeAutoComplete?.task ?? getQuestProgressTask(refreshedQuest);
    if (!task) {
        return null;
    }
    const questTarget = activeAutoComplete
        ? getAutoCompleteQuestTarget(task)
            .adjusted
        : task.target;
    const questProgress = activeAutoComplete?.progress ?? getQuestStoredProgress(refreshedQuest, task);
    if (!questTarget || questProgress === null) {
        return null;
    }
    const percentComplete = Math.min(1, questProgress / questTarget);
    if (!percentCompleteText) {
        return { percentComplete };
    }
    return {
        percentComplete,
        percentCompleteText: `${Math.floor(percentComplete * 100)}%`,
    };
}
export function getQuestEmbedProgress(quest) {
    const progress = getQuestPanelPercentComplete({ quest, percentCompleteText: " " });
    return progress
        ? { completedRatio: progress.percentComplete, completedRatioDisplay: progress.percentCompleteText }
        : null;
}
export function getQuestStatus(quest, ignoredQuestIds, checkIgnored = true) {
    const completedQuest = quest.userStatus?.completedAt;
    const claimedQuest = quest.userStatus?.claimedAt;
    const expiredQuest = new Date(quest.config.expiresAt) < new Date();
    const questIgnored = ignoredQuestIds.includes(quest.id);
    if (claimedQuest) {
        return QuestStatus.Claimed;
    }
    if (checkIgnored && questIgnored && (!expiredQuest || completedQuest)) {
        return QuestStatus.Ignored;
    }
    if (completedQuest || !expiredQuest) {
        return QuestStatus.Unclaimed;
    }
    if (expiredQuest) {
        return QuestStatus.Expired;
    }
    return QuestStatus.Unknown;
}
export function countIncludedUnclaimedQuests(quests, ignoredQuestIds, includedTypes) {
    let count = 0;
    for (const quest of quests) {
        const questStatus = getQuestStatus(quest, ignoredQuestIds);
        if (questMatchesIncludedTypes(quest, includedTypes) && questStatus === QuestStatus.Unclaimed) {
            count++;
        }
    }
    return count;
}
