/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Channel, VoiceState } from "@vencord/discord-types";
import { findByCodeLazy, findByProps, findByPropsLazy, findStore } from "@webpack";
import { ChannelStore, ContextMenuApi, MediaEngineStore, Menu, PermissionsBits, PermissionStore, React, SelectedChannelStore, UserStore, VoiceActions } from "@webpack/common";

import { settings } from "./settings";

const CONTEXT_MENU_KEYS = ["fakeMute", "fakeDeafen", "fakeStream", "fakeGame", "fakeCam", "cutMicTransmission"] as const;

export let faked = false;

// Subscribers notified whenever `faked` changes, so mounted UI (the user-area
// toggle button) can re-render event-driven instead of polling on an interval.
const fakedListeners = new Set<() => void>();

function subscribeFaked(listener: () => void) {
    fakedListeners.add(listener);
    return () => {
        fakedListeners.delete(listener);
    };
}

function notifyFakedChanged() {
    for (const listener of fakedListeners) listener();
}

// Direct gateway socket access — fakeMuteDeafen's mechanism. The voiceStateSender
// lookup syncFakeVoiceState used to rely on is fragile across Discord builds; when
// its module shape shifts the lookup silently fails and fake mute/deafen never
// broadcast. Patching the raw socket.send + re-broadcasting op-4 here does not
// depend on that lookup.
const wsModule = findByPropsLazy("getSocket");
const startStreamAction = findByCodeLazy('type:"STREAM_START"');
const stopStreamAction = findByCodeLazy('type:"STREAM_STOP"');

const STREAM = 1n << 9n;
const DEFAULT_VOICE_CONTEXT = "default";
const WATCH_TOGETHER_APPLICATION_ID = "880218394199220334";

let originalSocketSend: any;
let micCutoffApplied = false;
let selfMuteBeforeMicCutoff = false;
let micCutoffTimeout: ReturnType<typeof setTimeout> | null = null;
let fakeStreamActive = false;

function getSelectedVoiceChannel() {
    const selected = SelectedChannelStore.getVoiceChannelId();
    if (!selected) return null;

    return ChannelStore.getChannel(selected);
}

function syncFakeVoiceState() {
    // Broadcast op-4 (voice state update) directly through the gateway socket so a
    // setting flip actually re-sends state. The socket.send patch below stamps the
    // faked self_mute/self_deaf/self_video onto it; here we keep the REAL mic/deaf
    // from MediaEngineStore as the base so you still speak/hear while spoofed.
    const socket = wsModule?.getSocket?.();
    const channelId = SelectedChannelStore.getVoiceChannelId?.();
    if (!socket || !channelId) return;

    const channel = ChannelStore.getChannel(channelId);
    try {
        socket.send(4, {
            guild_id: channel?.guild_id ?? null,
            channel_id: channelId,
            self_mute: MediaEngineStore.isSelfMute?.() ?? false,
            self_deaf: MediaEngineStore.isSelfDeaf?.() ?? false,
            self_video: MediaEngineStore.isVideoEnabled?.() ?? false,
            flags: 0
        });
    } catch (e) {
        console.error("[FakeVoicePremium] Failed to broadcast voice state update:", e);
    }
}

function setFakeCameraEnabled(enabled: boolean) {
    settings.store.fakeCam = enabled;

    if (faked) {
        syncFakeVoiceState();
    }
}

function canUseFakeCamera(channel: Channel) {
    return PermissionStore.can(STREAM, channel);
}

function canUseFakeActivity(channel: Channel) {
    return PermissionStore.can(PermissionsBits.USE_EMBEDDED_ACTIVITIES, channel);
}

function getEmbeddedActivityLocation(channelId: string) {
    return {
        channelId,
        guildId: ChannelStore.getChannel(channelId)?.guild_id ?? null
    };
}

