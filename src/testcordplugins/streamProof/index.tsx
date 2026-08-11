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
import { React, UserStore, useState, useStateFromStores } from "@webpack/common";

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
    localBlackout: {
        type: OptionType.BOOLEAN,
        description: "Blackout entire client on your local screen as well",
        default: false,
        onChange(value) {
            if (streamProofActive) {
                if (value) document.body.classList.add("stream-proof-local-blackout");
                else document.body.classList.remove("stream-proof-local-blackout");
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

let clickHandler: ((e: MouseEvent) => void) | null = null;
let streamProofActive = false;

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

    if (settings.store.blackoutStream) {
        Native?.setContentProtection?.(true);
    }

    if (settings.store.localBlur) {
        document.body.classList.add("stream-proof-enabled");
    }

    if (settings.store.localBlackout) {
        document.body.classList.add("stream-proof-local-blackout");
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

    Native?.setContentProtection?.(false);

    document.body.classList.remove("stream-proof-enabled");
    document.body.classList.remove("stream-proof-local-blackout");

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

// ── Chat Bar Button ────────────────────────────────────────────────────────────

const StreamProofButton: ChatBarButtonFactory = ({ isMainChat }) => {
    useStateFromStores([StreamerModeStore, StreamStore, RTCConnectionStore], () => isStreaming());
    const [, forceUpdate] = useState({});

    if (!isMainChat || settings.store.location !== "chatbar") return null;

    function toggle() {
        if (streamProofActive) {
            disableStreamProof();
        } else {
            enableStreamProof();
        }
        forceUpdate({});
    }

    const active = streamProofActive;
    const tooltip = active
        ? "StreamProof : ON — click to disable"
        : "StreamProof : OFF — click to enable";

    return (
        <ChatBarButton tooltip={tooltip} onClick={toggle}>
            <span style={{ color: active ? "var(--status-danger)" : "currentColor" }}>
                {active ? <EyeSlashIcon /> : <EyeIcon />}
            </span>
        </ChatBarButton>
    );
};

// ── Plugin ─────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "StreamProof",
    description: "Hides messages, links, images, DMs, but not the screen share/voice grid. Toggle via chat bar button.",
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
                    tooltip={streamProofActive ? "StreamProof: ON — click to disable" : "StreamProof: OFF — click to enable"}
                    onClick={() => { streamProofActive ? disableStreamProof() : enableStreamProof(); }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("StreamProof", () => (
                <ChannelToolbarButton
                    icon={() => streamProofActive ? <EyeSlashIcon /> : <EyeIcon />}
                    tooltip={streamProofActive ? "StreamProof: ON — click to disable" : "StreamProof: OFF — click to enable"}
                    onClick={() => { streamProofActive ? disableStreamProof() : enableStreamProof(); }}
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
