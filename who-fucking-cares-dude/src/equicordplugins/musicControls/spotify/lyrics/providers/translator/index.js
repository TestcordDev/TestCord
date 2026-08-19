/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import settings from "@equicordplugins/musicControls";
import { Provider } from "@equicordplugins/musicControls/spotify/lyrics/providers/types";
async function googleTranslate(text, targetLang, romanize) {
    const url = "https://translate.googleapis.com/translate_a/single?" + new URLSearchParams({
        // see https://stackoverflow.com/a/29537590 for more params
        // holy shidd nvidia
        client: "gtx",
        // source language
        sl: "auto",
        // target language
        tl: targetLang,
        // what to return, t = translation probably
        dt: romanize ? "rm" : "t",
        // Send json object response instead of weird array
        dj: "1",
        source: "input",
        // query, duh
        q: text
    });
    const res = await fetch(url);
    if (!res.ok)
        return null;
    return await res.json();
}
async function processLyrics(lyrics, targetLang, romanize) {
    if (!lyrics)
        return null;
    const nonDuplicatedLyrics = lyrics.filter((lyric, index, self) => self.findIndex(l => l.text === lyric.text) === index);
    const processedLyricsResp = await Promise.all(nonDuplicatedLyrics.map(async (lyric) => {
        if (!lyric.text)
            return [lyric.text, null];
        const translation = await googleTranslate(lyric.text, targetLang, romanize);
        if (!translation || !translation.sentences || translation.sentences.length === 0)
            return [lyric.text, null];
        return [lyric.text, romanize ? translation.sentences[0].src_translit : translation.sentences[0].trans];
    }));
    if (processedLyricsResp.every(mapping => mapping[1] === null))
        return null;
    return lyrics.map(lyric => ({
        ...lyric,
        text: processedLyricsResp.find(mapping => mapping[0] === lyric.text)?.[1] ?? lyric.text
    }));
}
async function translateLyrics(lyrics) {
    return await processLyrics(lyrics, settings.store.TranslateTo, false);
}
async function romanizeLyrics(lyrics) {
    return await processLyrics(lyrics, "", true);
}
export const lyricsAlternativeFetchers = {
    [Provider.Translated]: translateLyrics,
    [Provider.Romanized]: romanizeLyrics
};