async function startActivity(channelId: string) {
    const activityApi = findByProps("su", "_H");
    if (!activityApi?.su) return;

    await activityApi.su({
        channelId,
        applicationId: WATCH_TOGETHER_APPLICATION_ID,
        isStart: true,
        locationObject: getEmbeddedActivityLocation(channelId)
    });
}

function hasFakeActivity(channelId: string) {
    const embeddedActivitiesStore = findStore("EmbeddedActivitiesStore");
    return embeddedActivitiesStore?.getSelfEmbeddedActivityForChannel?.(channelId)?.applicationId === WATCH_TOGETHER_APPLICATION_ID;
}

function hasFakeStream() {
    const connectionStore = findStore("StreamRTCConnectionStore");
    return connectionStore?.getAllActiveStreamKeys?.().length > 0;
}

function leaveActivity(channelId?: string) {
    const activityApi = findByProps("su", "_H");
    const frameApi = findByProps("launchFrame", "refreshProxyTicket", "stopFrame");
    const embeddedActivitiesStore = findStore("EmbeddedActivitiesStore");
    const activity = embeddedActivitiesStore?.getCurrentEmbeddedActivity?.()
        ?? (channelId ? embeddedActivitiesStore?.getSelfEmbeddedActivityForChannel?.(channelId) : null);
    const location = embeddedActivitiesStore?.getConnectedActivityLocation?.()
        ?? activity?.location
        ?? (channelId ? getEmbeddedActivityLocation(channelId) : null);

    if (!location) return;
    if (!activity?.applicationId) return;

    activityApi?._H?.({
        location,
        applicationId: activity.applicationId,
        showFeedback: false
    });
    frameApi?.stopFrame?.({ applicationId: activity.applicationId });
}

function syncMicCutoff(enabled: boolean) {
    const shouldCutMic = enabled && settings.store.cutMicTransmission && getSelectedVoiceChannel();

    if (!shouldCutMic) {
        if (!micCutoffApplied) return;

        if (!selfMuteBeforeMicCutoff && MediaEngineStore.isSelfMute()) {
            VoiceActions.setSelfMute(DEFAULT_VOICE_CONTEXT, false, false);
        }

        micCutoffApplied = false;
        selfMuteBeforeMicCutoff = false;
        return;
    }

    if (micCutoffApplied) return;

    selfMuteBeforeMicCutoff = MediaEngineStore.isSelfMute();
    if (!selfMuteBeforeMicCutoff) {
        VoiceActions.setSelfMute(DEFAULT_VOICE_CONTEXT, true, false);
        micCutoffApplied = true;
    }
}

function scheduleMicCutoffSync(enabled: boolean, delay = 0) {
    if (micCutoffTimeout != null) clearTimeout(micCutoffTimeout);

    if (delay <= 0) {
        micCutoffTimeout = null;
        syncMicCutoff(enabled);
        return;
    }

    micCutoffTimeout = setTimeout(() => {
        micCutoffTimeout = null;
        syncMicCutoff(enabled);
    }, delay);
}

async function startStream() {
    const ConnectionStore = findStore("StreamRTCConnectionStore");

    const selected = SelectedChannelStore.getVoiceChannelId();
    if (!selected) return;

    const channel = ChannelStore.getChannel(selected);

    if (settings.store.fakeStream) {
        startStreamAction(channel.guild_id, selected, {
            pid: null,
            sourceId: null,
            sourceName: null,
            audioSourceId: null,
            sound: false,
            previewDisabled: true
        });
    } else {
        for (const streamKey of ConnectionStore.getAllActiveStreamKeys()) {
            stopStreamAction(streamKey, { streamKey, appContext: "app" });
            break;
        }
    }
}

