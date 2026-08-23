/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ContextMenuApi, Menu, React, useEffect, UserStore, useState, useStateFromStores } from "@webpack/common";

const Native = IS_DISCORD_DESKTOP
    ? (VencordNative?.pluginHelpers?.StreamProof as PluginNative<typeof import("./native")>)
    : undefined;

const StreamStore = findByPropsLazy("getActiveStreamForUser", "getAllActiveStreams");
const RTCConnectionStore = findByPropsLazy("getMediaSessionId");
const StreamerModeStore = findByPropsLazy("hidePersonalInformation");

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
    blackoutStream: {
        type: OptionType.BOOLEAN,
        description: "Blacken entire client for stream viewers (Native Content Protection)",
        default: true,
        onChange(value) {
            if (streamProofActive) {
                Native?.setContentProtection?.(value);
            }
        }
    },
    localBlur: {
        type: OptionType.BOOLEAN,
        description: "Blur messages, media, and DMs on your local screen",
        default: true,
        onChange(value) {
            if (streamProofActive) {
                if (value) document.body.classList.add("stream-proof-enabled");
                else document.body.classList.remove("stream-proof-enabled");
            }
        }
    },
    autoStreamProof: {
        type: OptionType.BOOLEAN,
        description: "Automatically enable StreamProof when you start streaming",
        default: false,
        onChange(value) {
            if (value && isStreaming()) {
                enableStreamProof();
            }
        }
    }
});

const CONTEXT_MENU_KEYS = ["blackoutStream", "localBlur"] as const;

let clickHandler: ((e: MouseEvent) => void) | null = null;
let streamProofActive = false;

// Subscribers notified whenever `streamProofActive` changes, so mounted UI (the
// toggle button) can re-render event-driven instead of polling on an interval.
const activeListeners = new Set<() => void>();

function subscribeActive(listener: () => void) {
    activeListeners.add(listener);
    return () => {
        activeListeners.delete(listener);
    };
}

function notifyActiveChanged() {
    for (const listener of activeListeners) listener();
}

function toggleStreamProof() {
    streamProofActive ? disableStreamProof() : enableStreamProof();
}

function isStreaming(): boolean {
    try {
        if (StreamerModeStore?.hidePersonalInformation) {
            return true;
        }

        const currentUser = UserStore?.getCurrentUser?.();
        if (!currentUser) return false;

        const userStream = StreamStore?.getActiveStreamForUser?.(currentUser.id);
        if (userStream) return true;

        const allStreams = StreamStore?.getAllActiveStreams?.();
        if (allStreams && allStreams.length > 0) {
            const myStream = allStreams.find((s: any) => s.ownerId === currentUser.id);
            if (myStream) return true;
        }

        const mediaSessionId = RTCConnectionStore?.getMediaSessionId?.();
        if (mediaSessionId) {
            const state = RTCConnectionStore?.getState?.();
            if (state && state.context === "stream") return true;
        }

        return false;
    } catch (e) {
        return false;
    }
}

function handleStreamChange() {
    if (!settings.store.autoStreamProof) return;

    if (isStreaming()) {
        enableStreamProof();
    } else {
        disableStreamProof();
    }
}

