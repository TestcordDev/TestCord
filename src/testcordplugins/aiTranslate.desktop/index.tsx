/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ChatBarButton, type ChatBarButtonFactory } from "@api/ChatButtons";
import ErrorBoundary from "@components/ErrorBoundary";
import { OpenCordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { type IconComponent } from "@utils/types";
import { showToast, Toasts, useEffect, useState } from "@webpack/common";

import { getAutoTranslateToggleLabel, getTranslationStatusMessage, shouldTranslateOutgoingContent } from "./helpers";
import { settings } from "./settings";
import { abortActiveTranslations, clearContentTranslationCache, getTranslationGeneration, getTranslationRateLimitMs, isTranslationGenerationCurrent, translateText } from "./utils";

const cl = classNameFactory("vc-aitrans-");
const AUTO_TRANSLATE_KEYS = ["autoTranslate"] satisfies Array<"autoTranslate">;
let lastRateLimitToast = 0;
let activeTranslationCount = 0;
const translationStateListeners = new Set<() => void>();

const AITranslateIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        viewBox="0 0 24 24"
        height={height}
        width={width}
        className={className}
    >
        <path fill="currentColor" d="M4 4h7v2H8.8c.4 1.5 1.1 2.8 2.1 4 .4-.6.8-1.2 1.1-2h2.1c-.5 1.4-1.1 2.6-2 3.7l1.9 1.9-1.4 1.4-1.8-1.8c-1.2 1.1-2.7 2-4.5 2.8l-.8-1.8c1.5-.7 2.8-1.5 3.8-2.5-1.2-1.4-2-3.3-2.5-5.7H4V4Zm12.5 5h2L22 20h-2.1l-.7-2.2h-3.5L15 20h-2l3.5-11Zm-.2 7h2.3l-1.1-3.7h-.1L16.3 16Z" />
    </svg>
);

const AITranslateSpinnerIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        viewBox="0 0 24 24"
        height={height}
        width={width}
        className={className}
        aria-hidden="true"
    >
        <circle className={cl("spinner-track")} cx="12" cy="12" r="8" />
        <circle className={cl("spinner-ring")} cx="12" cy="12" r="8" />
    </svg>
);

function showRateLimitToast(rateLimitMs: number) {
    const now = Date.now();
    if (now - lastRateLimitToast < 5_000) return;

    lastRateLimitToast = now;
    showToast(getTranslationStatusMessage("rateLimited", rateLimitMs), Toasts.Type.FAILURE);
}

function emitTranslationStateChange() {
    for (const listener of translationStateListeners) listener();
}

function setTranslationLoading(loading: boolean) {
    activeTranslationCount = Math.max(0, activeTranslationCount + (loading ? 1 : -1));
    emitTranslationStateChange();
}

function useIsTranslating() {
    const [isTranslating, setIsTranslating] = useState(activeTranslationCount > 0);

    useEffect(() => {
        function update() {
            setIsTranslating(activeTranslationCount > 0);
        }

        translationStateListeners.add(update);
        update();
        return () => void translationStateListeners.delete(update);
    }, []);

    return isTranslating;
}

const AITranslateChatButtonComponent: ChatBarButtonFactory = ({ isMainChat }) => {
    const { autoTranslate } = settings.use(AUTO_TRANSLATE_KEYS);
    const isTranslating = useIsTranslating();
    if (!isMainChat) return null;

    function toggle() {
        settings.store.autoTranslate = !autoTranslate;
        showToast(
            getAutoTranslateToggleLabel(settings.store.autoTranslate),
            settings.store.autoTranslate ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
        );
    }

    return (
        <ChatBarButton
            tooltip={isTranslating ? "Translating message" : autoTranslate ? "Turn off AI outgoing translate" : "Turn on AI outgoing translate"}
            onClick={toggle}
            onContextMenu={toggle}
        >
            {isTranslating ? <AITranslateSpinnerIcon className={cl("spinner", { enabled: autoTranslate })} /> : <AITranslateIcon className={cl({ enabled: autoTranslate })} />}
        </ChatBarButton>
    );
};

const WrappedAITranslateChatButton = ErrorBoundary.wrap(AITranslateChatButtonComponent, { noop: true });
const AITranslateChatButton: ChatBarButtonFactory = props => <WrappedAITranslateChatButton {...props} />;

export default definePlugin({
    name: "AITranslate",
    description: "Translate your messages with free OpenCode Zen AI models before Discord sends them.",
    tags: ["Chat", "Utility"],
    authors: [OpenCordDevs.MasuRii],
    settings,
    chatBarButton: {
        icon: AITranslateIcon,
        render: AITranslateChatButton,
    },

    async onBeforeMessageSend(_, message) {
        const { autoTranslate, targetLanguage } = settings.store;
        if (!shouldTranslateOutgoingContent(message.content, targetLanguage, autoTranslate)) return;

        let rateLimitMs = getTranslationRateLimitMs(targetLanguage);
        if (rateLimitMs > 0) {
            showRateLimitToast(rateLimitMs);
            return { cancel: true };
        }

        const translationGeneration = getTranslationGeneration();
        setTranslationLoading(true);
        try {
            const translation = await translateText(message.content, targetLanguage);
            if (!isTranslationGenerationCurrent(translationGeneration)) return { cancel: true };
            if (translation) {
                message.content = translation.translated;
                showToast(getTranslationStatusMessage("sent"), Toasts.Type.SUCCESS);
                return;
            }

            rateLimitMs = getTranslationRateLimitMs(targetLanguage);
            if (rateLimitMs > 0) showRateLimitToast(rateLimitMs);
            else showToast(getTranslationStatusMessage("failed"), Toasts.Type.FAILURE);
            return { cancel: true };
        } finally {
            setTranslationLoading(false);
        }
    },

    stop() {
        activeTranslationCount = 0;
        emitTranslationStateChange();
        abortActiveTranslations();
        clearContentTranslationCache();
    },
});