function Icon({ className, enabled }: { className?: string; enabled?: boolean; }) {
    const lineLength = 640;

    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: enabled ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 512 512">
            <mask id="FakeVoicePremiumLine">
                <rect width="100%" height="100%" fill="#ffffff" />
                <line
                    className="blackLine"
                    x1="469"
                    y1="42"
                    x2="42"
                    y2="469"
                    stroke="#000000"
                    strokeWidth="128"
                    strokeLinecap="round"
                    style={lineStyle}
                />
            </mask>

            <path
                mask="url(#FakeVoicePremiumLine)"
                fill={!enabled ? "var(--status-danger)" : "currentColor"}
                d="M256 48C141.1 48 48 141.1 48 256v40c0 13.3-10.7 24-24 24s-24-10.7-24-24V256C0 114.6 114.6 0 256 0S512 114.6 512 256V400.1c0 48.6-39.4 88-88.1 88L313.6 488c-8.3 14.3-23.8 24-41.6 24H240c-26.5 0-48-21.5-48-48s21.5-48 48-48h32c17.8 0 33.3 9.7 41.6 24l110.4.1c22.1 0 40-17.9 40-40V256c0-114.9-93.1-208-208-208zM144 208h16c17.7 0 32 14.3 32 32V352c0 17.7-14.3 32-32 32H144c-35.3 0-64-28.7-64-64V272c0-35.3 28.7-64 64-64zm224 0c35.3 0 64 28.7 64 64v48c0 35.3-28.7 64-64 64H352c-17.7 0-32-14.3-32-32V240c0-17.7 14.3-32 32-32h16z"
            />

            <line
                x1="469"
                y1="42"
                x2="42"
                y2="469"
                stroke="var(--status-danger, currentColor)"
                strokeWidth="42"
                strokeLinecap="round"
                style={lineStyle}
            />
        </svg>
    );
}

function setFakeVoiceEnabled(enabled: boolean) {
    const changed = faked !== enabled;
    faked = enabled;
    if (changed) notifyFakedChanged();

    const channel = getSelectedVoiceChannel();

    if (!enabled && settings.store.fakeGame) {
        leaveActivity(channel?.id);
    }

    if (!channel) {
        fakeStreamActive = false;
        scheduleMicCutoffSync(false);
        return;
    }

    fakeStreamActive = enabled && settings.store.fakeStream && PermissionStore.can(STREAM, channel);

    if (fakeStreamActive) {
        startStream();
    }

    if (settings.store.fakeGame && enabled && canUseFakeActivity(channel)) {
        void startActivity(channel.id);
    }

    if (!enabled && settings.store.fakeStream) {
        const ConnectionStore = findStore("StreamRTCConnectionStore");
        for (const streamKey of ConnectionStore.getAllActiveStreamKeys()) {
            stopStreamAction(streamKey, { streamKey, appContext: "app" });
            break;
        }
    }

    if (settings.store.fakeMute || settings.store.fakeDeafen || settings.store.fakeCam) {
        syncFakeVoiceState();
    }

    scheduleMicCutoffSync(enabled, enabled ? 450 : 0);
}

// --- Folded-in feature: ensure fake voice is active, then re-broadcast state ---
// All folded-in controls (keybinds, device menus, slash commands) route through this
// so the single voiceStateUpdate patch stays the only interception mechanism.
function applyAndSync() {
    const anyFake = settings.store.fakeMute || settings.store.fakeDeafen
        || settings.store.fakeStream || settings.store.fakeGame || settings.store.fakeCam;

    if (anyFake && !faked) {
        setFakeVoiceEnabled(true);
    } else if (!anyFake && faked) {
        setFakeVoiceEnabled(false);
    } else if (faked) {
        syncFakeVoiceState();
    }
}

// Auto-mute-on-deafen (from fakeMuteDeafen): enabling fake deafen implies fake mute.
function applyAutoMute() {
    if (settings.store.autoMute && settings.store.fakeDeafen) {
        settings.store.fakeMute = true;
    }
}

// --- Folded-in feature: keybinds (from fakeDeafen "dot's one") ---
function parseKeybind(keybind: string) {
    const parts = keybind.toLowerCase().split("+");
    const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
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
    const target = e.target as HTMLElement | null;
    if (target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true"
    )) {
        return;
    }

    if (matchesKeybind(e, settings.store.muteKeybind)) {
        e.preventDefault();
        settings.store.fakeMute = !settings.store.fakeMute;
        applyAndSync();
        return;
    }

    if (matchesKeybind(e, settings.store.deafenKeybind)) {
        e.preventDefault();
        settings.store.fakeDeafen = !settings.store.fakeDeafen;
        applyAutoMute();
        applyAndSync();
        return;
    }
}

