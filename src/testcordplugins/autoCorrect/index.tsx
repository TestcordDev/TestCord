/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { showApiKeyWarning } from "@utils/apiKeyWarning";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

import { effectiveProviderRequiresGroqKey, HOMELANDER_MODEL_OPTIONS, LOCAL_PROVIDER_OPTIONS, SURF_MODEL_OPTIONS, SWISHAI_MODEL_OPTIONS, testcordChat } from "../TestcordAI/aiProvider";
import { getGroqKey } from "../TestcordAI/groqManager";

const AUTO_CORRECT_TIMEOUT = 3000;

const settings = definePluginSettings({
    location: {
        type: OptionType.SELECT,
        description: "Where to show the button",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true,
    },
    isActive: {
        type: OptionType.BOOLEAN,
        description: "Enable automatic correction",
        default: true,
    },
    language: {
        type: OptionType.SELECT,
        description: "Correction language",
        options: [
            { label: "Auto detect", value: "auto", default: true },
            { label: "English", value: "en" },
            { label: "French", value: "fr" },
            { label: "Spanish", value: "es" },
            { label: "German", value: "de" },
            { label: "Italian", value: "it" },
            { label: "Polish", value: "pl" },
            { label: "Portuguese", value: "pt" },
        ],
    },
    aggressiveness: {
        type: OptionType.SELECT,
        description: "Correction level",
        options: [
            { label: "Soft — obvious mistakes only", value: "low", default: true },
            { label: "Normal — mistakes + style", value: "medium" },
            { label: "Aggressive — full rewrite", value: "high" },
        ],
        default: "low",
    },
    provider: {
        type: OptionType.SELECT,
        description: "AI provider",
        options: LOCAL_PROVIDER_OPTIONS,
        default: "testcord",
    },
    groqModel: {
        type: OptionType.STRING,
        description: "Groq model override",
        default: "llama-3.1-8b-instant",
        hidden: () => settings.store.provider !== "groq",
    },
    homelanderModel: {
        type: OptionType.SELECT,
        description: "Homelander model",
        options: HOMELANDER_MODEL_OPTIONS,
        default: "openai/gpt-5.5",
        hidden: () => settings.store.provider !== "homelander",
    },
    swishAiModel: {
        type: OptionType.SELECT,
        description: "SwishAI model",
        options: SWISHAI_MODEL_OPTIONS,
        default: "gpt-5.5",
        hidden: () => settings.store.provider !== "swishai",
    },
    surfModel: {
        type: OptionType.SELECT,
        description: "Unlimited Surf model",
        options: SURF_MODEL_OPTIONS,
        default: "gateway-claude-opus-4-7",
        hidden: () => settings.store.provider !== "unlimited-surf",
    },
});

const LANG_PROMPTS: Record<string, string> = {
    auto: "You are a spell-checker. Detect the language of the input text automatically, then fix ONLY spelling and grammar mistakes in that language. Return the corrected text without explanation or quotes. FORBIDDEN: adding words, changing meaning, rephrasing. If already correct, return as-is.",
    en: "You are a spell-checker. Fix ONLY spelling and grammar mistakes. Return the corrected text without explanation or quotes. FORBIDDEN: adding words, changing meaning, rephrasing. If already correct, return as-is.",
    fr: "Tu es un correcteur orthographique. Corrige UNIQUEMENT les fautes d'orthographe et de grammaire. Retourne le texte corrigé sans explication ni citation. INTERDIT : ajouter des mots, changer le sens, reformuler. Si le texte est déjà correct, retourne-le tel quel.",
    es: "Eres un corrector ortográfico. Corrige SOLO errores ortográficos y gramaticales. Devuelve el texto corregido sin explicación. PROHIBIDO: añadir palabras, cambiar el sentido.",
    de: "Du bist ein Rechtschreibprüfer. Korrigiere NUR Rechtschreib- und Grammatikfehler. Gib den korrigierten Text ohne Erklärung zurück. VERBOTEN: Wörter hinzufügen, Bedeutung ändern.",
    it: "Sei un correttore ortografico. Correggi SOLO errori ortografici e grammaticali. Restituisci il testo corretto senza spiegazioni. VIETATO: aggiungere parole, cambiare il significato.",
    pl: "Jesteś korektorem ortograficznym. Popraw TYLKO błędy ortograficzne i gramatyczne. Zwróć poprawiony tekst bez wyjaśnień. ZABRONIONO: dodawanie słów, zmiana znaczenia, przepisywanie. Jeśli tekst jest już poprawny, zwróć go bez zmian.",
    pt: "Você é um corretor ortográfico. Corrija SOMENTE erros ortográficos e gramaticais. Retorne o texto corrigido sem explicação. PROIBIDO: adicionar palavras, mudar o sentido.",
};

const AGGR_SUFFIX: Record<string, string> = {
    low: " STRICT INSTRUCTION: DO NOT FIX STYLE. ONLY fix obvious typos and basic grammar. DO NOT change the choice of words. KEEP THE TEXT AS IDENTICAL AS POSSIBLE. Return ONLY the text.",
    medium: " Fix mistakes and slightly improve clarity if necessary, but don't change the meaning.",
    high: " Fix everything and rewrite for perfect, fluid, and professional text.",
};

