/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { IconProps, OptionType } from "@utils/types";

import { HOMELANDER_MODEL_OPTIONS, LOCAL_PROVIDER_OPTIONS, SURF_MODEL_OPTIONS, SWISHAI_MODEL_OPTIONS, testcordChat } from "../TestcordAI/aiProvider";

const logger = new Logger("TsundereTalk");
const TOGGLE_KEYS: Array<"rewriteEnabled"> = ["rewriteEnabled"];

const settings = definePluginSettings({
    rewriteEnabled: {
        type: OptionType.BOOLEAN,
        description: "Rewrite outgoing messages in a cute tsundere style.",
        default: true,
        hidden: true,
    },
    intensity: {
        type: OptionType.SELECT,
        description: "How tsundere the rewrite should be.",
        options: [
            { label: "Soft", value: "soft", default: true },
            { label: "Normal", value: "normal" },
            { label: "Extra", value: "extra" },
        ],
    },
    appendTilde: {
        type: OptionType.BOOLEAN,
        description: "Add a tilde when it fits the message.",
        default: true,
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

const INTENSITY_PROMPTS: Record<string, string> = {
    soft: "Keep it lightly tsundere, warm, and natural.",
    normal: "Make it clearly tsundere with cute denial, mild teasing, and a caring undertone.",
    extra: "Make it very tsundere with dramatic denial, teasing, and cute flustered wording while staying friendly.",
};

function cleanResponse(text: string) {
    return text
        .trim()
        .replace(/^```(?:\w+)?\s*/, "")
        .replace(/```$/, "")
        .replace(/^"(.+)"$/, "$1")
        .trim();
}

async function rewriteMessage(systemPrompt: string, text: string) {
    return testcordChat({
        provider: settings.store.provider,
        groqModel: settings.store.groqModel,
        homelanderModel: settings.store.homelanderModel,
        swishAiModel: settings.store.swishAiModel,
        surfModel: settings.store.surfModel,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
        ],
        temperature: 0.85,
        maxTokens: 300,
        forceModel: "llama-3.1-8b-instant",
    });
}

async function tsunderify(text: string) {
    const prompt = INTENSITY_PROMPTS[settings.store.intensity] ?? INTENSITY_PROMPTS.soft;
    const tilde = settings.store.appendTilde
        ? "Use a trailing ~ sometimes when it sounds natural."
        : "Do not add trailing tildes.";

    try {
        const rewritten = cleanResponse(await rewriteMessage(`Rewrite Discord messages into a cute tsundere voice. Preserve the user's meaning, language, mentions, links, emojis, and formatting. Do not answer the message. Do not add explanations, labels, quotes, or markdown fences. Keep it about the same length. Avoid sexual, threatening, or hateful wording. ${prompt} ${tilde}`, text));

        if (!rewritten || rewritten.length > 1900 || rewritten.length > text.length * 3) return text;
        return rewritten;
    } catch (error) {
        logger.warn("Failed to rewrite message", error);
        return text;
    }
}

function TsundereTalkIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} aria-hidden="true">
            <path fill="currentColor" d="M4 4.5A2.5 2.5 0 0 1 6.5 2h11A2.5 2.5 0 0 1 20 4.5v8A2.5 2.5 0 0 1 17.5 15H11l-4.8 4.2A.75.75 0 0 1 5 18.64V15.1A2.5 2.5 0 0 1 3 12.65V4.5Zm6.64 3.1c-.47 0-.86.39-.86.86s.39.86.86.86.86-.39.86-.86-.39-.86-.86-.86Zm4.72 0c-.47 0-.86.39-.86.86s.39.86.86.86.86-.39.86-.86-.39-.86-.86-.86Zm-6.02 4.13a.75.75 0 0 0-.18 1.04A3.53 3.53 0 0 0 12 14.2c1.18 0 2.24-.57 2.84-1.43a.75.75 0 1 0-1.23-.86c-.3.43-.9.79-1.61.79s-1.31-.36-1.61-.79a.75.75 0 0 0-1.05-.18Z" />
        </svg>
    );
}

const TsundereTalkButton = ErrorBoundary.wrap(function TsundereTalkButton() {
    const { rewriteEnabled } = settings.use(TOGGLE_KEYS);

    return (
        <HeaderBarButton
            icon={TsundereTalkIcon}
            tooltip={rewriteEnabled ? "Tsundere Talk: On" : "Tsundere Talk: Off"}
            aria-label="Toggle Tsundere Talk"
            selected={rewriteEnabled}
            onClick={() => {
                settings.store.rewriteEnabled = !rewriteEnabled;
            }}
        />
    );
}, { noop: true });

export default definePlugin({
    name: "TsundereTalk",
    description: "Rewrites your outgoing messages into a cute tsundere style using TestcordAI.",
    authors: [TestcordDevs.x2b],
    tags: ["Chat", "Fun", "Nightcord"],
    dependencies: ["MessageEventsAPI", "HeaderBarAPI"],
    settings,

    headerBarButton: {
        icon: TsundereTalkIcon,
        render: () => <TsundereTalkButton />,
        priority: 1338
    },

    async onBeforeMessageSend(_channelId, message) {
        if (!settings.store.rewriteEnabled) return;
        if (!message.content.trim() || message.content.includes("`")) return;

        message.content = await tsunderify(message.content);
    },
});