function renderFakeVoiceMenuItems(includeEnabledToggle = false, enabled = faked, setEnabled?: (value: boolean) => void) {
    return [
        includeEnabledToggle && (
            <Menu.MenuCheckboxItem
                id="toggle-fake-voice"
                key="toggle-fake-voice"
                label="Enabled"
                checked={enabled}
                action={() => {
                    const newEnabled = !enabled;
                    setEnabled?.(newEnabled);
                    setFakeVoiceEnabled(newEnabled);
                }}
            />
        ),
        <Menu.MenuCheckboxItem
            id="update-mute"
            key="update-mute"
            label="Fake Mute"
            checked={settings.store.fakeMute}
            action={() => {
                settings.store.fakeMute = !settings.store.fakeMute;
                if (faked) syncFakeVoiceState();
            }}
        />,
        <Menu.MenuCheckboxItem
            id="update-deafen"
            key="update-deafen"
            label="Fake Deafen"
            checked={settings.store.fakeDeafen}
            action={() => {
                settings.store.fakeDeafen = !settings.store.fakeDeafen;
                applyAutoMute();
                if (faked) syncFakeVoiceState();
            }}
        />,
        <Menu.MenuCheckboxItem
            id="update-camera"
            key="update-camera"
            label="Fake Camera"
            checked={settings.store.fakeCam}
            action={() => {
                setFakeCameraEnabled(!settings.store.fakeCam);
            }}
        />,
        <Menu.MenuCheckboxItem
            id="update-stream"
            key="update-stream"
            label="Fake Stream"
            checked={settings.store.fakeStream}
            action={() => {
                settings.store.fakeStream = !settings.store.fakeStream;
            }}
        />,
        <Menu.MenuCheckboxItem
            id="update-game"
            key="update-game"
            label="Fake Game"
            checked={settings.store.fakeGame}
            action={() => {
                settings.store.fakeGame = !settings.store.fakeGame;
            }}
        />,
        <Menu.MenuCheckboxItem
            id="update-cut-mic"
            key="update-cut-mic"
            label="Cut Mic Transmission"
            checked={settings.store.cutMicTransmission}
            action={() => {
                settings.store.cutMicTransmission = !settings.store.cutMicTransmission;
                scheduleMicCutoffSync(faked);
            }}
        />
    ];
}

function FakeVoiceOptionToggleButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    // Re-render so the button reflects `faked` after it changes via any control
    // (keybind, context menu, slash command). Event-driven: subscribe to the
    // single mutation point (setFakeVoiceEnabled) instead of polling.
    React.useEffect(() => { return subscribeFaked(forceUpdate); }, []);

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : faked ? "Disable Fake States" : "Enable Fake States"}
            icon={<Icon className={iconForeground} enabled={faked} />}
            role="switch"
            aria-checked={faked}
            redGlow={!faked}
            plated={nameplate != null}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <ContextMenu />)}
            onClick={() => {
                setFakeVoiceEnabled(!faked);
                forceUpdate();
            }}
        />
    );
}

function ContextMenu() {
    const [enabled, setEnabled] = React.useState(faked);
    settings.use(CONTEXT_MENU_KEYS);

    return (
        <Menu.Menu
            navId="Voice-state-modifier"
            onClose={() => { }}
            aria-label="Voice state modifier"
        >
            <Menu.MenuGroup label="FAKE VOICE STATES">
                {renderFakeVoiceMenuItems(true, enabled, setEnabled)}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

const VoiceChannelContext: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!settings.store.contextMenu) return;
    if (!channel || (channel.type !== 2 && channel.type !== 13)) return;

    children.splice(
        -1,
        0,
        <Menu.MenuItem
            id="fake-voice-context"
            key="fake-voice-context"
            label="Fake Voice"
        >
            {renderFakeVoiceMenuItems(true)}
        </Menu.MenuItem>
    );
};