async function correctText(text: string): Promise<string> {
    if (text.trim().length < 3) return text;

    const lang = settings.store.language ?? "en";
    const aggr = settings.store.aggressiveness ?? "low";
    const systemPrompt = (LANG_PROMPTS[lang] ?? LANG_PROMPTS.en) + (AGGR_SUFFIX[aggr] ?? "");

    try {
        const corrected = await testcordChat({
            provider: settings.store.provider,
            groqModel: settings.store.groqModel,
            homelanderModel: settings.store.homelanderModel,
            swishAiModel: settings.store.swishAiModel,
            surfModel: settings.store.surfModel,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text },
            ],
            temperature: 0,
            maxTokens: 512,
        });

        if (!corrected || corrected.trim() === "" || corrected === text) return text;

        if (corrected.toLowerCase().includes("correction:") || corrected.toLowerCase().includes("text:")) return text;

        if (corrected.length > text.length * 1.5 || corrected.length < text.length * 0.4) return text;

        if (aggr === "low") {
            const srcWords = text.trim().split(/\s+/).filter(w => w.length > 0).length;
            const corrWords = corrected.trim().split(/\s+/).filter(w => w.length > 0).length;
            if (Math.abs(corrWords - srcWords) > Math.max(1, Math.floor(srcWords * 0.15))) {
                console.log("[AutoCorrect] Soft mode rejected: word count changed too much", { srcWords, corrWords });
                return text;
            }
        }
        return corrected.replace(/^"(.*)"$/, "$1").trim();
    } catch (e: any) {
        console.warn("[AutoCorrect] Error correction:", e.message);
        return text;
    }
}

function AutoCorrectIcon({ enabled }: { enabled: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                fill="currentColor"
                d="M8.87 2.31A.5.5 0 0 1 9.34 2h10.92c.36 0 .6.36.47.69l-.6 1.5a.5.5 0 0 1-.47.31h-4.28l-4.17 15h4.05c.36 0 .6.36.47.69l-.6 1.5a.5.5 0 0 1-.47.31H3.74a.5.5 0 0 1-.47-.69l.6-1.5a.5.5 0 0 1 .47-.31h4.28l4.17-15H8.74a.5.5 0 0 1-.47-.69l.6-1.5Z"
                opacity={enabled ? 1 : 0.35}
            />
            {!enabled && (
                <path
                    fill="var(--status-danger)"
                    d="M21.178 1.707 22.592 3.12 4.12 21.593l-1.414-1.415L21.178 1.707Z"
                />
            )}
        </svg>
    );
}

const AutoCorrectChatBarButton: ChatBarButtonFactory = ({ type }) => {
    const [enabled, setEnabled] = React.useState(settings.store.isActive);
    const validChat = ["normal", "sidebar"].some(x => type.analyticsName === x);
    if (!validChat || settings.store.location !== "chatbar") return null;

    const toggle = async () => {
        if (!enabled) {
            if (effectiveProviderRequiresGroqKey(settings.store.provider) && !await getGroqKey()) {
                showApiKeyWarning("AutoCorrect");
                return;
            }
        }
        settings.store.isActive = !settings.store.isActive;

        setEnabled(settings.store.isActive);
    };

    const tooltip = enabled
        ? "AutoCorrect: enabled — click to disable"
        : "AutoCorrect: disabled — click to enable";

    return (
        <ChatBarButton tooltip={tooltip} onClick={toggle}>
            <AutoCorrectIcon enabled={enabled} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "AutoCorrectNC",
    description: "Automatically corrects spelling and grammar before sending. Requires a free Groq API key configured in TestcordAI.",
    tags: ["Chat", "Utility", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["HeaderBarAPI"],
    settings,

    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("AutoCorrect", () => (
                <HeaderBarButton
                    icon={() => <AutoCorrectIcon enabled={settings.store.isActive} />}
                    tooltip="AutoCorrect"
                    onClick={() => { settings.store.isActive = !settings.store.isActive; }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("AutoCorrect", () => (
                <ChannelToolbarButton
                    icon={() => <AutoCorrectIcon enabled={settings.store.isActive} />}
                    tooltip="AutoCorrect"
                    onClick={() => { settings.store.isActive = !settings.store.isActive; }}
                />
            ), 5);
        }
    },

    stop() {
        removeHeaderBarButton("AutoCorrect");
        removeChannelToolbarButton("AutoCorrect");
    },

    chatBarButton: {
        icon: () => <AutoCorrectIcon enabled={settings.store.isActive} />,
        render: AutoCorrectChatBarButton,
    },

    async onBeforeMessageSend(_channelId: string, message: { content: string; }) {
        if (!settings.store.isActive) return;
        if (!message.content || message.content.trim().length < 3) return;
        if (message.content.startsWith("/") || message.content.length > 2000) return;

        const corrected = await Promise.race([
            correctText(message.content),
            sleep(AUTO_CORRECT_TIMEOUT).then(() => message.content)
        ]);
        if (corrected && corrected !== message.content) {
            message.content = corrected;
        }
    },
});
