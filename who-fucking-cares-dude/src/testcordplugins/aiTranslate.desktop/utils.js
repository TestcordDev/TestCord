/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { buildTranslationRequest, DEFAULT_OPENCODE_ZEN_MODEL, getContentCacheKey, getGenerationControlsRetryPayload, isOpenCodeFreeModel, isRecord, parseTranslationResponse, } from "./helpers";
import { settings } from "./settings";
const Native = VencordNative.pluginHelpers.AITranslate;
const logger = new Logger("AITranslate");
const contentTranslationCache = new Map();
const contentInProgress = new Map();
const generationControlsUnsupported = new Set();
const rateLimitedUntil = new Map();
const lastFailureLog = new Map();
const queuedRequests = [];
const activeRequestIds = new Set();
const MAX_CONCURRENT_TRANSLATION_REQUESTS = 1;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const FAILURE_LOG_COOLDOWN_MS = 30_000;
let activeRequestCount = 0;
let contentCacheGeneration = 0;
let translationGeneration = 0;
let requestNonce = 0;
let lastMissingTranslationLog = 0;
function getApiErrorMessage(body, status) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        parsed = null;
    }
    if (isRecord(parsed) && isRecord(parsed.error)) {
        const { message, param, status: errorStatus } = parsed.error;
        if (typeof message === "string" && typeof param === "string")
            return `${message}. ${param}`;
        if (typeof message === "string" && typeof errorStatus === "string")
            return `${message}. ${errorStatus}`;
        if (typeof message === "string")
            return message;
    }
    return status > 0 ? `Request failed with status ${status}.` : "Request failed.";
}
function getRequestConfigKey(config) {
    return JSON.stringify([config.model]);
}
function drainQueuedRequests() {
    while (activeRequestCount < MAX_CONCURRENT_TRANSLATION_REQUESTS) {
        const queued = queuedRequests.shift();
        if (!queued)
            return;
        activeRequestCount++;
        queued.run();
    }
}
function enqueueTranslationRequest(task) {
    return new Promise((resolve, reject) => {
        queuedRequests.push({
            reject,
            run() {
                task().then(resolve, reject).finally(() => {
                    activeRequestCount--;
                    drainQueuedRequests();
                });
            },
        });
        drainQueuedRequests();
    });
}
function getRateLimitedResponse(config) {
    const retryAt = rateLimitedUntil.get(getRequestConfigKey(config));
    if (retryAt === undefined || Date.now() >= retryAt)
        return null;
    return { ok: false, status: 429, body: "", error: "Rate limited. Waiting before retrying." };
}
export function getTranslationRateLimitMs(targetLanguage = settings.store.targetLanguage) {
    const config = getTranslationConfig(targetLanguage, false);
    if (!config)
        return 0;
    const retryAt = rateLimitedUntil.get(getRequestConfigKey(config));
    return retryAt === undefined ? 0 : Math.max(0, retryAt - Date.now());
}
function rememberRateLimit(config, response) {
    if (response.status !== 429)
        return;
    rateLimitedUntil.set(getRequestConfigKey(config), Date.now() + RATE_LIMIT_COOLDOWN_MS);
}
function createRequestId() {
    requestNonce = (requestNonce + 1) % Number.MAX_SAFE_INTEGER;
    return `${Date.now().toString(36)}-${requestNonce.toString(36)}`;
}
function isCancellationError(error) {
    return error instanceof Error && error.message === "Request cancelled.";
}
function getCancelledResponse() {
    return { ok: false, status: 0, body: "", error: "Request cancelled." };
}
async function sendTranslateRequest(payload) {
    const requestId = createRequestId();
    activeRequestIds.add(requestId);
    try {
        return await Native.makeTranslateRequest(requestId, payload);
    }
    finally {
        activeRequestIds.delete(requestId);
    }
}
export function getTranslationGeneration() {
    return translationGeneration;
}
export function isTranslationGenerationCurrent(generation) {
    return generation === translationGeneration;
}
export function abortActiveTranslations() {
    translationGeneration++;
    for (const queued of queuedRequests.splice(0))
        queued.reject(new Error("Request cancelled."));
    for (const requestId of activeRequestIds) {
        void Native.cancelTranslateRequest(requestId).then(undefined, (error) => logger.warn("Could not cancel translation request.", error));
    }
    activeRequestIds.clear();
    contentInProgress.clear();
}
export function clearContentTranslationCache() {
    contentCacheGeneration++;
    contentTranslationCache.clear();
    contentInProgress.clear();
    generationControlsUnsupported.clear();
    rateLimitedUntil.clear();
    lastFailureLog.clear();
    lastMissingTranslationLog = 0;
}
function getConfiguredModel() {
    const { model } = settings.store;
    if (typeof model === "string" && isOpenCodeFreeModel(model))
        return model.trim();
    return DEFAULT_OPENCODE_ZEN_MODEL;
}
function getTranslationConfig(targetLanguage, logFailure = true) {
    const model = getConfiguredModel();
    const normalizedTargetLanguage = targetLanguage.trim();
    if (!model || !normalizedTargetLanguage) {
        if (logFailure)
            logger.warn("Model and target language are required.");
        return null;
    }
    return {
        model,
        targetLanguage: normalizedTargetLanguage,
        systemPrompt: settings.store.systemPrompt,
    };
}
function showTranslationRequestFailure(response) {
    if (response.error === "Request cancelled.")
        return null;
    const message = response.error ?? getApiErrorMessage(response.body, response.status);
    const now = Date.now();
    const last = lastFailureLog.get(message) ?? 0;
    if (now - last > FAILURE_LOG_COOLDOWN_MS) {
        lastFailureLog.set(message, now);
        logger.warn(`Translation request failed. ${message}`);
    }
    return null;
}
function showMissingTranslationFailure() {
    const now = Date.now();
    if (now - lastMissingTranslationLog > FAILURE_LOG_COOLDOWN_MS) {
        lastMissingTranslationLog = now;
        logger.warn("Translation response did not include translated text.");
    }
    return null;
}
async function makeTranslateRequestWithRetry(config, buildPayload) {
    try {
        return await enqueueTranslationRequest(async () => {
            const configKey = getRequestConfigKey(config);
            const controlsUnsupported = generationControlsUnsupported.has(configKey);
            const useGenerationControls = !controlsUnsupported;
            const payload = buildPayload(config, useGenerationControls);
            let response = getRateLimitedResponse(config) ?? await sendTranslateRequest(payload);
            rememberRateLimit(config, response);
            if (response.ok)
                return response;
            const retryPayload = getGenerationControlsRetryPayload(response.body, payload);
            if (!retryPayload)
                return response;
            generationControlsUnsupported.add(configKey);
            logger.warn("Retrying translation request without generation controls.");
            response = getRateLimitedResponse(config) ?? await sendTranslateRequest(retryPayload);
            rememberRateLimit(config, response);
            return response;
        });
    }
    catch (error) {
        if (isCancellationError(error))
            return getCancelledResponse();
        logger.warn("Translation request failed.", error);
        return { ok: false, status: 0, body: "", error: "Request failed." };
    }
}
async function requestTranslation(text, config) {
    const response = await makeTranslateRequestWithRetry(config, (requestConfig, useGenerationControls) => JSON.stringify(buildTranslationRequest(text, requestConfig.targetLanguage, requestConfig.model, requestConfig.systemPrompt, useGenerationControls)));
    if (!response.ok)
        return showTranslationRequestFailure(response);
    const parsed = parseTranslationResponse(response.body);
    if (!parsed)
        return showMissingTranslationFailure();
    return { translated: parsed.translatedText };
}
export async function translateText(text, targetLanguage = settings.store.targetLanguage) {
    const config = getTranslationConfig(targetLanguage);
    if (!config)
        return null;
    const cacheKey = getContentCacheKey(text, config);
    const cached = contentTranslationCache.get(cacheKey);
    if (cached)
        return cached;
    const active = contentInProgress.get(cacheKey);
    if (active)
        return await active;
    const cacheGeneration = contentCacheGeneration;
    const requestGeneration = translationGeneration;
    const promise = requestTranslation(text, config);
    contentInProgress.set(cacheKey, promise);
    try {
        const translation = await promise;
        if (requestGeneration !== translationGeneration)
            return null;
        if (translation && cacheGeneration === contentCacheGeneration)
            contentTranslationCache.set(cacheKey, translation);
        return translation;
    }
    finally {
        if (contentInProgress.get(cacheKey) === promise)
            contentInProgress.delete(cacheKey);
    }
}