// --- Folded-in feature: device context menus (from fakeMuteDeafen) ---
const AudioDeviceContext: NavContextMenuPatchCallback = (children, props: any) => {
    if (!settings.store.deviceContextMenu) return;

    if (props?.renderInputDevices) {
        children.push(
            <Menu.MenuSeparator />,
            <Menu.MenuCheckboxItem
                id="fake-mute"
                label="Fake Mute"
                checked={settings.store.fakeMute}
                action={() => {
                    settings.store.fakeMute = !settings.store.fakeMute;
                    applyAndSync();
                }}
            />
        );
    }

    if (props?.renderOutputDevices) {
        children.push(
            <Menu.MenuSeparator />,
            <Menu.MenuCheckboxItem
                id="fake-deafen"
                label="Fake Deafen"
                checked={settings.store.fakeDeafen}
                action={() => {
                    settings.store.fakeDeafen = !settings.store.fakeDeafen;
                    applyAutoMute();
                    applyAndSync();
                }}
            />
        );
    }
};

const VideoDeviceContext: NavContextMenuPatchCallback = children => {
    if (!settings.store.deviceContextMenu) return;

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuCheckboxItem
            id="fake-camera"
            label="Fake Camera"
            checked={settings.store.fakeCam}
            action={() => {
                setFakeCameraEnabled(!settings.store.fakeCam);
            }}
        />
    );
};

