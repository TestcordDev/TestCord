/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { getCurrentChannel } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, React } from "@webpack/common";

interface FetchTiming {
    channelId: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    timestamp?: Date;
}

let currentFetch: FetchTiming | null = null;
let currentChannelId: string | null = null;
const channelTimings: Map<string, { time: number; timestamp: Date; }> = new Map();
const MAX_CHANNEL_TIMINGS = 100;
const FETCH_BUTTON_KEYS = ["showMs", "iconColor", "showIcon", "location"] as const;

function trimChannelTimings() {
    while (channelTimings.size > MAX_CHANNEL_TIMINGS) {
        const key = channelTimings.keys().next().value;
        if (key === undefined) break;
        channelTimings.delete(key);
    }
}

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
    showIcon: {
        type: OptionType.BOOLEAN,
        description: "Show fetch time icon in message bar",
        default: true,
    },
    showMs: {
        type: OptionType.BOOLEAN,
        description: "Show milliseconds in timing",
        default: true,
    },
    iconColor: {
        type: OptionType.STRING,
        description: "Icon color (CSS color value)",
        default: "#00d166",
    }
});

function FetchIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z" />
        </svg>
    );
}

function getFetchTooltip() {
    if (!currentChannelId) return "No channel selected.";

    const channelData = channelTimings.get(currentChannelId);
    if (!channelData) return "No fetch timing yet.";

    return `Messages loaded in ${Math.round(channelData.time)}ms (${formatTimeAgo(channelData.timestamp)})`;
}

const timingListeners = new Set<() => void>();

function notifyTimingListeners() {
    timingListeners.forEach(listener => listener());
}

function useTimingUpdates() {
    const [, forceUpdate] = React.useState(0);

    React.useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        timingListeners.add(listener);
        return () => { timingListeners.delete(listener); };
    }, []);
}

function HeaderFetchTimeButton() {
    useTimingUpdates();

    return <HeaderBarButton icon={FetchIcon} tooltip={getFetchTooltip()} />;
}

function ChannelFetchTimeButton() {
    useTimingUpdates();

    return <ChannelToolbarButton icon={FetchIcon} tooltip={getFetchTooltip()} />;
}

const FetchTimeButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { showMs, iconColor, showIcon, location } = settings.use(FETCH_BUTTON_KEYS);

    if (!isMainChat || !showIcon || !currentChannelId || location !== "chatbar") {
        return null;
    }

    const channelData = channelTimings.get(currentChannelId);
    if (!channelData) {
        return null;
    }

    const { time, timestamp } = channelData;
    const displayTime = showMs ? `${Math.round(time)}ms` : `${Math.round(time / 1000)}s`;

    if (!showMs && Math.round(time / 1000) === 0) {
        return null;
    }

    const timeAgo = formatTimeAgo(timestamp);

    return (
        <ChatBarButton
            tooltip={`Messages loaded in ${Math.round(time)}ms (${timeAgo})`}
            onClick={() => { }}
        >
            <div style={{
                display: "flex",
                alignItems: "center",
                gap: "4px"
            }}>
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                >
                    <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z" />
                </svg>
                <span style={{
                    fontSize: "12px",
                    color: iconColor,
                    fontWeight: "500"
                }}>
                    {displayTime}
                </span>
            </div>
        </ChatBarButton>
    );
};

function formatTimeAgo(timestamp: Date): string {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days} day${days > 1 ? "s" : ""} ago`;
    } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    } else {
        return "just now";
    }
}

function handleChannelSelect(data: any) {
    if (data.channelId && data.channelId !== currentChannelId) {
        currentChannelId = data.channelId;
        currentFetch = {
            channelId: data.channelId,
            startTime: performance.now()
        };
        notifyTimingListeners();
    }
}

function handleMessageLoad(data: any) {
    if (!currentFetch || data.channelId !== currentFetch.channelId) return;

    const existing = channelTimings.get(currentFetch.channelId);
    if (existing) return;

    const endTime = performance.now();
    const duration = endTime - currentFetch.startTime;

    channelTimings.set(currentFetch.channelId, {
        time: duration,
        timestamp: new Date()
    });
    trimChannelTimings();

    currentFetch = null;
    notifyTimingListeners();
}

export default definePlugin({
    name: "MessageFetchTimer",
    description: "Shows how long it took to fetch messages for the current channel",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],
    settings,

    start() {
        FluxDispatcher.subscribe("CHANNEL_SELECT", handleChannelSelect);
        FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", handleMessageLoad);
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageLoad);

        const currentChannel = getCurrentChannel();
        if (currentChannel) {
            currentChannelId = currentChannel.id;
        }

        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("MessageFetchTimer", HeaderFetchTimeButton, 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("MessageFetchTimer", ChannelFetchTimeButton, 5);
        }
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", handleChannelSelect);
        FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", handleMessageLoad);
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageLoad);

        currentFetch = null;
        channelTimings.clear();
        currentChannelId = null;
        notifyTimingListeners();
        removeHeaderBarButton("MessageFetchTimer");
        removeChannelToolbarButton("MessageFetchTimer");
    },

    chatBarButton: {
        icon: FetchIcon as any,
        render: FetchTimeButton,
    },
});
