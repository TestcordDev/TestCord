/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findByCodeLazy, findLazy } from "@webpack";
import { AuthorizedAppsStore, FluxDispatcher, QuestStore, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";
import { getCurrentUserId, getQuestifySettings } from "../settings/access";
import { autoCompleteQuestTaskTypes, isDesktopCompatible } from "../settings/def";
import { resetQuestsToResume } from "../settings/fetching";
import { getIgnoredQuestIDs } from "../settings/ignoredQuests";
import { rerenderQuests } from "../settings/rerender";
import { snakeToCamel } from "./fetching";
import { normalizeQuestName, questMatchesIncludedTypes } from "./filtering";
import { QL } from "./logging";
import { getQuestStatus, getQuestStoredProgress, isVideoQuestTask, QuestStatus, refreshQuest } from "./questState";
import { hasInjectedDesktopVideoCompatibility } from "./questTiles";
export var QuestCompletionState;
(function (QuestCompletionState) {
    QuestCompletionState["Completing"] = "COMPLETING";
    QuestCompletionState["Queued"] = "QUEUED";
    QuestCompletionState["Accepted"] = "ACCEPTED";
    QuestCompletionState["Unenrolled"] = "UNENROLLED";
})(QuestCompletionState || (QuestCompletionState = {}));
const reportVideoProgress = findByCodeLazy(".QUESTS_VIDEO_PROGRESS(");
const sendHeartbeat = findByCodeLazy(".QUESTS_HEARTBEAT(");
const getApplicationProxyTicket = findByCodeLazy("APPLICATION_PROXY_TICKET", "body.ticket");
export const enrollInQuestNative = findByCodeLazy('type:"QUESTS_ENROLL_BEGIN",');
const getQuestOrbQuantity = findByCodeLazy("premiumOrbQuantity??", "orbQuantity");
const QuestCTA = findLazy(m => !!m?.START_QUEST && !!m?.ACCEPT_QUEST);
function resolveQuestCTA(taskType) {
    return !taskType ? undefined : ["ACHIEVEMENT_IN_ACTIVITY" /* QuestTaskType.ACHIEVEMENT_IN_ACTIVITY */, "PLAY_ACTIVITY" /* QuestTaskType.PLAY_ACTIVITY */, "WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */].includes(taskType) ? QuestCTA.START_QUEST : QuestCTA.ACCEPT_QUEST;
}
async function getActivityReferrer(appId) {
    try {
        const proxyTicket = await getApplicationProxyTicket(appId);
        const referrer = new URL(`https://${appId}.discordsays.com/`);
        referrer.searchParams.set("instance_id", "example-cl-instance");
        referrer.searchParams.set("platform", "desktop");
        referrer.searchParams.set("discord_proxy_ticket", proxyTicket);
        return referrer.toString();
    }
    catch (error) {
        QL.error("AUTO_COMPLETE_ACHIEVEMENT_PROXY_TICKET_FAILED", { appId, error });
    }
}
export function makeEnrollmentData(args) {
    return {
        questContent: args.analyticsCtxQuestContent,
        questContentCTA: resolveQuestCTA(args.taskType),
        sourceQuestContent: args.analyticsCtxSourceQuestContent,
        sourceQuestContentCTA: resolveQuestCTA(args.taskType),
        questContentPosition: args.analyticsCtxQuestContentPosition,
        questContentRowIndex: args.analyticsCtxQuestContentRowIndex
    };
}
const QuestifyNative = VencordNative?.pluginHelpers?.Questify;
const videoQuestLeeway = 24;
const resumeExpiryMs = 60 * 60 * 1000;
const maxBatchEnrollmentAttempts = 25;
const maxBatchNonRateLimitEnrollmentFailures = 3;
const maxBatchRateLimitEnrollmentFailures = 1;
const activeAutoCompletes = new Map();
const manuallyStoppedQuestIds = new Set();
let enrollmentRateLimitBlockedUntil = 0;
let queueAllAutoCompleteQuestsAbortController = null;
let suppressQueueDrain = false;
let videoProgressStackTracePatchSucceeded = false;
let heartbeatStackTracePatchSucceeded = false;
let didShowBrokenAutoCompleteToast = false;
function sleep(ms, signal) {
    if (signal?.aborted) {
        return Promise.reject(new Error("Auto-complete aborted."));
    }
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        function onAbort() {
            clearTimeout(timeoutId);
            signal?.removeEventListener("abort", onAbort);
            reject(new Error("Auto-complete aborted."));
        }
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
function clampFloat(value, precision = 6) {
    return Number(value.toFixed(precision));
}
function randomBetween(min, max) {
    return clampFloat(min + Math.random() * (max - min));
}
export function setVideoProgressStackTracePatchSucceeded() {
    videoProgressStackTracePatchSucceeded = true;
}
export function setHeartbeatStackTracePatchSucceeded() {
    heartbeatStackTracePatchSucceeded = true;
}
export function getStackTracePatchesSucceeded() {
    return {
        videoProgress: videoProgressStackTracePatchSucceeded,
        heartbeat: heartbeatStackTracePatchSucceeded,
    };
}
function showBrokenAutoCompleteToast() {
    if (didShowBrokenAutoCompleteToast) {
        return;
    }
    didShowBrokenAutoCompleteToast = true;
    showToast("AutoComplete is broken. A fix will be implemented shortly.", Toasts.Type.FAILURE);
}
export function hasEnabledAutoCompleteQuestTypes() {
    return autoCompleteQuestTaskTypes.some(questType => getQuestifySettings().autoCompleteQuestTypes[questType]);
}
function isAutoCompleteRuntimeReady(notify = false) {
    const stackTracePatches = getStackTracePatchesSucceeded();
    if (stackTracePatches.videoProgress && stackTracePatches.heartbeat) {
        return true;
    }
    if (notify) {
        showBrokenAutoCompleteToast();
        QL.warn("AUTO_COMPLETE_STACK_TRACE_PATCH_MISSING", stackTracePatches);
    }
    return false;
}
export function getQuestAutoCompleteProgress(quest) {
    return activeAutoCompletes.get(quest.id)?.progress ?? null;
}
export function getQuestAutoCompleteEntry(questOrId) {
    const questId = typeof questOrId === "string" ? questOrId : questOrId.id;
    return activeAutoCompletes.get(questId) ?? null;
}
export function getAutoCompleteQuestTarget(task) {
    const raw = task.target;
    return {
        raw,
        adjusted: Math.max(0, raw - (isVideoQuestTask(task.type) && getQuestifySettings().completeVideoQuestsQuicker ? videoQuestLeeway : 0)),
    };
}
function getAutoCompleteQuestTasks(quest) {
    const tasks = quest.config.taskConfigV2?.tasks;
    if (!tasks) {
        return [];
    }
    return autoCompleteQuestTaskTypes.flatMap(taskType => {
        const task = tasks[taskType];
        return task ? [task] : [];
    });
}
function getQuestAutoCompleteKind(task) {
    switch (task.type) {
        case "WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */:
        case "WATCH_VIDEO_ON_MOBILE" /* QuestTaskType.WATCH_VIDEO_ON_MOBILE */:
            return "watch";
        case "PLAY_ON_DESKTOP" /* QuestTaskType.PLAY_ON_DESKTOP */:
        case "PLAY_ON_XBOX" /* QuestTaskType.PLAY_ON_XBOX */:
        case "PLAY_ON_PLAYSTATION" /* QuestTaskType.PLAY_ON_PLAYSTATION */:
        case "PLAY_ACTIVITY" /* QuestTaskType.PLAY_ACTIVITY */:
            return "play";
        case "ACHIEVEMENT_IN_ACTIVITY" /* QuestTaskType.ACHIEVEMENT_IN_ACTIVITY */:
            return "achievement";
        default:
            return null;
    }
}
function getEffectiveAutoCompleteTaskType(task, quest) {
    return task.type === "WATCH_VIDEO" /* QuestTaskType.WATCH_VIDEO */ && hasInjectedDesktopVideoCompatibility(quest)
        ? "WATCH_VIDEO_ON_MOBILE" /* QuestTaskType.WATCH_VIDEO_ON_MOBILE */
        : task.type;
}
function isAutoCompleteQuestTaskEnabled(quest, task) {
    const taskType = getEffectiveAutoCompleteTaskType(task, quest);
    const compatible = isDesktopCompatible(taskType);
    const enabled = getQuestifySettings().autoCompleteQuestTypes[taskType] === true;
    return compatible && enabled && getQuestAutoCompleteKind(task) != null;
}
function resolveAutoCompleteQuest(quest) {
    for (const task of getAutoCompleteQuestTasks(quest)) {
        const kind = getQuestAutoCompleteKind(task);
        if (kind && isAutoCompleteQuestTaskEnabled(quest, task)) {
            return { task, kind };
        }
    }
    return null;
}
function getResumeQuestIds() {
    return Array.from(activeAutoCompletes.keys());
}
function isResumeStateExpired(timestamp) {
    return Date.now() - timestamp > resumeExpiryMs;
}
function updateResumeState(questIDs = getResumeQuestIds()) {
    const userId = getCurrentUserId();
    if (!userId) {
        QL.warn("AUTO_COMPLETE_RESUME_NO_USER");
        return;
    }
    if (!getQuestifySettings().resumeInterruptedQuests || questIDs.length === 0) {
        delete getQuestifySettings().resumeQuestIDs[userId];
        return;
    }
    getQuestifySettings().resumeQuestIDs[userId] = {
        timestamp: Date.now(),
        questIDs,
    };
}
function createAutoCompleteEntry(quest, task, kind) {
    return {
        questId: quest.id,
        questName: normalizeQuestName(quest),
        task,
        kind,
        status: "queued",
        progress: getQuestStoredProgress(quest, task),
        abortController: new AbortController(),
        progressInterval: null,
        rerenderInterval: null,
    };
}
function clearEntryTimers(entry) {
    if (entry.progressInterval) {
        clearInterval(entry.progressInterval);
        entry.progressInterval = null;
    }
    if (entry.rerenderInterval) {
        clearInterval(entry.rerenderInterval);
        entry.rerenderInterval = null;
    }
}
function isEntryActive(entry) {
    return activeAutoCompletes.get(entry.questId) === entry && !entry.abortController.signal.aborted;
}
function formatQuestTime(seconds, prepositional = false) {
    const remaining = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(remaining / 60);
    const secondsPart = remaining % 60;
    if (prepositional) {
        return remaining >= 60 ? `${minutes}m ${secondsPart}s` : `${secondsPart}s`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`;
}
function isQuestQueuedForResume(questId) {
    if (!getQuestifySettings().resumeInterruptedQuests) {
        return false;
    }
    const userId = getCurrentUserId();
    const resumeState = userId ? getQuestifySettings().resumeQuestIDs[userId] : null;
    return Boolean(resumeState && !isResumeStateExpired(resumeState.timestamp) && resumeState.questIDs.includes(questId));
}
function getQueuedAutoCompletePosition(questId) {
    const queuedQuestIds = Array.from(activeAutoCompletes.values())
        .filter(entry => entry.status === "queued")
        .map(entry => entry.questId);
    const queuedIndex = queuedQuestIds.indexOf(questId);
    return queuedIndex === -1 ? null : queuedIndex + 1;
}
export function getQuestCompletionState(quest, options = {}) {
    quest = refreshQuest(quest);
    const activeEntry = activeAutoCompletes.get(quest.id);
    const resolvedQuest = activeEntry ?? resolveAutoCompleteQuest(quest);
    if (!resolvedQuest) {
        return [null, QuestCompletionState.Unenrolled];
    }
    const { task, kind } = resolvedQuest;
    const target = getAutoCompleteQuestTarget(task).adjusted;
    const enrolledAt = quest.userStatus?.enrolledAt ? new Date(quest.userStatus.enrolledAt) : null;
    const storedProgress = activeEntry?.progress ?? getQuestStoredProgress(quest, task) ?? 0;
    const elapsedProgress = !activeEntry && enrolledAt && isVideoQuestTask(task.type) && getQuestifySettings().completeVideoQuestsQuicker
        ? Math.max(0, (Date.now() - enrolledAt.getTime()) / 1000)
        : 0;
    const progress = Math.min(target, Math.max(storedProgress, elapsedProgress));
    const timeRemaining = Math.max(0, target - progress);
    const formattedTime = formatQuestTime(timeRemaining, options.prepositional);
    const immediate = kind === "achievement" || timeRemaining <= 1;
    if (activeEntry?.status === "running") {
        const text = immediate
            ? "Completing..."
            : `Completing ${options.prepositional ? `in ${formattedTime}` : `(${formattedTime})`}`;
        return [text, QuestCompletionState.Completing];
    }
    if (activeEntry?.status === "queued") {
        return [`Queued (${getQueuedAutoCompletePosition(quest.id) ?? "?"})`, QuestCompletionState.Queued];
    }
    if (enrolledAt) {
        if (isQuestQueuedForResume(quest.id)) {
            return ["Resuming...", QuestCompletionState.Queued];
        }
        const meaningfulProgress = progress >= 1;
        return [
            immediate ? "Complete Now" : `${meaningfulProgress ? "Resume" : "Complete"} (${formatQuestTime(timeRemaining)})`,
            QuestCompletionState.Accepted,
        ];
    }
    return [
        immediate ? "Complete Now" : `Complete (${formatQuestTime(target)})`,
        QuestCompletionState.Unenrolled,
    ];
}
export function getQuestButtonProps(args) {
    if (!canAutoCompleteQuest(args.quest)) {
        return null;
    }
    const [label, completionState] = getQuestCompletionState(args.quest);
    if (!label) {
        return null;
    }
    return {
        icon: undefined,
        text: label,
        onClick: async () => {
            if (completionState === QuestCompletionState.Unenrolled) {
                args.preClickCallback?.();
                if ((await ensureQuestEnrolledForAutoComplete(args.quest, { analytics: args, method: "native" })).type === "success") {
                    processQuestForAutoComplete(args.quest, { force: true, source: "manual" });
                    rerenderQuests();
                }
            }
            else if (completionState === QuestCompletionState.Completing) {
                stopQuestAutoComplete(args.quest, { manual: true, preserveResume: false, terminalHeartbeat: true });
                rerenderQuests();
            }
            else if (completionState === QuestCompletionState.Queued) {
                stopQuestAutoComplete(args.quest, { manual: true, preserveResume: false, terminalHeartbeat: true });
                rerenderQuests();
            }
            else if (completionState === QuestCompletionState.Accepted) {
                processQuestForAutoComplete(args.quest, { force: true, source: "manual" });
                rerenderQuests();
            }
        }
    };
}
export function getQuestPanelSubtitleText(quest) {
    quest = refreshQuest(quest);
    const questCompleted = Boolean(quest.userStatus?.completedAt)
        && getQuestStatus(quest, getIgnoredQuestIDs()) === QuestStatus.Unclaimed;
    const [completingText] = getQuestCompletionState(quest, { prepositional: true });
    const completedText = questCompleted ? "Completed" : null;
    const statusText = completedText ?? completingText;
    if (!statusText) {
        return null;
    }
    const rewardItem = (quest.config.rewardsConfig.rewards[0] ?? null);
    const orbsReward = getQuestOrbQuantity(quest.config, UserStore.getCurrentUser()) ?? 0;
    if (orbsReward > 0) {
        return `${statusText} for ${orbsReward} Orbs.`;
    }
    if (rewardItem?.messages?.nameWithArticle) {
        return `${statusText} for ${rewardItem.messages.nameWithArticle}.`;
    }
    return `${statusText} for an unrecognized reward.`;
}
export function canAutoCompleteQuest(quest) {
    if (!isAutoCompleteRuntimeReady()) {
        return false;
    }
    if (quest.userStatus?.completedAt) {
        return false;
    }
    if (getQuestStatus(quest, getIgnoredQuestIDs()) !== QuestStatus.Unclaimed) {
        return false;
    }
    return resolveAutoCompleteQuest(quest) != null;
}
function getEnrollmentRetryAfter(error) {
    const response = error;
    const retryAfter = response.body?.retry_after ?? response.body?.retryAfter ?? response.retry_after ?? response.retryAfter;
    return typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter
        : null;
}
function isEnrollmentRateLimitError(error) {
    const response = error;
    return response.status === 429 || getEnrollmentRetryAfter(error) !== null;
}
function getEnrollmentRateLimitRemainingSeconds() {
    if (enrollmentRateLimitBlockedUntil <= Date.now()) {
        enrollmentRateLimitBlockedUntil = 0;
        return null;
    }
    return (enrollmentRateLimitBlockedUntil - Date.now()) / 1000;
}
export function isQuestEnrollmentRateLimited() {
    return getEnrollmentRateLimitRemainingSeconds() !== null;
}
function blockQuestEnrollmentForRetryAfter(retryAfter) {
    if (retryAfter === null) {
        return;
    }
    enrollmentRateLimitBlockedUntil = Math.max(enrollmentRateLimitBlockedUntil, Date.now() + retryAfter * 1000);
}
function showQuestEnrollmentFailureToast(quest, result) {
    const rateLimitSuffix = result.type === "rate_limited" ? " due to rate limits" : "";
    showToast(`Enrollment in ${normalizeQuestName(quest)} Quest failed${rateLimitSuffix}.`, Toasts.Type.FAILURE);
}
export async function enrollInQuestManually(quest) {
    quest = refreshQuest(quest);
    const userId = getCurrentUserId();
    if (quest.userStatus?.enrolledAt) {
        return { type: "success" };
    }
    const blockedFor = getEnrollmentRateLimitRemainingSeconds();
    if (blockedFor !== null) {
        return { type: "rate_limited", retryAfter: blockedFor };
    }
    FluxDispatcher.dispatch({
        type: "QUESTS_ENROLL_BEGIN",
        questId: quest.id,
    });
    try {
        const response = await RestAPI.post({
            url: `/quests/${quest.id}/enroll`,
            body: { location: 11 /* QuestTargetedContent.QUEST_HOME_DESKTOP */ },
        });
        if (getCurrentUserId() !== userId) {
            return { type: "cancelled" };
        }
        FluxDispatcher.dispatch({
            type: "QUESTS_ENROLL_SUCCESS",
            enrolledQuestUserStatus: snakeToCamel(response.body),
        });
        return { type: "success" };
    }
    catch (error) {
        if (getCurrentUserId() !== userId) {
            return { type: "cancelled" };
        }
        FluxDispatcher.dispatch({
            type: "QUESTS_ENROLL_FAILURE",
            questId: quest.id,
        });
        if (isEnrollmentRateLimitError(error)) {
            const retryAfter = getEnrollmentRetryAfter(error);
            blockQuestEnrollmentForRetryAfter(retryAfter);
            return { type: "rate_limited", retryAfter };
        }
        return { type: "unknown_error", error };
    }
}
async function ensureQuestEnrolledForAutoComplete(quest, options = {}) {
    quest = refreshQuest(quest);
    if (quest.userStatus?.enrolledAt) {
        return { type: "success" };
    }
    const result = options.method === "manual"
        ? await enrollInQuestManually(quest)
        : await enrollInQuestNative(quest.id, makeEnrollmentData(options.analytics ?? {}));
    if (result.type === "cancelled") {
        return { type: "cancelled" };
    }
    if (result.type === "success" || result.type === "previous_in_flight_request") {
        return { type: "success" };
    }
    const failure = result.type === "rate_limited"
        ? { type: "rate_limited", retryAfter: result.retryAfter }
        : { type: "unknown_error" };
    showQuestEnrollmentFailureToast(quest, failure);
    return failure;
}
function getQuestExpiryTime(quest) {
    const time = new Date(quest.config.expiresAt).getTime();
    return Number.isFinite(time) ? time : Infinity;
}
export function getQueueableAutoCompleteQuests() {
    const settings = getQuestifySettings();
    const includedTypes = settings.questButtonIncludedTypes;
    return Array.from(QuestStore.quests.values())
        .filter(quest => !activeAutoCompletes.has(quest.id))
        .filter(quest => questMatchesIncludedTypes(quest, includedTypes))
        .filter(canAutoCompleteQuest)
        .sort((a, b) => getQuestExpiryTime(a) - getQuestExpiryTime(b));
}
export function setQuestAutoCompleteProgress(questOrId, progress) {
    const questId = typeof questOrId === "string" ? questOrId : questOrId.id;
    const entry = activeAutoCompletes.get(questId);
    if (!entry) {
        return false;
    }
    entry.progress = progress == null ? null : Math.max(0, progress);
    return true;
}
async function waitUntilEnrolled(quest, entry, timeout = 60000, interval = 500) {
    const startedAt = Date.now();
    quest = refreshQuest(quest);
    if (quest.userStatus?.enrolledAt) {
        return quest;
    }
    if (quest.userStatus?.completedAt) {
        return null;
    }
    while (isEntryActive(entry) && !quest.userStatus?.enrolledAt && (Date.now() - startedAt) < timeout) {
        await sleep(interval, entry.abortController.signal);
        quest = refreshQuest(quest);
    }
    if (quest.userStatus?.enrolledAt) {
        return quest;
    }
    QL.warn("AUTO_COMPLETE_ENROLL_TIMEOUT", { questId: quest.id, questName: entry.questName, timeout });
    return null;
}
async function reportVideoQuestProgress(quest, entry, progress, options = {}) {
    quest = refreshQuest(quest);
    const attempts = options.attempts ?? 1;
    const delay = options.delay ?? 2500;
    const displayProgress = options.displayProgress ?? progress;
    if (!quest.userStatus?.enrolledAt) {
        QL.warn("AUTO_COMPLETE_VIDEO_UNENROLLED", { questId: quest.id, questName: entry.questName });
        return false;
    }
    if (quest.userStatus?.completedAt) {
        return true;
    }
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await reportVideoProgress(quest.id, progress);
            setQuestAutoCompleteProgress(quest, displayProgress);
            QL.info("AUTO_COMPLETE_VIDEO_PROGRESS_REPORTED", { questId: quest.id, questName: entry.questName, progress, displayProgress, attempt, attempts });
            return true;
        }
        catch (error) {
            QL.error("AUTO_COMPLETE_VIDEO_PROGRESS_FAILED", { questId: quest.id, questName: entry.questName, progress, attempt, attempts, error });
            if (attempt < attempts) {
                await sleep(delay, entry.abortController.signal);
            }
        }
    }
    return false;
}
function waitForHeartbeatDispatchResult(questId, timeoutMs) {
    let settled = false;
    let cleanup = () => { };
    const promise = new Promise(resolve => {
        const successEvent = "QUESTS_SEND_HEARTBEAT_SUCCESS";
        const failureEvent = "QUESTS_SEND_HEARTBEAT_FAILURE";
        const timeoutId = setTimeout(() => {
            cleanup();
            resolve({ type: "timeout" });
        }, timeoutMs);
        cleanup = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutId);
            FluxDispatcher.unsubscribe(successEvent, onSuccess);
            FluxDispatcher.unsubscribe(failureEvent, onFailure);
        };
        function onSuccess(data) {
            if (data.questId !== questId) {
                return;
            }
            cleanup();
            resolve({ type: "success", userStatus: data.userStatus ?? null });
        }
        function onFailure(data) {
            if (data.questId !== questId) {
                return;
            }
            cleanup();
            resolve({ type: "failure", error: data.error });
        }
        FluxDispatcher.subscribe(successEvent, onSuccess);
        FluxDispatcher.subscribe(failureEvent, onFailure);
    });
    return { promise, cancel: cleanup };
}
function getPlayProgressValue(userStatus, task) {
    return userStatus?.progress?.[task.type]?.value ?? null;
}
async function reportPlayQuestProgress(quest, entry, terminal, options = {}) {
    quest = refreshQuest(quest);
    if (!quest.userStatus?.enrolledAt) {
        QL.warn("AUTO_COMPLETE_PLAY_UNENROLLED", { questId: quest.id, questName: entry.questName });
        return { progress: null, completed: false };
    }
    if (quest.userStatus?.completedAt && !terminal) {
        return { progress: getQuestStoredProgress(quest, entry.task), completed: true };
    }
    const attempts = options.attempts ?? 1;
    const delay = options.delay ?? 2500;
    const timeout = options.timeout ?? 10000;
    const applicationId = options.applicationId ?? entry.task.applications?.[0]?.id;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const dispatchWaiter = waitForHeartbeatDispatchResult(quest.id, timeout);
            try {
                await sendHeartbeat({
                    questId: quest.id,
                    streamKey: options.streamKey,
                    applicationId,
                    terminal,
                });
            }
            catch (error) {
                dispatchWaiter.cancel();
                throw error;
            }
            const dispatchResult = await dispatchWaiter.promise;
            if (dispatchResult.type === "failure") {
                QL.error("AUTO_COMPLETE_PLAY_HEARTBEAT_FAILURE", { questId: quest.id, questName: entry.questName, attempt, attempts, error: dispatchResult.error });
            }
            else if (dispatchResult.type === "timeout") {
                QL.warn("AUTO_COMPLETE_PLAY_HEARTBEAT_TIMEOUT", { questId: quest.id, questName: entry.questName, attempt, attempts, timeout });
            }
            else {
                const updatedQuest = refreshQuest(quest);
                const progress = getPlayProgressValue(dispatchResult.userStatus, entry.task)
                    ?? getQuestStoredProgress(updatedQuest, entry.task)
                    ?? 0;
                const completed = !!dispatchResult.userStatus?.completedAt || !!updatedQuest.userStatus?.completedAt;
                setQuestAutoCompleteProgress(quest, terminal ? progress : Math.max(progress, entry.progress ?? 0));
                QL.info("AUTO_COMPLETE_PLAY_HEARTBEAT_SENT", { questId: quest.id, questName: entry.questName, progress, target: entry.task.target, terminal });
                return { progress, completed };
            }
        }
        catch (error) {
            QL.error("AUTO_COMPLETE_PLAY_HEARTBEAT_ERROR", { questId: quest.id, questName: entry.questName, attempt, attempts, error });
        }
        if (attempt < attempts) {
            await sleep(delay, entry.abortController.signal);
        }
    }
    return { progress: null, completed: false };
}
function startRerenderInterval(entry) {
    clearEntryTimers(entry);
    entry.rerenderInterval = setInterval(() => {
        if (!isEntryActive(entry)) {
            clearEntryTimers(entry);
            return;
        }
        rerenderQuests();
    }, 1000);
}
async function runVideoQuest(quest, entry, target) {
    quest = await waitUntilEnrolled(quest, entry, 60000, 500) ?? quest;
    if (!isEntryActive(entry) || !quest.userStatus?.enrolledAt) {
        return false;
    }
    const reportTarget = target.raw;
    const completionTarget = target.adjusted;
    const enrolledAt = new Date(quest.userStatus.enrolledAt);
    const initialStoredProgress = getQuestStoredProgress(quest, entry.task) ?? 0;
    const initialProgress = getQuestifySettings().completeVideoQuestsQuicker
        ? clampFloat(Math.max(1, (Date.now() - enrolledAt.getTime()) / 1000))
        : Math.max(0, initialStoredProgress);
    let displayedProgress = clampFloat(Math.min(completionTarget, initialProgress));
    let reportedProgress = clampFloat(Math.min(reportTarget, initialProgress));
    let maximumPlaybackTimestamp = Math.floor(reportedProgress);
    let nextReportThreshold = 0;
    let hasReportedInitialProgress = reportedProgress <= 0;
    let lastTickAt = performance.now();
    setQuestAutoCompleteProgress(quest, displayedProgress);
    startRerenderInterval(entry);
    const timeRemaining = Math.max(0, completionTarget - displayedProgress);
    const progressToCover = Math.max(0, reportTarget - reportedProgress);
    const speedFactor = timeRemaining > 0 ? progressToCover / timeRemaining : 0;
    QL.info("AUTO_COMPLETE_VIDEO_STARTED", { questId: quest.id, questName: entry.questName, timeRemaining, target });
    if (timeRemaining <= 0) {
        return reportVideoQuestProgress(quest, entry, Math.min(reportTarget, maximumPlaybackTimestamp), { attempts: 3, displayProgress: completionTarget });
    }
    if (reportedProgress > 0) {
        const initialReport = clampFloat(Math.min(reportTarget, reportedProgress));
        const reported = await reportVideoQuestProgress(quest, entry, initialReport, { attempts: 3, displayProgress: displayedProgress });
        if (!reported || !isEntryActive(entry)) {
            return false;
        }
        hasReportedInitialProgress = true;
        nextReportThreshold = clampFloat(initialReport + randomBetween(6, 8));
    }
    while (isEntryActive(entry) && displayedProgress < completionTarget) {
        await sleep(250, entry.abortController.signal);
        const now = performance.now();
        const elapsedSeconds = clampFloat((now - lastTickAt) / 1000);
        lastTickAt = now;
        displayedProgress = clampFloat(Math.min(completionTarget, displayedProgress + elapsedSeconds));
        reportedProgress = clampFloat(Math.min(reportTarget, reportedProgress + elapsedSeconds * speedFactor));
        maximumPlaybackTimestamp = Math.max(maximumPlaybackTimestamp, Math.floor(reportedProgress));
        setQuestAutoCompleteProgress(quest, displayedProgress);
        if (hasReportedInitialProgress && reportedProgress >= nextReportThreshold && displayedProgress < completionTarget) {
            const progressToReport = clampFloat(Math.min(reportTarget, nextReportThreshold + randomBetween(0, Math.max(0, reportedProgress - nextReportThreshold))));
            const reported = await reportVideoQuestProgress(quest, entry, progressToReport, { displayProgress: displayedProgress });
            if (!reported) {
                return false;
            }
            nextReportThreshold = clampFloat(progressToReport + randomBetween(6, 8));
        }
    }
    return isEntryActive(entry) && reportVideoQuestProgress(quest, entry, Math.min(reportTarget, maximumPlaybackTimestamp), { attempts: 3, displayProgress: completionTarget });
}
async function runPlayQuest(quest, entry, target) {
    quest = await waitUntilEnrolled(quest, entry, 60000, 500) ?? quest;
    if (!isEntryActive(entry) || !quest.userStatus?.enrolledAt) {
        return false;
    }
    const questTarget = target.adjusted;
    const initialProgress = getQuestStoredProgress(quest, entry.task) ?? 0;
    const maximumHeartbeatDurationMs = 60 * 1000;
    const heartbeatBufferMs = 1000;
    setQuestAutoCompleteProgress(quest, initialProgress);
    startRerenderInterval(entry);
    entry.progressInterval = setInterval(() => {
        if (!isEntryActive(entry) || entry.progress == null) {
            return;
        }
        setQuestAutoCompleteProgress(entry.questId, Math.min(questTarget, entry.progress + 1));
    }, 1000);
    QL.info("AUTO_COMPLETE_PLAY_STARTED", { questId: quest.id, questName: entry.questName, remaining: Math.max(0, questTarget - initialProgress), target });
    let heartbeat = await reportPlayQuestProgress(quest, entry, false, { attempts: 3, delay: 2500 });
    if (heartbeat.progress === null) {
        return false;
    }
    while (isEntryActive(entry)) {
        if (heartbeat.completed || heartbeat.progress >= questTarget) {
            await reportPlayQuestProgress(refreshQuest(quest), entry, true, { attempts: 3, delay: 2500 });
            return true;
        }
        const remainingMs = Math.max(0, (questTarget - heartbeat.progress) * 1000);
        await sleep(remainingMs <= maximumHeartbeatDurationMs ? remainingMs + heartbeatBufferMs : maximumHeartbeatDurationMs, entry.abortController.signal);
        heartbeat = await reportPlayQuestProgress(quest, entry, false, { attempts: 3, delay: 2500 });
        if (heartbeat.progress === null) {
            return false;
        }
    }
    return false;
}
async function runAchievementQuest(quest, entry, target) {
    quest = await waitUntilEnrolled(quest, entry, 60000, 500) ?? quest;
    if (!isEntryActive(entry) || !quest.userStatus?.enrolledAt) {
        return false;
    }
    if (!QuestifyNative?.complete) {
        QL.error("AUTO_COMPLETE_ACHIEVEMENT_NATIVE_MISSING", { questId: quest.id, questName: entry.questName });
        return false;
    }
    const appId = entry.task.applications?.[0]?.id;
    if (!appId) {
        QL.warn("AUTO_COMPLETE_ACHIEVEMENT_APP_MISSING", { questId: quest.id, questName: entry.questName });
        return false;
    }
    setQuestAutoCompleteProgress(quest, 0);
    let authCode = null;
    try {
        const response = await RestAPI.post({
            url: `/oauth2/authorize?client_id=${appId}&response_type=code&scope=identify%20applications.entitlements&state=`,
            body: { authorize: true },
        });
        const location = response?.body?.location;
        authCode = location ? new URL(location).searchParams.get("code") : null;
    }
    catch (error) {
        QL.error("AUTO_COMPLETE_ACHIEVEMENT_AUTH_FAILED", { questId: quest.id, questName: entry.questName, error });
        return false;
    }
    if (!authCode) {
        QL.warn("AUTO_COMPLETE_ACHIEVEMENT_AUTH_CODE_MISSING", { questId: quest.id, questName: entry.questName });
        return false;
    }
    const result = await QuestifyNative.complete(appId, authCode, target.adjusted, quest.id, await getActivityReferrer(appId));
    const success = result.success === true;
    setQuestAutoCompleteProgress(quest, success ? target.adjusted : 0);
    try {
        const deauthToken = AuthorizedAppsStore.getNewestTokenForApplication(appId)?.id;
        if (deauthToken) {
            await RestAPI.del({ url: `/oauth2/tokens/${deauthToken}` });
        }
    }
    catch (error) {
        QL.error("AUTO_COMPLETE_ACHIEVEMENT_DEAUTH_FAILED", { questId: quest.id, questName: entry.questName, error });
    }
    if (!success) {
        QL.error("AUTO_COMPLETE_ACHIEVEMENT_FAILED", { questId: quest.id, questName: entry.questName, error: result.error });
    }
    return success;
}
async function runAutoCompleteQuest(quest, entry) {
    const target = getAutoCompleteQuestTarget(entry.task);
    QL.info("AUTO_COMPLETE_RUN_START", {
        questId: quest.id,
        questName: entry.questName,
        kind: entry.kind,
        taskType: entry.task.type,
        target,
    });
    switch (entry.kind) {
        case "watch":
            return runVideoQuest(quest, entry, target);
        case "play":
            return runPlayQuest(quest, entry, target);
        case "achievement":
            return runAchievementQuest(quest, entry, target);
    }
}
function hasRunningQueuedAutoComplete() {
    return Array.from(activeAutoCompletes.values()).some(entry => entry.status === "running");
}
async function runEntry(quest, entry) {
    entry.status = "running";
    updateResumeState();
    try {
        const completed = await runAutoCompleteQuest(quest, entry);
        if (!isEntryActive(entry)) {
            return;
        }
        if (completed) {
            QL.info("AUTO_COMPLETE_COMPLETED", { questId: entry.questId, questName: entry.questName });
        }
        else {
            QL.warn("AUTO_COMPLETE_FAILED", { questId: entry.questId, questName: entry.questName });
        }
    }
    catch (error) {
        if (entry.abortController.signal.aborted) {
            QL.warn("AUTO_COMPLETE_RUN_ABORTED", { questId: entry.questId, questName: entry.questName });
        }
        else {
            QL.error("AUTO_COMPLETE_RUN_ERROR", { questId: entry.questId, questName: entry.questName, error });
        }
    }
    finally {
        clearEntryTimers(entry);
        if (activeAutoCompletes.get(entry.questId) !== entry) {
            return;
        }
        activeAutoCompletes.delete(entry.questId);
        resetQuestsToResume(quest);
        updateResumeState();
        if (!getQuestifySettings().autoCompleteQuestsSimultaneously && !suppressQueueDrain) {
            runNextQueuedQuest();
        }
    }
}
function runNextQueuedQuest() {
    if (suppressQueueDrain || getQuestifySettings().autoCompleteQuestsSimultaneously || hasRunningQueuedAutoComplete()) {
        return;
    }
    const nextEntry = Array.from(activeAutoCompletes.values()).find(entry => entry.status === "queued");
    if (!nextEntry) {
        return;
    }
    const nextQuest = QuestStore.getQuest(nextEntry.questId);
    if (!nextQuest) {
        activeAutoCompletes.delete(nextEntry.questId);
        updateResumeState();
        runNextQueuedQuest();
        return;
    }
    void runEntry(nextQuest, nextEntry);
}
export function processQuestForAutoComplete(quest, options = {}) {
    const { force = false, source = "manual" } = options;
    const questName = normalizeQuestName(quest);
    const existingEntry = activeAutoCompletes.get(quest.id);
    if (!isAutoCompleteRuntimeReady(true)) {
        return false;
    }
    if (existingEntry) {
        return true;
    }
    if (force) {
        manuallyStoppedQuestIds.delete(quest.id);
    }
    else if (manuallyStoppedQuestIds.has(quest.id)) {
        QL.warn("AUTO_COMPLETE_MANUALLY_STOPPED", { questId: quest.id, questName });
        return false;
    }
    if (quest.userStatus?.completedAt || getQuestStatus(quest, getIgnoredQuestIDs()) !== QuestStatus.Unclaimed) {
        QL.warn("AUTO_COMPLETE_INCOMPATIBLE_STATUS", { questId: quest.id, questName });
        return false;
    }
    const resolvedQuest = resolveAutoCompleteQuest(quest);
    if (!resolvedQuest) {
        QL.warn("AUTO_COMPLETE_INCOMPATIBLE_TASKS", { questId: quest.id, questName });
        return false;
    }
    const entry = createAutoCompleteEntry(quest, resolvedQuest.task, resolvedQuest.kind);
    activeAutoCompletes.set(quest.id, entry);
    if (getQuestifySettings().autoCompleteQuestsSimultaneously) {
        void runEntry(quest, entry);
    }
    else {
        updateResumeState();
        runNextQueuedQuest();
    }
    QL.info("AUTO_COMPLETE_STARTED", {
        questId: quest.id,
        questName,
        source,
        mode: getQuestifySettings().autoCompleteQuestsSimultaneously ? "simultaneous" : "queue",
        taskType: entry.task.type,
    });
    return true;
}
export function isQueueAllAutoCompleteQuestsInProgress() {
    return queueAllAutoCompleteQuestsAbortController !== null;
}
export function stopQueueAllAutoCompleteQuests() {
    queueAllAutoCompleteQuestsAbortController?.abort();
}
export async function queueAllAutoCompleteQuests() {
    if (queueAllAutoCompleteQuestsAbortController !== null ||
        getQuestifySettings().autoCompleteQuestsSimultaneously ||
        isQuestEnrollmentRateLimited()) {
        return 0;
    }
    const abortController = new AbortController();
    const { signal } = abortController;
    queueAllAutoCompleteQuestsAbortController = abortController;
    try {
        let queued = 0;
        let enrollmentAttempts = 0;
        let rateLimitEnrollmentFailures = 0;
        let nonRateLimitEnrollmentFailures = 0;
        let first = true;
        for (const quest of getQueueableAutoCompleteQuests()) {
            if (signal.aborted) {
                break;
            }
            if (!first) {
                try {
                    await sleep(1000, signal);
                }
                catch (error) {
                    if (signal.aborted) {
                        break;
                    }
                    throw error;
                }
            }
            first = false;
            const refreshedQuest = refreshQuest(quest);
            if (!refreshedQuest.userStatus?.enrolledAt) {
                if (enrollmentAttempts >= maxBatchEnrollmentAttempts) {
                    break;
                }
                enrollmentAttempts++;
            }
            const enrollment = await ensureQuestEnrolledForAutoComplete(refreshedQuest, { method: "manual" });
            if (signal.aborted) {
                break;
            }
            if (enrollment.type !== "success") {
                if (enrollment.type === "rate_limited") {
                    rateLimitEnrollmentFailures++;
                    if (rateLimitEnrollmentFailures >= maxBatchRateLimitEnrollmentFailures) {
                        break;
                    }
                }
                else {
                    nonRateLimitEnrollmentFailures++;
                    if (nonRateLimitEnrollmentFailures >= maxBatchNonRateLimitEnrollmentFailures) {
                        break;
                    }
                }
                continue;
            }
            if (processQuestForAutoComplete(refreshQuest(refreshedQuest), { force: true, source: "manual" })) {
                queued++;
            }
        }
        return queued;
    }
    finally {
        if (queueAllAutoCompleteQuestsAbortController === abortController) {
            queueAllAutoCompleteQuestsAbortController = null;
        }
    }
}
export function stopQuestAutoComplete(questOrId, options = {}) {
    const { manual = true, preserveResume = false, terminalHeartbeat = false } = options;
    const questId = typeof questOrId === "string" ? questOrId : questOrId.id;
    const entry = activeAutoCompletes.get(questId);
    const resumeQuestIds = preserveResume ? getResumeQuestIds() : undefined;
    if (manual) {
        manuallyStoppedQuestIds.add(questId);
    }
    if (!entry) {
        updateResumeState(resumeQuestIds);
        return false;
    }
    clearEntryTimers(entry);
    entry.abortController.abort();
    activeAutoCompletes.delete(questId);
    const quest = typeof questOrId === "string" ? QuestStore.getQuest(questId) : questOrId;
    if (terminalHeartbeat && quest && entry.kind === "play" && entry.status === "running") {
        void reportPlayQuestProgress(refreshQuest(quest), entry, true, { attempts: 1 });
    }
    if (!preserveResume) {
        resetQuestsToResume(quest);
    }
    updateResumeState(resumeQuestIds);
    if (!getQuestifySettings().autoCompleteQuestsSimultaneously && !suppressQueueDrain) {
        runNextQueuedQuest();
    }
    QL.info("AUTO_COMPLETE_STOPPED", { questId, manual, preserveResume, terminalHeartbeat });
    return true;
}
export function stopAllAutoCompletes(options = {}) {
    stopQueueAllAutoCompleteQuests();
    const resumeQuestIds = options.preserveResume ? getResumeQuestIds() : undefined;
    suppressQueueDrain = true;
    try {
        for (const questId of Array.from(activeAutoCompletes.keys())) {
            stopQuestAutoComplete(questId, options);
        }
        updateResumeState(resumeQuestIds);
    }
    finally {
        suppressQueueDrain = false;
    }
}
export function stopAutoCompletesForRunningGames(gameIds) {
    let stoppedAny = false;
    for (const entry of Array.from(activeAutoCompletes.values())) {
        const quest = QuestStore.getQuest(entry.questId);
        if (entry.kind === "play" && quest && entry.task.applications?.some(({ id }) => gameIds.includes(id))) {
            stopQuestAutoComplete(quest, { manual: false, preserveResume: false });
            stoppedAny = true;
        }
    }
    if (stoppedAny) {
        rerenderQuests();
    }
    return stoppedAny;
}
export function resumeInterruptedAutoCompletes() {
    if (!getQuestifySettings().resumeInterruptedQuests) {
        return;
    }
    const userId = getCurrentUserId();
    const resumeState = userId ? getQuestifySettings().resumeQuestIDs[userId] : null;
    if (!userId || !resumeState?.questIDs.length) {
        return;
    }
    if (isResumeStateExpired(resumeState.timestamp)) {
        delete getQuestifySettings().resumeQuestIDs[userId];
        QL.info("AUTO_COMPLETE_RESUME_EXPIRED", { userId, timestamp: resumeState.timestamp, maxAge: resumeExpiryMs });
        return;
    }
    const resumeQuestIds = Array.from(new Set(resumeState.questIDs));
    const resumableQuests = resumeQuestIds
        .map(questId => QuestStore.getQuest(questId))
        .filter((quest) => quest != null);
    if (resumableQuests.length === 0) {
        updateResumeState();
        return;
    }
    QL.info("AUTO_COMPLETE_RESUME_INTERRUPTED", {
        userId,
        timestamp: resumeState.timestamp,
        questIDs: resumeQuestIds,
    });
    const resumedQuestIds = new Set();
    for (const quest of resumableQuests) {
        if (processQuestForAutoComplete(quest, { force: true, source: "resume" })) {
            resumedQuestIds.add(quest.id);
        }
    }
    updateResumeState();
    const droppedQuestIds = resumeQuestIds.filter(questId => !resumedQuestIds.has(questId));
    if (droppedQuestIds.length > 0) {
        QL.warn("AUTO_COMPLETE_RESUME_DROPPED_QUESTS", {
            userId,
            questIDs: droppedQuestIds,
        });
    }
}
export function getActiveAutoCompletes() {
    return Array.from(activeAutoCompletes.values());
}