export default definePlugin({
    name: "FakeVoicePremium",
    description: "Fake deafen, mute, stream, game, and camera in one plugin. Toggle via the user-area button (right-click for options), audio/video device menus, keybinds, or slash commands.",
    authors: [EquicordDevs.omaw, TestcordDevs.x2b, TestcordDevs.dot, TestcordDevs.sirphantom89, TestcordDevs.hyyven],
    tags: ["Privacy", "Utility", "Voice"],
    dependencies: ["CommandsAPI", "UserAreaAPI"],
    enabledByDefault: false,
    settings,
    contextMenus: {
        "channel-context": VoiceChannelContext,
        "audio-device-context": AudioDeviceContext,
        "video-device-context": VideoDeviceContext
    },
    userAreaButton: {
        icon: (props: { className?: string; }) => <Icon {...props} enabled={faked} />,
        render: FakeVoiceOptionToggleButton
    },
    patches: [
        {
            find: "}voiceStateUpdate(",
            noWarn: true,
            replacement: {
                match: /self_mute:([^,]+),self_deaf:([^,]+),self_video:([^,]+)/,
                replace: "self_mute:$self.toggle($1,'fakeMute'),self_deaf:$self.toggle($2,'fakeDeafen'),self_video:$self.toggle($3,'fakeCam')"
            }
        },
        {
            find: "OPEN_EMBEDDED_ACTIVITY,{location:",
            noWarn: true,
            replacement: {
                match: /\i\._\.dispatch\(\i\.\i\.OPEN_EMBEDDED_ACTIVITY,\{location:\i,applicationId:\i,/,
                replace: "$self.shouldOpenEmbeddedActivity()&&$&"
            }
        },
        {
            find: "handleOpenActivityPopout",
            noWarn: true,
            replacement: {
                match: /\i\.open\(\i\.\i\.ACTIVITY_POPOUT,.{0,80}?defaultHeight:480\}\)/,
                replace: "$self.shouldOpenEmbeddedActivity()&&$&"
            }
        },
        {
            find: "CAMERA_PREVIEW]:",
            noWarn: true,
            replacement: {
                match: /d\.set\(\i,\i\),(\i)===(\i\.\i)\.VIDEO.{0,100}?\2\.HAVEN&&null==\i&&\(\i=\i\)/,
                replace: "(($1!==$2.ACTIVITY||$self.shouldOpenEmbeddedActivity())&&($1!==$2.VIDEO||$self.shouldOpenStreamPip()))&&($&)",
                noWarn: true
            }
        },
    ],
    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const myId = UserStore.getCurrentUser().id;
            const selected = SelectedChannelStore.getVoiceChannelId();
            if (!selected) return;
            const channel = ChannelStore.getChannel(selected);
            const myVoiceState = voiceStates.find(state => state.userId === myId && state.channelId === selected);

            scheduleMicCutoffSync(faked);

            if (settings.store.fakeGame && faked && myVoiceState && canUseFakeActivity(channel) && !hasFakeActivity(selected)) {
                void startActivity(selected);
            }

            if (settings.store.fakeStream && faked && myVoiceState && PermissionStore.can(STREAM, channel)) {
                fakeStreamActive = true;

                if (!hasFakeStream()) {
                    startStreamAction(channel.guild_id, selected, {
                        pid: null,
                        sourceId: null,
                        sourceName: null,
                        audioSourceId: null,
                        sound: false,
                        previewDisabled: true
                    });
                }
            }
        }
    },
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fakemute",
            description: "Toggle Fake Mute",
            execute: async (_, ctx) => {
                settings.store.fakeMute = !settings.store.fakeMute;
                applyAndSync();
                sendBotMessage(ctx.channel.id, { content: `👻 **Fake Mute** is ${settings.store.fakeMute ? "enabled" : "disabled"}.` });
            },
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fakedeafen",
            description: "Toggle Fake Deafen",
            execute: async (_, ctx) => {
                settings.store.fakeDeafen = !settings.store.fakeDeafen;
                applyAutoMute();
                applyAndSync();
                sendBotMessage(ctx.channel.id, { content: `👻 **Fake Deafen** is ${settings.store.fakeDeafen ? "enabled" : "disabled"}.` });
            },
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fakedeafen_mute",
            description: "Toggle Fake Deafen & Mute simultaneously",
            execute: async (_, ctx) => {
                const next = !(settings.store.fakeMute && settings.store.fakeDeafen);
                settings.store.fakeMute = next;
                settings.store.fakeDeafen = next;
                applyAndSync();
                sendBotMessage(ctx.channel.id, { content: `👻 **Fake Deafen & Mute** are ${next ? "enabled" : "disabled"}.` });
            },
        },
    ],
    FakeVoiceOptionToggleButton: ErrorBoundary.wrap(FakeVoiceOptionToggleButton, { noop: true }),
    start() {
        // Patch the raw gateway socket.send so every op-4 (voice state update) gets
        // the faked fields stamped on while `faked` is active — same mechanism as
        // fakeMuteDeafen. This is the reliable path: it does not depend on the
        // voiceStateSender module lookup that the old syncFakeVoiceState used.
        const socket = wsModule?.getSocket?.();
        if (socket && !originalSocketSend) {
            originalSocketSend = socket.send;
            socket.send = function (op: number, data: any, ...args: any[]) {
                if (op === 4 && data && faked) {
                    if (settings.store.fakeMute) data.self_mute = true;
                    if (settings.store.fakeDeafen) data.self_deaf = true;
                    if (settings.store.fakeCam) data.self_video = true;
                }
                return originalSocketSend.apply(this, [op, data, ...args]);
            };
        }
        document.addEventListener("keydown", handleKeydown);
    },
    stop() {
        const socket = wsModule?.getSocket?.();
        if (socket && originalSocketSend) {
            socket.send = originalSocketSend;
            originalSocketSend = undefined;
        }
        document.removeEventListener("keydown", handleKeydown);
        setFakeVoiceEnabled(false);
    },
    shouldOpenEmbeddedActivity: () => !(faked && settings.store.fakeGame),
    shouldOpenStreamPip: () => !(faked && fakeStreamActive),
    toggle: (value: boolean, key: keyof typeof settings.store) => (faked ? settings.store[key] : value)
});
