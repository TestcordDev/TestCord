/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TRANSLATION_CACHE_MAX } from "@utils/cacheLimits";
import { Logger } from "@utils/Logger";

import { getExcludedLanguages, settings } from "../settings";
import { CachedTranslation, TranslateResponse } from "../types";

const logger = new Logger("MessageTranslate");

const translationCache = new Map<string, CachedTranslation>();
const inProgress = new Set<string>();
const failed = new Map<string, string>();

export function getCached(messageId: string): CachedTranslation | undefined {
    return translationCache.get(messageId);
}

export function hasFailed(messageId: string, text: string): boolean {
    return failed.get(messageId) === text;
}

export function isInProgress(messageId: string): boolean {
    return inProgress.has(messageId);
}

export function clearCache(messageId: string) {
    translationCache.delete(messageId);
    failed.delete(messageId);
}

async function fetchTranslation(text: string, targetLang: string): Promise<TranslateResponse> {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&dj=1&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Translation API returned ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

export async function translate(messageId: string, text: string): Promise<CachedTranslation | null> {
    if (inProgress.has(messageId)) return null;
    if (translationCache.has(messageId)) return translationCache.get(messageId)!;

    inProgress.add(messageId);

    try {
        const targetLang = settings.store.targetLanguage.trim().toLowerCase();
        const response = await fetchTranslation(text, targetLang);
        const sourceLang = response.src.trim().toLowerCase();

        if (sourceLang === targetLang || response.confidence < settings.store.confidenceRequirement || getExcludedLanguages().has(sourceLang)) {
            failed.set(messageId, text);
            if (TRANSLATION_CACHE_MAX < Infinity && failed.size > TRANSLATION_CACHE_MAX) {
                const first = failed.keys().next().value;
                if (first !== undefined) failed.delete(first);
            }
            return null;
        }

        const translatedText = response.sentences.map(s => s.trans).filter(Boolean).join("");
        if (!translatedText || translatedText === text) {
            failed.set(messageId, text);
            return null;
        }

        const entry: CachedTranslation = {
            original: text,
            translated: translatedText,
            sourceLang: response.src,
        };
        translationCache.set(messageId, entry);
        if (TRANSLATION_CACHE_MAX < Infinity && translationCache.size > TRANSLATION_CACHE_MAX) {
            const first = translationCache.keys().next().value;
            if (first !== undefined) translationCache.delete(first);
        }
        return entry;
    } catch (e) {
        logger.error("Translation failed", e);
        failed.set(messageId, text);
        if (TRANSLATION_CACHE_MAX < Infinity && failed.size > TRANSLATION_CACHE_MAX) {
            const first = failed.keys().next().value;
            if (first !== undefined) failed.delete(first);
        }
        return null;
    } finally {
        inProgress.delete(messageId);
    }
}
