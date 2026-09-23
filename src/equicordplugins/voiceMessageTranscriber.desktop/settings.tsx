/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { DeleteCacheButton } from "./components/DeleteCacheButton";
import { cl } from "./utils/misc";

const MODEL_SIZES: Record<string, { quantized: string; full: string; }> = {
    "Xenova/whisper-tiny": { quantized: "~40 MB", full: "~150 MB" },
    "Xenova/whisper-base": { quantized: "~77 MB", full: "~290 MB" },
    "Xenova/whisper-small": { quantized: "~250 MB", full: "~960 MB" },
    "Xenova/whisper-medium": { quantized: "~765 MB", full: "~3.1 GB" },
};

function renderModelOption(option?: { label: string; value: string; }) {
    if (!option) return null;
    return <ModelOption option={option} />;
}

function ModelOption({ option }: { option: { label: string; value: string; }; }) {
    const isQuantized = settings.use(["quantized"]).quantized ?? true;
    const size = MODEL_SIZES[option.value]?.[isQuantized ? "quantized" : "full"];

    return (
        <div className={cl("model-option")}>
            <span>{option.label}</span>
            {size && (
                <span className={cl("model-size")}>
                    {size}
                </span>
            )}
        </div>
    );
}

export const settings = definePluginSettings({
    embed: {
        type: OptionType.BOOLEAN,
        description: "Display transcription directly in the voice message attachment instead of a modal.",
        default: false,
        restartNeeded: false
    },
    maintainHorizontal: {
        type: OptionType.BOOLEAN,
        description: "Maintain horizontal size for the embedded transcription box and expand vertically.",
        default: false,
        restartNeeded: false
    },
    selectedModel: {
        type: OptionType.SELECT,
        description: "Model size.",
        options: [
            {
                label: "Tiny (Fastest, lowest accuracy)",
                value: "Xenova/whisper-tiny",
            },
            {
                label: "Base (Recommended)",
                value: "Xenova/whisper-base",
                default: true
            },
            {
                label: "Small",
                value: "Xenova/whisper-small"
            },
            {
                label: "Medium (Slowest, best accuracy)",
                value: "Xenova/whisper-medium"
            }
        ],
        componentProps: {
            renderOptionLabel: (option: { label: string; value: string; }) => renderModelOption(option),
            renderOptionValue: (options: { label: string; value: string; }[]) => renderModelOption(options?.[0]),
        },
        restartNeeded: false
    },
    quantized: {
        type: OptionType.BOOLEAN,
        description: "Use quantized models (smaller size, slight quality loss).",
        default: true,
        restartNeeded: false
    },
    deleteModalFiles: {
        type: OptionType.COMPONENT,
        description: "Delete cached files from storage.",
        component: DeleteCacheButton
    }
});
