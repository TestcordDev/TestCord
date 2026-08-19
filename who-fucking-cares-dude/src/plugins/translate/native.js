/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export async function makeDeeplTranslateRequest(_, pro, apiKey, payload) {
    const url = pro
        ? "https://api.deepl.com/v2/translate"
        : "https://api-free.deepl.com/v2/translate";
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `DeepL-Auth-Key ${apiKey}`
            },
            body: payload
        });
        const data = await res.text();
        return { status: res.status, data };
    }
    catch (e) {
        return { status: -1, data: String(e) };
    }
}
export async function makeKagiTranslateRequest(_, token, text, sourceLang, targetLang) {
    const url = "https://translate.kagi.com/api/translate";
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cookie": `kagi_session=${token}`
            },
            body: JSON.stringify({
                text,
                from: sourceLang,
                to: targetLang,
                model: "standard"
            }),
        });
        const data = await res.json();
        return { status: res.status, data };
    }
    catch (e) {
        return { status: -1, data: String(e) };
    }
}
