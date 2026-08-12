/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { OptionType, type PluginNative, type PluginSettingComponentProps } from "@utils/types";
import { React, Select, useEffect, useState } from "@webpack/common";

import { DEFAULT_OPENCODE_ZEN_MODEL, DEFAULT_SYSTEM_PROMPT, isOpenCodeFreeModel, parseOpenCodeFreeModelsResponse } from "./helpers";

const DEFAULT_TARGET_LANGUAGE = "Chinese (Simplified)";
const MODEL_KEYS = ["model"] satisfies Array<"model">;
const logger = new Logger("AITranslate");
const Native = VencordNative.pluginHelpers.AITranslate as PluginNative<typeof import("./native")>;

type ModelDiscoveryState = "loading" | "success" | "failure";

interface ModelSelectorState {
    type: ModelDiscoveryState;
    message: string;
    models: string[];
}

function getSettingsResultClassName(type: ModelDiscoveryState) {
    return classes(
        "vc-aitrans-settings-result",
        type === "success" ? "vc-aitrans-settings-success" : undefined,
        type === "failure" ? "vc-aitrans-settings-failure" : undefined
    );
}

const LANGUAGE_VALUES = [
    "English",
    "Chinese (Simplified)",
    "Chinese (Traditional)",
    "Japanese",
    "Korean",
    "Spanish",
    "French",
    "German",
    "Portuguese",
    "Portuguese (Brazil)",
    "Russian",
    "Arabic",
    "Hindi",
    "Bengali",
    "Indonesian",
    "Vietnamese",
    "Thai",
    "Filipino",
    "Malay",
    "Italian",
    "Dutch",
    "Turkish",
    "Polish",
    "Ukrainian",
    "Czech",
    "Swedish",
    "Norwegian",
    "Danish",
    "Finnish",
    "Greek",
    "Hebrew",
    "Romanian",
    "Hungarian",
    "Bulgarian",
    "Serbian",
    "Croatian",
    "Slovenian",
    "Slovak",
    "Lithuanian",
    "Latvian",
    "Estonian",
    "Persian",
    "Urdu",
] as const;

function makeLanguageOptions(defaultValue: string) {
    return LANGUAGE_VALUES.map(value => ({
        label: value,
        value,
        default: value === defaultValue,
    }));
}

async function fetchOpenCodeFreeModels(): Promise<string[]> {
    const response = await Native.makeModelsRequest();
    if (!response.ok) throw new Error(response.error ?? `Request failed with status ${response.status}.`);

    return parseOpenCodeFreeModelsResponse(response.body);
}

function OpenCodeModelSelector({ setValue }: PluginSettingComponentProps) {
    const { model } = settings.use(MODEL_KEYS);
    const selectedModel = typeof model === "string" && isOpenCodeFreeModel(model)
        ? model
        : DEFAULT_OPENCODE_ZEN_MODEL;
    const [state, setState] = useState<ModelSelectorState>({
        type: "loading",
        message: "Fetching free OpenCode Zen models.",
        models: [DEFAULT_OPENCODE_ZEN_MODEL],
    });

    useEffect(() => {
        let mounted = true;

        fetchOpenCodeFreeModels()
            .then((models: string[]) => {
                if (!mounted) return;

                setState({
                    type: "success",
                    message: `Found ${models.length} free OpenCode Zen models.`,
                    models,
                });

                const currentModel = settings.store.model;
                if (typeof currentModel !== "string" || !models.includes(currentModel)) setValue(DEFAULT_OPENCODE_ZEN_MODEL);
            })
            .catch((error: unknown) => {
                if (!mounted) return;

                logger.warn("OpenCode Zen model discovery failed.", error);
                setState({
                    type: "failure",
                    message: "Could not fetch free models. Big Pickle is still selected.",
                    models: [DEFAULT_OPENCODE_ZEN_MODEL],
                });

                if (settings.store.model !== DEFAULT_OPENCODE_ZEN_MODEL) setValue(DEFAULT_OPENCODE_ZEN_MODEL);
            });

        return () => { mounted = false; };
    }, [setValue]);

    return (
        <div className="vc-aitrans-model-select">
            <div className="vc-aitrans-settings-label">
                <div className="vc-aitrans-settings-title">OpenCode Zen model</div>
                <div className="vc-aitrans-settings-description">
                    Automatically fetches free OpenCode Zen models. Messages are sent to OpenCode Zen for translation.
                </div>
            </div>
            <Select
                placeholder="Select a free model"
                options={state.models.map((freeModel: string) => ({ label: freeModel, value: freeModel }))}
                maxVisibleItems={5}
                closeOnSelect={true}
                select={(value: string) => setValue(value)}
                isSelected={(value: string) => value === selectedModel}
                serialize={(value: string) => value}
            />
            {state.message ? (
                <div aria-live="polite" className={getSettingsResultClassName(state.type)}>
                    {state.message}
                </div>
            ) : null}
        </div>
    );
}

export const settings = definePluginSettings({
    model: {
        type: OptionType.COMPONENT,
        component: OpenCodeModelSelector,
        default: DEFAULT_OPENCODE_ZEN_MODEL,
    },
    autoTranslate: {
        type: OptionType.BOOLEAN,
        description: "Send your message content to OpenCode Zen and translate it before Discord sends it.",
        default: false,
    },
    targetLanguage: {
        type: OptionType.SELECT,
        description: "Language your messages are translated to before Discord sends them.",
        options: makeLanguageOptions(DEFAULT_TARGET_LANGUAGE),
    },
    systemPrompt: {
        type: OptionType.STRING,
        description: "System prompt. Use {{target_language}} where the target language should appear.",
        default: DEFAULT_SYSTEM_PROMPT,
        multiline: true,
    },
});
