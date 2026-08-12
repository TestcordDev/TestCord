/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, registerCommand, sendBotMessage, unregisterCommand } from "@api/Commands";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu, React, SelectedChannelStore, Toasts } from "@webpack/common";

const wsModule = findByPropsLazy("getSocket");
const ChannelStore = findByPropsLazy("getChannel", "getDMFromUserId");
const MediaEngineStore = findByPropsLazy("isDeaf", "isMute");

export const settings = definePluginSettings({
    userAreaButton: {
        type: OptionType.BOOLEAN,
        description: "Show button in user area (voice controls)",
        default: true
    },
    contextMenu: {
        type: OptionType.BOOLEAN,
        description: "Show options in audio device context menu",
        default: true
    },
    slashCommands: {
        type: OptionType.BOOLEAN,
        description: "Enable slash commands to toggle fake mute and deafen.",
        default: false
    },
    combinedContextItem: {
        type: OptionType.BOOLEAN,
        description: "Show a combined Fake Mute & Deafen toggle in the audio device context menu.",
        default: false
    },
    autoMute: {
        type: OptionType.BOOLEAN,
        description: "Automatically fake mute when fake deafened.",
        default: true
    },
    muteKeybind: {
        description: "⌨️ Keybind for toggling fake mute only (format: modifier+key, e.g., 'ctrl+j')",
        type: OptionType.STRING,
        default: "ctrl+j"
    },
    deafenKeybind: {
        description: "⌨️ Keybind for toggling fake deafen + fake mute (format: modifier+key, e.g., 'ctrl+l')",
        type: OptionType.STRING,
        default: "ctrl+l"
    }
});

const fakeVoiceState = {
    _selfMute: false,
    get selfMute() {
        try {
            if (!settings.store.autoMute) return this._selfMute;
            return this.selfDeaf || this._selfMute;
        } catch (e) {
            return this._selfMute;
        }
    },
    set selfMute(value) {
        this._selfMute = value;
    },
    selfDeaf: false,
    selfVideo: false
};

let buttonRerender: (() => void) | null = null;

function refreshVoiceState() {
    buttonRerender?.();
    if (!wsModule || !SelectedChannelStore || !ChannelStore || !MediaEngineStore) return;

    const socket = wsModule.getSocket();
    const channelId = SelectedChannelStore.getVoiceChannelId?.();
    if (!socket || !channelId) return;

    const channel = ChannelStore.getChannel(channelId);
    try {
        socket.send(4, {
            guild_id: channel?.guild_id ?? null,
            channel_id: channelId,
            self_mute: fakeVoiceState.selfMute || (MediaEngineStore.isMute?.() ?? false),
            self_deaf: fakeVoiceState.selfDeaf || (MediaEngineStore.isDeaf?.() ?? false),
            self_video: fakeVoiceState.selfVideo,
            flags: 0
        });
    } catch (error) {
        console.error("[FakeMuteDeafen] Failed to broadcast forced voice state update:", error);
    }
}

function parseKeybind(keybind: string) {
    const parts = keybind.toLowerCase().split("+");
    const modifiers = {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false
    };
    let key = "";

    for (const part of parts) {
        if (part === "ctrl") modifiers.ctrl = true;
        else if (part === "alt") modifiers.alt = true;
        else if (part === "shift") modifiers.shift = true;
        else if (part === "meta" || part === "cmd") modifiers.meta = true;
        else key = part;
    }

    return { ...modifiers, key };
}

function matchesKeybind(event: KeyboardEvent, keybind: string) {
    const parsed = parseKeybind(keybind);
    return (
        event.ctrlKey === parsed.ctrl &&
        event.altKey === parsed.alt &&
        event.shiftKey === parsed.shift &&
        event.metaKey === parsed.meta &&
        event.key.toLowerCase() === parsed.key
    );
}

