/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { classNameFactory } from "@utils/css";
import { onlyOnce } from "@utils/onlyOnce";
import { showToast, Toasts } from "@webpack/common";
import { DeeplLanguages, deeplLanguageToGoogleLanguage, GoogleLanguages } from "../../plugins/translate/languages";
import { resetLanguageDefaults, settings } from "./settings";
export const cl = classNameFactory("vc-ntrans-");
const Native = VencordNative.pluginHelpers.Translate;
export const getLanguages = () => IS_WEB || settings.store.service === "google"
    ? GoogleLanguages
    : DeeplLanguages;
export async function translate(kind, text) {
    const fn = IS_WEB || settings.store.service === "google"
        ? googleTranslate
        : deeplTranslate;
    try {
        return await fn(text, settings.store[`${kind}Input`], settings.store[`${kind}Output`]);
    }
    catch (e) {
        const userMessage = typeof e === "string"
            ? e
            : "Something went wrong. If this issue persists, please check the console or ask for help in the support server.";
        showToast(userMessage, Toasts.Type.FAILURE);
        throw e instanceof Error ? e : new Error(userMessage);
    }
}
async function googleTranslate(text, sourceLang, targetLang) {
    const url = "https://translate-pa.googleapis.com/v1/translate?" + new URLSearchParams({
        "params.client": "gtx",
        "dataTypes": "TRANSLATION",
        "key": "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA",
        "query.sourceLanguage": sourceLang,
        "query.targetLanguage": targetLang,
        "query.text": text,
    });
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Failed to translate "${text}" (${sourceLang} -> ${targetLang})`
            + `\n${res.status} ${res.statusText}`);
    const { sourceLanguage, translation } = await res.json();
    return {
        sourceLanguage: GoogleLanguages[sourceLanguage] ?? sourceLanguage,
        text: translation
    };
}
function fallbackToGoogle(text, sourceLang, targetLang) {
    return googleTranslate(text, deeplLanguageToGoogleLanguage(sourceLang), deeplLanguageToGoogleLanguage(targetLang));
}
const showDeeplApiQuotaToast = onlyOnce(() => showToast("Deepl API quota exceeded. Falling back to Google Translate", Toasts.Type.FAILURE));
async function deeplTranslate(text, sourceLang, targetLang) {
    if (!settings.store.deeplApiKey) {
        showToast("DeepL API key is not set. Resetting to Google", Toasts.Type.FAILURE);
        settings.store.service = "google";
        resetLanguageDefaults();
        return fallbackToGoogle(text, sourceLang, targetLang);
    }
    const { status, data } = await Native.makeDeeplTranslateRequest(settings.store.service === "deepl-pro", settings.store.deeplApiKey, JSON.stringify({
        text: [text],
        target_lang: targetLang,
        source_lang: sourceLang.split("-")[0]
    }));
    switch (status) {
        case 200: break;
        case -1: throw "Failed to connect to DeepL API: " + data;
        case 403: throw "Invalid DeepL API key or version";
        case 456:
            showDeeplApiQuotaToast();
            return fallbackToGoogle(text, sourceLang, targetLang);
        default:
            throw new Error(`Failed to translate "${text}" (${sourceLang} -> ${targetLang})\n${status} ${data}`);
    }
    const { translations } = JSON.parse(data);
    const src = translations[0].detected_source_language;
    return {
        sourceLanguage: DeeplLanguages[src] ?? src,
        text: translations[0].text
    };
}
