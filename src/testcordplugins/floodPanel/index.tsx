/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { SelectedChannelStore } from "@webpack/common";

import { FloodPanelButton } from "./components/ChatBarButton";
import { FloodModal } from "./components/FloodModal";
import { FloodIcon } from "./components/Icons";

const ChannelStore = findStoreLazy("ChannelStore");

const enabled = false;

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
    defaultDelay: {
        type: OptionType.NUMBER,
        description: "Default delay between messages (ms).",
        default: 500
    },
    defaultShuffle: {
        type: OptionType.BOOLEAN,
        description: "Randomize message order by default.",
        default: true
    }
});

export { settings };

export default definePlugin({
    name: "FloodPanel",
    description: "Send a flood of messages rapidly in any channel. Load a custom .txt file or use the built-in phrases. Accessible from the chat bar.",
    authors: [EquicordDevs.nobody],
    tags: ["Utility"],
    dependencies: ["HeaderBarAPI"],
    settings,

    chatBarButton: { render: FloodPanelButton } as any,

    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("FloodPanel", () => (
                <HeaderBarButton
                    icon={FloodIcon}
                    tooltip="Flood Panel"
                    onClick={() => {
                        const chId = SelectedChannelStore.getChannelId();
                        if (!chId) return;
                        const channel = ChannelStore.getChannel(chId);
                        if (!channel) return;
                        openModal(props => (
                            <FloodModal channel={channel} rootProps={props as any} onRunningChange={() => { }} />
                        ));
                    }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("FloodPanel", () => (
                <ChannelToolbarButton
                    icon={FloodIcon}
                    tooltip="Flood Panel"
                    onClick={() => {
                        const chId = SelectedChannelStore.getChannelId();
                        if (!chId) return;
                        const channel = ChannelStore.getChannel(chId);
                        if (!channel) return;
                        openModal(props => (
                            <FloodModal channel={channel} rootProps={props as any} onRunningChange={() => { }} />
                        ));
                    }}
                />
            ), 5);
        }
    },

    stop() {
        removeHeaderBarButton("FloodPanel");
        removeChannelToolbarButton("FloodPanel");
    },
});
