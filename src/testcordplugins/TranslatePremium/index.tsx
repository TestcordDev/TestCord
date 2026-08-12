/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, findGroupChildrenByChildId, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message, User } from "@vencord/discord-types";
import { Menu, MessageStore, Toasts, UserStore } from "@webpack/common";

const GoogleLanguages = {
    "auto": "Detect language",
    "af": "Afrikaans", "sq": "Albanian", "am": "Amharic", "ar": "Arabic",
    "hy": "Armenian", "as": "Assamese", "ay": "Aymara", "az": "Azerbaijani",
    "bm": "Bambara", "eu": "Basque", "be": "Belarusian", "bn": "Bengali",
    "bho": "Bhojpuri", "bs": "Bosnian", "bg": "Bulgarian", "ca": "Catalan",
    "ceb": "Cebuano", "ny": "Chichewa", "zh-CN": "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)", "co": "Corsican", "hr": "Croatian",
    "cs": "Czech", "da": "Danish", "dv": "Dhivehi", "doi": "Dogri",
    "nl": "Dutch", "en": "English", "eo": "Esperanto", "et": "Estonian",
    "ee": "Ewe", "tl": "Filipino", "fi": "Finnish", "fr": "French",
    "fy": "Frisian", "gl": "Galician", "ka": "Georgian", "de": "German",
    "el": "Greek", "gn": "Guarani", "gu": "Gujarati", "ht": "Haitian Creole",
    "ha": "Hausa", "haw": "Hawaiian", "iw": "Hebrew", "hi": "Hindi",
    "hmn": "Hmong", "hu": "Hungarian", "is": "Icelandic", "ig": "Igbo",
    "ilo": "Ilocano", "id": "Indonesian", "ga": "Irish", "it": "Italian",
    "ja": "Japanese", "jw": "Javanese", "kn": "Kannada", "kk": "Kazakh",
    "km": "Khmer", "rw": "Kinyarwanda", "ko": "Korean", "kri": "Krio",
    "ku": "Kurdish", "ky": "Kyrgyz", "lo": "Lao", "la": "Latin",
    "lv": "Latvian", "ln": "Lingala", "lt": "Lithuanian", "lg": "Luganda",
    "lb": "Luxembourgish", "mk": "Macedonian", "mai": "Maithili",
    "mg": "Malagasy", "ms": "Malay", "ml": "Malayalam", "mt": "Maltese",
    "mi": "Maori", "mr": "Marathi", "mn": "Mongolian", "my": "Myanmar",
    "ne": "Nepali", "no": "Norwegian", "or": "Odia", "om": "Oromo",
    "ps": "Pashto", "fa": "Persian", "pl": "Polish", "pt": "Portuguese",
    "pa": "Punjabi", "qu": "Quechua", "ro": "Romanian", "ru": "Russian",
    "sm": "Samoan", "sa": "Sanskrit", "gd": "Scots Gaelic", "sr": "Serbian",
    "st": "Sesotho", "sn": "Shona", "sd": "Sindhi", "si": "Sinhala",
    "sk": "Slovak", "sl": "Slovenian", "so": "Somali", "es": "Spanish",
    "su": "Sundanese", "sw": "Swahili", "sv": "Swedish", "tg": "Tajik",
    "ta": "Tamil", "tt": "Tatar", "te": "Telugu", "th": "Thai",
    "ti": "Tigrinya", "ts": "Tsonga", "tr": "Turkish", "tk": "Turkmen",
    "uk": "Ukrainian", "ur": "Urdu", "ug": "Uyghur", "uz": "Uzbek",
    "vi": "Vietnamese", "cy": "Welsh", "xh": "Xhosa", "yi": "Yiddish",
    "yo": "Yoruba", "zu": "Zulu",
};

function langOptions() {
    return Object.entries(GoogleLanguages)
        .filter(([k]) => k !== "auto")
        .map(([k, v]) => ({ label: v, value: k, default: k === "en" }));
}

const settings = definePluginSettings({
    targetLanguage: {
        type: OptionType.SELECT,
        description: "Translate messages to this language",
        options: langOptions(),
        restartNeeded: false
    },
    skipLanguage: {
        type: OptionType.SELECT,
        description: "Do not translate if the message is already in this language",
        options: langOptions(),
        restartNeeded: false
    },
    trackedUsers: {
        type: OptionType.STRING,
        description: "Comma-separated user IDs to auto-translate (managed via context menu)",
        default: "",
        restartNeeded: false
    }
});

const originalMessages = new Map<string, string>();
const MAX_ORIGINAL_MESSAGES = 1000;

function getTrackedIds(): string[] {
    return settings.store.trackedUsers.split(",").map(s => s.trim()).filter(Boolean);
}

