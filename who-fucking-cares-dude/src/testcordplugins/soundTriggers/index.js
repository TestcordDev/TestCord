/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { SelectedChannelStore } from "@webpack/common";
import { findAndPlayTriggers } from "./audio";
import { SoundTriggerSettings } from "./components/SoundTriggerSettings";
export const EMPTY_TRIGGER = { patterns: [], sound: "", volume: 0.5, caseSensitive: false };
export const DEFAULT_SETTINGS = [];
export const classFactory = classNameFactory("vc-st-");
export const settings = definePluginSettings({
    soundTriggers: {
        type: 6 /* OptionType.COMPONENT */,
        component: SoundTriggerSettings,
        description: "",
    }
});
export default definePlugin({
    name: "SoundTriggers",
    description: "Chaotic plugin for mapping text/emojis to sound",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    start() {
        if (Array.isArray(settings.store.soundTriggers)) {
            return;
        }
        settings.store.soundTriggers = DEFAULT_SETTINGS;
    },
    flux: {
        MESSAGE_CREATE({ optimistic, type, message, channelId }) {
            if (optimistic || type !== "MESSAGE_CREATE")
                return;
            if (message.state === "SENDING")
                return;
            if (!message.content)
                return;
            if (channelId !== SelectedChannelStore.getChannelId())
                return;
            findAndPlayTriggers(message.content);
        }
    }
});
