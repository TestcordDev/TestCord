/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { useState } from "@webpack/common";
import { DeepSearchModal } from "./SearchModal";
function SearchIcon(props) {
    return (<svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...props}>
            <path d="M21.707 20.293l-5.395-5.395A7.46 7.46 0 0018 10.5a7.5 7.5 0 10-7.5 7.5 7.46 7.46 0 004.398-1.688l5.395 5.395a1 1 0 001.414-1.414zM10.5 16a5.5 5.5 0 110-11 5.5 5.5 0 010 11z"/>
        </svg>);
}
function DeepSearchButton() {
    const [active, setActive] = useState(false);
    return (<ChannelToolbarButton icon={SearchIcon} tooltip="Deep Search" selected={active} className="vc-deepsearch-btn" onClick={() => {
            setActive(true);
            openModal(p => <DeepSearchModal rootProps={p}/>, {
                onCloseRequest: () => setActive(false)
            });
        }}/>);
}
const settings = definePluginSettings({
    maxResults: {
        type: 5 /* OptionType.SLIDER */,
        description: "Maximum number of search results to return",
        default: 100,
        markers: [25, 50, 100, 200, 500],
        stickToMarkers: false
    },
    searchTimeout: {
        type: 5 /* OptionType.SLIDER */,
        description: "Debounce delay in ms before search fires",
        default: 300,
        markers: [100, 200, 300, 500, 1000],
        stickToMarkers: false
    },
    includeNSFW: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Include NSFW channels in search results",
        default: false
    }
});
export { settings };
export default definePlugin({
    name: "DeepSearch",
    description: "Advanced message search with filters for links, authors, channels, dates, and more",
    authors: [TestcordDevs.x2b],
    tags: ["Chat", "Utility"],
    settings,
    dependencies: ["HeaderBarAPI"],
    headerBarButton: {
        icon: SearchIcon,
        render: DeepSearchButton,
        priority: 50,
        location: "channeltoolbar"
    }
});