function addTracked(id: string) {
    const ids = getTrackedIds();
    if (ids.includes(id)) return;
    ids.push(id);
    settings.store.trackedUsers = ids.join(",");
}

function removeTracked(id: string) {
    settings.store.trackedUsers = getTrackedIds().filter(x => x !== id).join(",");
}

function isTracked(id: string): boolean {
    return getTrackedIds().includes(id);
}

async function googleTranslate(text: string): Promise<{ text: string; lang: string; } | null> {
    if (!text.trim()) return null;

    const targetLang = settings.store.targetLanguage || "en";
    const url = "https://translate-pa.googleapis.com/v1/translate?" + new URLSearchParams({
        "params.client": "gtx",
        "dataTypes": "TRANSLATION",
        "key": "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA",
        "query.sourceLanguage": "auto",
        "query.targetLanguage": targetLang,
        "query.text": text,
    });

    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();

        const skipLang = settings.store.skipLanguage || "en";
        if (data.sourceLanguage === skipLang) return null;

        return { text: data.translation, lang: data.sourceLanguage };
    } catch {
        return null;
    }
}

async function translateAndReplace(message: Message) {
    if (!message?.content || !message?.author?.id) return;
    if (!isTracked(message.author.id)) return;
    if (originalMessages.has(message.id)) return;

    const result = await googleTranslate(message.content);
    if (!result) return;

    if (originalMessages.size >= MAX_ORIGINAL_MESSAGES) {
        const oldest = originalMessages.keys().next().value;
        if (oldest !== undefined) originalMessages.delete(oldest);
    }
    originalMessages.set(message.id, message.content);

    const stored = MessageStore.getMessage(message.channel_id, message.id);
    if (!stored) return;

    stored.content = result.text;
    (stored as any).__translateOriginal = message.content;
    MessageStore.emitChange();
}

function handleMessageCreate({ message, optimistic }: { message: Message; optimistic: boolean; }) {
    if (optimistic) return;
    translateAndReplace(message);
}

function handleMessageUpdate({ message }: { message: Message; }) {
    if (originalMessages.has(message.id)) {
        originalMessages.delete(message.id);
    }
    translateAndReplace(message);
}

function handleMessageDelete({ channelId, id }: { channelId: string; id: string; }) {
    originalMessages.delete(id);
}

export default definePlugin({
    name: "TranslatePremium",
    description: "Auto translate messages from specific users to ur lang with context menu button",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["ContextMenuAPI"],
    settings,
    flux: {
        MESSAGE_CREATE: handleMessageCreate,
        MESSAGE_UPDATE: handleMessageUpdate,
        MESSAGE_DELETE: handleMessageDelete,
    },
    start() {
        addContextMenuPatch("user-context", userContextPatch);
        addContextMenuPatch("message", messageContextPatch);
    },
    stop() {
        removeContextMenuPatch("user-context", userContextPatch);
        removeContextMenuPatch("message", messageContextPatch);
        originalMessages.clear();
    },
});

const userContextPatch: NavContextMenuPatchCallback = (children, props: { user: User; }) => {
    if (!props?.user) return;
    const userId = props.user.id;
    if (userId === UserStore.getCurrentUser().id) return;

    const tracked = isTracked(userId);
    const targetName = GoogleLanguages[settings.store.targetLanguage] ?? settings.store.targetLanguage;

    children.push(
        <Menu.MenuSeparator key="tp-sep" />,
        <Menu.MenuItem
            key="tp-toggle"
            id="translate-premium-toggle"
            label={tracked ? "Stop Auto-Translating" : `Auto-Translate to ${targetName}`}
            action={() => {
                if (tracked) {
                    removeTracked(userId);
                    Toasts.show({ message: `Stopped translating ${props.user.username}`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });
                } else {
                    addTracked(userId);
                    Toasts.show({ message: `Now auto-translating ${props.user.username} to ${targetName}`, id: Toasts.genId(), type: Toasts.Type.SUCCESS });
                }
            }}
        />
    );
};

const messageContextPatch: NavContextMenuPatchCallback = (children, props: { message: Message; }) => {
    if (!props?.message) return;

    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group) return;

    if (originalMessages.has(props.message.id)) {
        group.splice(group.findIndex(c => c?.props?.id === "copy-text") + 1, 0, (
            <Menu.MenuItem
                key="tp-view-original"
                id="translate-premium-original"
                label="View Original Message"
                action={() => {
                    const original = originalMessages.get(props.message.id);
                    if (original) {
                        Toasts.show({
                            message: `Original: ${original}`,
                            id: Toasts.genId(),
                            type: Toasts.Type.MESSAGE,
                        });
                    }
                }}
            />
        ));
    }
};