function enableStreamProof() {
    if (streamProofActive) return;
    streamProofActive = true;
    notifyActiveChanged();

    if (settings.store.blackoutStream) {
        Native?.setContentProtection?.(true);
    }

    if (settings.store.localBlur) {
        document.body.classList.add("stream-proof-enabled");
    }

    if (!clickHandler) {
        clickHandler = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            const targetElement = target.closest("[class*=\"messageContent_\"], [class*=\"markup_\"], [class*=\"imageWrapper_\"], [class*=\"embedWrapper_\"], [id^=\"message-accessories-\"] article, [class*=\"attachment_\"], [class*=\"video_\"], [class*=\"voiceMessage_\"], [class*=\"wrapperPaused_\"], [class*=\"wrapperPlaying_\"], [class*=\"audioAttachment_\"], [class*=\"fileUpload_\"], [class*=\"wrapperAudio_\"], [class*=\"mediaBarInteraction_\"], [class*=\"newMosaicStyle_\"], [class*=\"stickerAsset_\"], [class*=\"channel_\"][class*=\"interactive_\"]");
            if (targetElement && !targetElement.classList.contains("stream-proof-revealed")) {
                targetElement.classList.add("stream-proof-revealed");
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener("click", clickHandler as any, true);
    }
}

function disableStreamProof() {
    if (!streamProofActive) return;
    streamProofActive = false;
    notifyActiveChanged();

    Native?.setContentProtection?.(false);

    document.body.classList.remove("stream-proof-enabled");

    if (clickHandler) {
        document.removeEventListener("click", clickHandler as any, true);
        clickHandler = null;
    }
    document.querySelectorAll(".stream-proof-revealed").forEach(el => {
        el.classList.remove("stream-proof-revealed");
    });
}

// ── Eye Icons ──────────────────────────────────────────────────────────────────

function EyeIcon({ height = 20, width = 20 }: { height?: number; width?: number; }) {
    return (
        <svg
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
        >
            <path
                fill="currentColor"
                d="M12 5C5.648 5 1 12 1 12s4.648 7 11 7 11-7 11-7-4.648-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
            />
        </svg>
    );
}

function EyeSlashIcon({ height = 20, width = 20 }: { height?: number; width?: number; }) {
    return (
        <svg
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
        >
            <path
                fill="currentColor"
                d="M2.22 2.22a.75.75 0 0 1 1.06 0l18.5 18.5a.75.75 0 1 1-1.06 1.06l-3.56-3.56A11.18 11.18 0 0 1 12 19C5.648 19 1 12 1 12s1.81-2.73 4.69-4.95L2.22 3.28a.75.75 0 0 1 0-1.06ZM7.1 8.52A8.87 8.87 0 0 0 3.07 12 9.57 9.57 0 0 0 12 17c1.47 0 2.85-.34 4.1-.93l-1.7-1.7A3 3 0 0 1 10.63 10.6L7.1 8.52ZM12 5c1.92 0 3.7.52 5.25 1.37l-1.5 1.5A8.87 8.87 0 0 0 20.93 12a9.57 9.57 0 0 1-3.37 3.44l1.5 1.5C21.42 15.2 23 12 23 12s-4.648-7-11-7Z"
            />
        </svg>
    );
}

// ── Context Menu ───────────────────────────────────────────────────────────────

function renderStreamProofMenuItems(includeEnabledToggle = false, enabled = streamProofActive, setEnabled?: (value: boolean) => void) {
    return [
        includeEnabledToggle && (
            <Menu.MenuCheckboxItem
                id="toggle-stream-proof"
                key="toggle-stream-proof"
                label="Enabled"
                checked={enabled}
                action={() => {
                    const newEnabled = !enabled;
                    setEnabled?.(newEnabled);
                    toggleStreamProof();
                }}
            />
        ),
        <Menu.MenuCheckboxItem
            id="update-blackout-stream"
            key="update-blackout-stream"
            label="Blackout Stream"
            checked={settings.store.blackoutStream}
            action={() => {
                settings.store.blackoutStream = !settings.store.blackoutStream;
            }}
        />,
        <Menu.MenuCheckboxItem
            id="update-local-blur"
            key="update-local-blur"
            label="Local Blur"
            checked={settings.store.localBlur}
            action={() => {
                settings.store.localBlur = !settings.store.localBlur;
            }}
        />
    ];
}

function StreamProofContextMenu() {
    const [enabled, setEnabled] = useState(streamProofActive);
    settings.use(CONTEXT_MENU_KEYS);

    return (
        <Menu.Menu
            navId="stream-proof-context"
            onClose={() => { }}
            aria-label="StreamProof options"
        >
            <Menu.MenuGroup label="STREAMPROOF">
                {renderStreamProofMenuItems(true, enabled, setEnabled)}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function openStreamProofContextMenu(e: React.MouseEvent) {
    ContextMenuApi.openContextMenu(e, () => <StreamProofContextMenu />);
}

// ── Chat Bar Button ────────────────────────────────────────────────────────────

const StreamProofButton: ChatBarButtonFactory = ({ isMainChat }) => {
    useStateFromStores([StreamerModeStore, StreamStore, RTCConnectionStore], () => isStreaming());
    const [, forceUpdate] = useState({});

    // Re-render so the button reflects `streamProofActive` after it changes via any
    // control (context menu, auto-enable on stream start). Event-driven.
    useEffect(() => subscribeActive(() => forceUpdate({})), []);

    if (!isMainChat || settings.store.location !== "chatbar") return null;

    function toggle() {
        toggleStreamProof();
        forceUpdate({});
    }

    const active = streamProofActive;
    const tooltip = "StreamProof";

    return (
        <ChatBarButton tooltip={tooltip} onClick={toggle} onContextMenu={openStreamProofContextMenu}>
            <span style={{ color: active ? "var(--status-danger)" : "currentColor" }}>
                {active ? <EyeSlashIcon /> : <EyeIcon />}
            </span>
        </ChatBarButton>
    );
};

// ── Plugin ─────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "StreamProof",
    description: "Hides messages, links, images, DMs, but not the screen share/voice grid. Toggle via button (right-click for options).",
    authors: [EquicordDevs.TheArmagan],
    dependencies: ["ChatInputButtonAPI", "HeaderBarAPI"],
    settings,

    chatBarButton: {
        icon: () => (streamProofActive ? <EyeSlashIcon /> : <EyeIcon />),
        render: StreamProofButton,
    },

    flux: {
        STREAM_START() { handleStreamChange(); },
        STREAM_STOP() { handleStreamChange(); },
        STREAM_CREATE() { handleStreamChange(); },
        STREAM_DELETE() { handleStreamChange(); },
        STREAMER_MODE_UPDATE() { handleStreamChange(); },
        RTC_CONNECTION_STATE() { handleStreamChange(); }
    },

    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("StreamProof", () => (
                <HeaderBarButton
                    icon={() => streamProofActive ? <EyeSlashIcon /> : <EyeIcon />}
                    tooltip="StreamProof"
                    onClick={() => { toggleStreamProof(); }}
                    onContextMenu={openStreamProofContextMenu}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("StreamProof", () => (
                <ChannelToolbarButton
                    icon={() => streamProofActive ? <EyeSlashIcon /> : <EyeIcon />}
                    tooltip="StreamProof"
                    onClick={() => { toggleStreamProof(); }}
                    onContextMenu={openStreamProofContextMenu}
                />
            ), 5);
        }
        if (settings.store.autoStreamProof && isStreaming()) {
            enableStreamProof();
        }
    },
    stop() {
        disableStreamProof();
        removeHeaderBarButton("StreamProof");
        removeChannelToolbarButton("StreamProof");
    }
});