function handleKeydown(e: KeyboardEvent) {
    if (e.target && (
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "TEXTAREA" ||
        (e.target as HTMLElement).contentEditable === "true"
    )) {
        return;
    }

    if (matchesKeybind(e, settings.store.muteKeybind)) {
        e.preventDefault();
        fakeVoiceState.selfMute = !fakeVoiceState.selfMute;
        Toasts.show({
            message: `🎤 Fake mute is now: ${fakeVoiceState.selfMute ? "enabled" : "disabled"}`,
            id: "fake-mute",
            type: fakeVoiceState.selfMute ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
        refreshVoiceState();
        return;
    }

    if (matchesKeybind(e, settings.store.deafenKeybind)) {
        e.preventDefault();
        fakeVoiceState.selfDeaf = !fakeVoiceState.selfDeaf;
        if (settings.store.autoMute) {
            fakeVoiceState.selfMute = fakeVoiceState.selfDeaf;
        }
        const statusMsg = fakeVoiceState.selfDeaf ? "enabled" : "disabled";
        const muteStatusMsg = (fakeVoiceState.selfDeaf && settings.store.autoMute) ? " (+ fake mute)" : "";
        Toasts.show({
            message: `🔇 Fake deafen is now: ${statusMsg}${muteStatusMsg}`,
            id: "fake-deafen",
            type: fakeVoiceState.selfDeaf ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
        refreshVoiceState();
        return;
    }
}

function FakeDeafenIcon({ className }: { className?: string; }) {
    const enabled = fakeVoiceState.selfDeaf;
    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: enabled ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg className={className} width="28" height="28" viewBox="0 0 32 32" fill="none">
            <mask id="fakeMuteDeafenLine">
                <rect width="100%" height="100%" fill="#ffffff" />
                <line
                    className="blackLine"
                    x1="29"
                    y1="2"
                    x2="2"
                    y2="29"
                    stroke="#000000"
                    strokeWidth="8"
                    strokeLinecap="round"
                    style={lineStyle}
                />
            </mask>

            <g mask="url(#fakeMuteDeafenLine)">
                <rect
                    x="6"
                    y="8"
                    width="20"
                    height="4"
                    rx="2"
                    fill={!enabled ? "var(--status-danger)" : "currentColor"}
                />
                <rect
                    x="11"
                    y="3"
                    width="10"
                    height="8"
                    rx="3"
                    fill={!enabled ? "var(--status-danger)" : "currentColor"}
                />
                <circle
                    cx="10"
                    cy="21"
                    r="4"
                    stroke={!enabled ? "var(--status-danger)" : "currentColor"}
                    strokeWidth="2"
                    fill="none"
                />
                <circle
                    cx="22"
                    cy="21"
                    r="4"
                    stroke={!enabled ? "var(--status-danger)" : "currentColor"}
                    strokeWidth="2"
                    fill="none"
                />
                <path
                    d="M14 21c1 1 3 1 4 0"
                    stroke={!enabled ? "var(--status-danger)" : "currentColor"}
                    strokeWidth="2"
                    strokeLinecap="round"
                />
            </g>

            <line
                x1="29"
                y1="2"
                x2="2"
                y2="29"
                stroke="var(--status-danger, currentColor)"
                strokeWidth="2"
                strokeLinecap="round"
                style={lineStyle}
            />
        </svg>
    );
}

function FakeMuteDeafenButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const handleClick = React.useCallback(() => {
        fakeVoiceState.selfDeaf = !fakeVoiceState.selfDeaf;
        if (settings.store.autoMute) {
            fakeVoiceState.selfMute = fakeVoiceState.selfDeaf;
        }

        refreshVoiceState();
        forceUpdate();
    }, []);

    const isEnabled = fakeVoiceState.selfDeaf;

    React.useEffect(() => {
        buttonRerender = forceUpdate;
        return () => { buttonRerender = null; };
    }, []);

    return (
        <UserAreaButton
            className="button__201d5 wrapper__201d5"
            tooltipText={
                hideTooltips ? void 0 : isEnabled ? "Disable Fake Mute & Deafen" : "Enable Fake Mute & Deafen"
            }
            icon={<FakeDeafenIcon className={iconForeground} />}
            role="switch"
            aria-checked={isEnabled}
            redGlow={!isEnabled}
            plated={nameplate != null}
            onClick={handleClick}
        />
    );
}

let lastVoiceChannelId: string | null = null;
let refreshVoiceStateTimer: ReturnType<typeof setTimeout> | null = null;
function handleVoiceChannelChange() {
    try {
        const currentChannelId = SelectedChannelStore?.getVoiceChannelId?.();
        const previousChannelId = lastVoiceChannelId || null;

        lastVoiceChannelId = currentChannelId ?? null;

        if (currentChannelId && currentChannelId !== previousChannelId && (fakeVoiceState.selfMute || fakeVoiceState.selfDeaf)) {
            if (refreshVoiceStateTimer) clearTimeout(refreshVoiceStateTimer);
            refreshVoiceStateTimer = setTimeout(() => {
                refreshVoiceStateTimer = null;
                refreshVoiceState();
            }, 500);
        }
    } catch (error) {
        console.error("[FakeMuteDeafen] Error in handleVoiceChannelChange:", error);
    }
}

let originalSend: any;
let commandsRegistered = false;

export default definePlugin({
    name: "FakeMuteDeafen",
    description: "Fake mute and deafen yourself. You can continue speaking and being heard during this time. Toggle via user area button, context menu, or keybinds.",
    tags: ["Voice", "Privacy"],
    authors: [TestcordDevs.x2b, TestcordDevs.dot, TestcordDevs.sirphantom89, TestcordDevs.hyyven],
    dependencies: ["CommandsAPI"],
    settings,

    start() {
        const socket = wsModule?.getSocket?.();
        if (socket && !originalSend) {
            originalSend = socket.send;
            socket.send = function (op: number, data: any, ...args: any[]) {
                if (op === 4 && data) {
                    if (fakeVoiceState.selfMute) data.self_mute = true;
                    if (fakeVoiceState.selfDeaf) data.self_deaf = true;
                    if (fakeVoiceState.selfVideo) data.self_video = true;
                }
                return originalSend.apply(this, [op, data, ...args]);
            };
        }

        if (settings.store.userAreaButton) {
            try {
                (window as any).Vencord?.Api?.UserArea?.addUserAreaButton("fake-mute-deafen", FakeMuteDeafenButton);
            } catch (e) {
                console.warn("[FakeMuteDeafen] Failed to add user area button:", e);
            }
        }

        document.addEventListener("keydown", handleKeydown);
        if (SelectedChannelStore?.addChangeListener) {
            SelectedChannelStore.addChangeListener(handleVoiceChannelChange);
        }

        if (!isPluginEnabled("FakeVoicePremium")) {
            registerCommand({
                inputType: ApplicationCommandInputType.BUILT_IN,
                name: "fakemute",
                description: "Toggle fake mute",
                execute: (_, ctx) => {
                    if (!settings.store.slashCommands) {
                        sendBotMessage(ctx.channel.id, { content: "Slash commands are disabled. Enable them in FakeMuteDeafen settings." });
                        return;
                    }
                    fakeVoiceState.selfMute = !fakeVoiceState.selfMute;
                    refreshVoiceState();
                    sendBotMessage(ctx.channel.id, { content: `🎤 Fake mute is now ${fakeVoiceState.selfMute ? "enabled" : "disabled"}.` });
                }
            }, "FakeMuteDeafen");
            registerCommand({
                inputType: ApplicationCommandInputType.BUILT_IN,
                name: "fakedeafen",
                description: "Toggle fake deafen",
                execute: (_, ctx) => {
                    if (!settings.store.slashCommands) {
                        sendBotMessage(ctx.channel.id, { content: "Slash commands are disabled. Enable them in FakeMuteDeafen settings." });
                        return;
                    }
                    fakeVoiceState.selfDeaf = !fakeVoiceState.selfDeaf;
                    if (settings.store.autoMute) fakeVoiceState.selfMute = fakeVoiceState.selfDeaf;
                    refreshVoiceState();
                    const muteNote = (fakeVoiceState.selfDeaf && settings.store.autoMute) ? " (+ fake mute)" : "";
                    sendBotMessage(ctx.channel.id, { content: `🔇 Fake deafen is now ${fakeVoiceState.selfDeaf ? "enabled" : "disabled"}${muteNote}.` });
                }
            }, "FakeMuteDeafen");
            registerCommand({
                inputType: ApplicationCommandInputType.BUILT_IN,
                name: "fakedeafen_mute",
                description: "Toggle fake deafen and fake mute together",
                execute: (_, ctx) => {
                    if (!settings.store.slashCommands) {
                        sendBotMessage(ctx.channel.id, { content: "Slash commands are disabled. Enable them in FakeMuteDeafen settings." });
                        return;
                    }
                    const next = !(fakeVoiceState.selfMute && fakeVoiceState.selfDeaf);
                    fakeVoiceState.selfMute = next;
                    fakeVoiceState.selfDeaf = next;
                    refreshVoiceState();
                    sendBotMessage(ctx.channel.id, { content: `👻 Fake mute and deafen are now ${next ? "enabled" : "disabled"}.` });
                }
            }, "FakeMuteDeafen");
            commandsRegistered = true;
        }
    },

    stop() {
        const socket = wsModule?.getSocket?.();
        if (socket && originalSend) {
            socket.send = originalSend;
            originalSend = undefined;
        }

        try {
            (window as any).Vencord?.Api?.UserArea?.removeUserAreaButton("fake-mute-deafen");
        } catch (e) { }

        document.removeEventListener("keydown", handleKeydown);
        if (refreshVoiceStateTimer) {
            clearTimeout(refreshVoiceStateTimer);
            refreshVoiceStateTimer = null;
        }
        if (SelectedChannelStore?.removeChangeListener) {
            SelectedChannelStore.removeChangeListener(handleVoiceChannelChange);
        }

        if (commandsRegistered) {
            unregisterCommand("fakemute");
            unregisterCommand("fakedeafen");
            unregisterCommand("fakedeafen_mute");
            commandsRegistered = false;
        }
    },

    contextMenus: {
        "audio-device-context"(children: any[], d: any) {
            if (!settings.store.contextMenu) return;

            if (settings.store.combinedContextItem) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="fake-mute-deafen-both"
                        label="Fake Mute & Deafen"
                        checked={fakeVoiceState.selfMute && fakeVoiceState.selfDeaf}
                        action={() => {
                            const next = !(fakeVoiceState.selfMute && fakeVoiceState.selfDeaf);
                            fakeVoiceState.selfMute = next;
                            fakeVoiceState.selfDeaf = next;
                            refreshVoiceState();
                        }}
                    />
                );
            }

            if (d.renderInputDevices) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="fake-mute"
                        label="Fake Mute"
                        checked={fakeVoiceState.selfMute}
                        action={() => {
                            fakeVoiceState.selfMute = !fakeVoiceState.selfMute;
                            refreshVoiceState();
                        }}
                    />
                );
            }

            if (d.renderOutputDevices) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="fake-deafen"
                        label="Fake Deafen"
                        checked={fakeVoiceState.selfDeaf}
                        action={() => {
                            fakeVoiceState.selfDeaf = !fakeVoiceState.selfDeaf;
                            if (settings.store.autoMute) {
                                fakeVoiceState.selfMute = fakeVoiceState.selfDeaf;
                            }
                            refreshVoiceState();
                        }}
                    />
                );
            }
        },
        "video-device-context"(children: any[]) {
            if (!settings.store.contextMenu) return;

            children.push(
                <Menu.MenuSeparator />,
                <Menu.MenuCheckboxItem
                    id="fake-video"
                    label="Fake Camera"
                    checked={fakeVoiceState.selfVideo}
                    action={() => {
                        fakeVoiceState.selfVideo = !fakeVoiceState.selfVideo;
                        refreshVoiceState();
                    }}
                />
            );
        }
    }
});
