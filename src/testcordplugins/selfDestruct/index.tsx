/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { React } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");
const UserStore = findStoreLazy("UserStore");

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
    active: {
        type: OptionType.BOOLEAN,
        description: "SelfDestruct active (toggle in chat bar)",
        default: false,
        restartNeeded: false,
    },
    delay: {
        type: OptionType.SLIDER,
        description: "Delay before deletion (seconds)",
        markers: [5, 10, 15, 30, 60, 120, 300, 600],
        default: 30,
        stickToMarkers: false,
        restartNeeded: false,
    },
});

interface TimerEntry {
    channelId: string;
    messageId: string;
    expiresAt: number;
    timerId: ReturnType<typeof setTimeout>;
}

const activeTimers = new Map<string, TimerEntry>();
const timerListeners = new Set<() => void>();
let listenerInterval: ReturnType<typeof setInterval> | null = null;

function notifyListeners() {
    for (const fn of timerListeners) {
        try { fn(); } catch { }
    }
}

function addTimerListener(listener: () => void) {
    timerListeners.add(listener);
    if (!listenerInterval) listenerInterval = setInterval(notifyListeners, 1000);
}

function removeTimerListener(listener: () => void) {
    timerListeners.delete(listener);
    if (timerListeners.size === 0 && listenerInterval) {
        clearInterval(listenerInterval);
        listenerInterval = null;
    }
}

function scheduleDelete(channelId: string, messageId: string, delaySec: number) {
    const expiresAt = Date.now() + delaySec * 1000;

    const timerId = setTimeout(() => {
        try {
            MessageActions?.deleteMessage(channelId, messageId);
        } catch (e) {
            console.error("[SelfDestruct] Delete failed:", e);
        }
        activeTimers.delete(messageId);
        notifyListeners();
    }, delaySec * 1000);

    activeTimers.set(messageId, { channelId, messageId, expiresAt, timerId });
    notifyListeners();
}

function cancelTimer(messageId: string) {
    const entry = activeTimers.get(messageId);
    if (entry) {
        clearTimeout(entry.timerId);
        activeTimers.delete(messageId);
        notifyListeners();
    }
}

function cleanup() {
    for (const [, entry] of activeTimers) {
        clearTimeout(entry.timerId);
    }
    activeTimers.clear();
    timerListeners.clear();
    if (listenerInterval) {
        clearInterval(listenerInterval);
        listenerInterval = null;
    }
}

function TimerBadge({ messageId }: { messageId: string; }) {
    const [remaining, setRemaining] = React.useState<number | null>(null);

    React.useEffect(() => {
        function update() {
            const entry = activeTimers.get(messageId);
            if (!entry) {
                setRemaining(null);
                return;
            }
            const left = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
            setRemaining(left);
        }

        update();
        const listener = () => update();
        addTimerListener(listener);

        return () => {
            removeTimerListener(listener);
        };
    }, [messageId]);

    if (remaining === null) return null;

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const timeStr = minutes > 0
        ? `${minutes}:${seconds.toString().padStart(2, "0")}`
        : `${seconds}s`;

    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                marginTop: "4px",
                padding: "2px 8px",
                borderRadius: "12px",
                backgroundColor: "rgba(237, 66, 69, 0.12)",
                color: "#ed4245",
                fontSize: "12px",
                fontWeight: 600,
                fontFamily: "var(--font-primary)",
                lineHeight: "18px",
                userSelect: "none",
                width: "fit-content",
            }}
            title="SelfDestruct — this message will be deleted automatically"
        >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#ed4245" strokeWidth="2" fill="none" />
                <path d="M12 6v6l4 2" stroke="#ed4245" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {timeStr}
        </div>
    );
}

function SelfDestructIcon({ active, width = 20, height = 20 }: { active?: boolean; width?: number; height?: number; }) {
    return (
        <svg
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
            style={{ color: active ? "#ed4245" : "currentColor" }}
        >
            {/* Bombe / timer icon */}
            <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="M12 9v4l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 5V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M10 3h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            {!active && (
                <path
                    fill="var(--status-danger)"
                    d="M21.178 1.707 22.592 3.12 4.12 21.593l-1.414-1.415L21.178 1.707Z"
                />
            )}
        </svg>
    );
}

const SelfDestructButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [active, setActive] = React.useState(settings.store.active);

    if (!isMainChat || settings.store.location !== "chatbar") return null;

    function toggle() {
        settings.store.active = !settings.store.active;
        setActive(settings.store.active);
    }

    const delaySec = settings.store.delay ?? 30;
    const delayStr = delaySec >= 60 ? `${Math.floor(delaySec / 60)}m${delaySec % 60 ? (delaySec % 60) + "s" : ""}` : `${delaySec}s`;

    const tooltip = active
        ? `SelfDestruct: ON (${delayStr}) — click to disable`
        : "SelfDestruct: OFF — click to enable";

    return (
        <ChatBarButton tooltip={tooltip} onClick={toggle}>
            <SelfDestructIcon active={active} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "SelfDestruct",
    description: "Sends messages that are automatically deleted after a configurable delay. Red timer visible on each message.",
    tags: ["Privacy", "Chat", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    dependencies: ["ChatInputButtonAPI", "MessageAccessoriesAPI", "HeaderBarAPI"],
    settings,

    chatBarButton: {
        icon: () => <SelfDestructIcon active={settings.store.active} />,
        render: SelfDestructButton,
    },

    renderMessageAccessory(props: Record<string, any>) {
        const message = props?.message;
        if (!message?.id || !activeTimers.has(message.id)) return null;
        return <TimerBadge messageId={message.id} />;
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic?: boolean; }) {
            if (optimistic) return;
            if (!settings.store.active) return;
            if (!message?.id || !message?.channel_id) return;

            const currentUser = UserStore?.getCurrentUser?.();
            if (!currentUser || message.author?.id !== currentUser.id) return;

            const delaySec = settings.store.delay ?? 30;
            scheduleDelete(message.channel_id, message.id, delaySec);
        },
    },

    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("SelfDestruct", () => (
                <HeaderBarButton
                    icon={() => <SelfDestructIcon active={settings.store.active} />}
                    tooltip="SelfDestruct"
                    onClick={() => { settings.store.active = !settings.store.active; }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("SelfDestruct", () => (
                <ChannelToolbarButton
                    icon={() => <SelfDestructIcon active={settings.store.active} />}
                    tooltip="SelfDestruct"
                    onClick={() => { settings.store.active = !settings.store.active; }}
                />
            ), 5);
        }
    },

    stop() {
        cleanup();
        removeHeaderBarButton("SelfDestruct");
        removeChannelToolbarButton("SelfDestruct");
    },
});
