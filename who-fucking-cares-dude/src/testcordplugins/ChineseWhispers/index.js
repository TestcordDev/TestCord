/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { addMessagePreSendListener, removeMessagePreSendListener, } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
let languages = [
    "en", // English
    "af", // Afrikaans
    "sq", // Albanian
    "am", // Amharic
    "ar", // Arabic
    "hy", // Armenian
    "az", // Azerbaijani
    "eu", // Basque
    "be", // Belarusian
    "bn", // Bengali
    "bs", // Bosnian
    "bg", // Bulgarian
    "ca", // Catalan
    "ceb", // Cebuano
    "ny", // Chichewa (Chewa, Nyanja)
    "zh", // Chinese (Simplified and Traditional)
    "co", // Corsican
    "hr", // Croatian
    "cs", // Czech
    "da", // Danish
    "nl", // Dutch
    "eo", // Esperanto
    "et", // Estonian
    "tl", // Filipino (Tagalog)
    "fi", // Finnish
    "fr", // French
    "fy", // Frisian
    "gl", // Galician
    "ka", // Georgian
    "de", // German
    "el", // Greek
    "gu", // Gujarati
    "ht", // Haitian Creole
    "ha", // Hausa
    "haw", // Hawaiian
    "iw", // Hebrew
    "hi", // Hindi
    "hmn", // Hmong
    "hu", // Hungarian
    "is", // Icelandic
    "ig", // Igbo
    "id", // Indonesian
    "ga", // Irish
    "it", // Italian
    "ja", // Japanese
    "jv", // Javanese
    "kn", // Kannada
    "kk", // Kazakh
    "km", // Khmer
    "rw", // Kinyarwanda
    "ko", // Korean
    "ku", // Kurdish
    "ky", // Kyrgyz
    "lo", // Lao
    "la", // Latin
    "lv", // Latvian
    "lt", // Lithuanian
    "lb", // Luxembourgish
    "mk", // Macedonian
    "mg", // Malagasy
    "ms", // Malay
    "ml", // Malayalam
    "mt", // Maltese
    "mi", // Maori
    "mr", // Marathi
    "mn", // Mongolian
    "my", // Burmese
    "ne", // Nepali
    "no", // Norwegian
    "or", // Odia (Oriya)
    "ps", // Pashto
    "fa", // Persian
    "pl", // Polish
    "pt", // Portuguese
    "pa", // Punjabi
    "ro", // Romanian
    "ru", // Russian
    "sm", // Samoan
    "gd", // Scots Gaelic
    "sr", // Serbian
    "st", // Sesotho
    "sn", // Shona
    "sd", // Sindhi
    "si", // Sinhala
    "sk", // Slovak
    "sl", // Slovenian
    "so", // Somali
    "es", // Spanish
    "su", // Sundanese
    "sw", // Swahili
    "sv", // Swedish
    "tg", // Tajik
    "ta", // Tamil
    "tt", // Tatar
    "te", // Telugu
    "th", // Thai
    "tr", // Turkish
    "tk", // Turkmen
    "uk", // Ukrainian
    "ur", // Urdu
    "ug", // Uyghur
    "uz", // Uzbek
    "vi", // Vietnamese
    "cy", // Welsh
    "xh", // Xhosa
    "yi", // Yiddish
    "yo", // Yoruba
    "zu" // Zulu
];
const settings = definePluginSettings({
    intensity: {
        type: 5 /* OptionType.SLIDER */,
        description: "How many languages the message is translated between- More for more distortion, less for minor changes",
        default: languages.length,
        markers: Array(languages.length - 2).fill(0).map((_, index) => index + 2),
        stickToMarkers: true,
    },
    shuffle: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "If the languages array should be shuffled with every message. Better variety but you will not be able to reproduce messages",
        default: true
    }
});
export async function comedicChineseWhispers(inputText, language) {
    let currentText = inputText;
    if (settings.store.shuffle) {
        languages = languages.map(value => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value);
    }
    language = language.concat("en");
    for (let i = 0; i < language.length; i++) {
        const sourceLang = i === 0 ? "auto" : language[i - 1];
        const targetLang = language[i];
        const translation = await translateText(sourceLang, targetLang, currentText);
        currentText = translation;
    }
    return currentText;
}
async function translateText(sourceLang, targetLang, text) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&dj=1&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to translate "${text}" from ${sourceLang} to ${targetLang}: ${response.status} ${response.statusText}`);
    }
    const { sentences } = await response.json();
    const translatedText = sentences.map(s => s?.trans).filter(Boolean).join("");
    return translatedText;
}
const presendObject = async (channelId, msg) => {
    msg.content = await comedicChineseWhispers(msg.content, languages.slice(0, settings.store.intensity));
};
export default definePlugin({
    name: "ChineseWhispers",
    description: "Translate plugin but 20x more funny",
    tags: ["Chat", "Fun"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessageEventsAPI"],
    start() {
        addMessagePreSendListener(presendObject);
    },
    stop() {
        removeMessagePreSendListener(presendObject);
    },
    settings
});
