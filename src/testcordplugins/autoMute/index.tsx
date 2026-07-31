/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { debounce } from "@shared/debounce";
import { TestcordDevs } from "@utils/constants";
import { humanFriendlyJoin } from "@utils/text";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, Menu, RelationshipStore, SelectedChannelStore, Toasts, UserStore } from "@webpack/common";

function clearableDebounce(func: Function, delay: number) {
    let timeout: NodeJS.Timeout;
    const debounced = (...args: any[]) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), delay);
    };
    const cancel = () => clearTimeout(timeout);
    return [debounced, cancel];
}

const { toggleSelfMute } = findByPropsLazy("toggleSelfMute");

// We cannot destructure isSelfMute as it depends on isEnabled
const MediaEngineStore = findStoreLazy("MediaEngineStore");

const VoiceStateStore = findStoreLazy("VoiceStateStore");

interface SpeakingState {
    speakingFlags: number,
    type: string,
    userId: string;
}

const enum SpeakingFlagsMask {
    VOICE = 1 << 0,
    SOUNDSHARE = 1 << 1,
    PRIORITY = 1 << 2
}

interface VoiceState {
    guildId?: string;
    channelId?: string;
    oldChannelId?: string;
    user: User;
    userId: string;
}

const enum AutoMuteReasons {
    Inactivity = "You have been silent for a while, so your mic has been automatically muted.",
    NonFriend = "[USER] who isn't your friend has joined your voice channel, so your mic has been automatically muted."
}

let [setAutoMute, cancelAutoMute] = [() => { }, () => { }];

function updateTimeout(seconds: number) {
    cancelAutoMute();
    [setAutoMute, cancelAutoMute] = clearableDebounce(() => autoMute(AutoMuteReasons.Inactivity), seconds * 1000);
    updateAutoMute();
}

const settings = definePluginSettings({
    isEnabled: {
        type: OptionType.BOOLEAN,
        description: "Whether the plugin will automatically mute you after being silent for too long or not",
        default: true,
        onChange() {
            updateAutoMute();
        }
    },
    timeout: {
        description: "Inactivity timeout (seconds)",
        type: OptionType.SLIDER,
        markers: [15, ...makeRange(60, 900, 60)],
        default: 300,
        stickToMarkers: false,
        onChange(value) {
            updateTimeout(value);
        },
    },
    nonFriendJoinsChannel: {
        type: OptionType.BOOLEAN,
        description: "Whether the plugin will automatically mute you when someone who isn't you friend joins your voice channel",
        default: true
    }
});

const AUTO_MUTE_KEYS = ["isEnabled", "timeout", "nonFriendJoinsChannel"];

const AudioDeviceContextMenuPatch: NavContextMenuPatchCallback = (children, props: { renderInputVolume?: boolean; }) => {
    const { isEnabled } = settings.store;
    const { timeout } = settings.store;
    const { nonFriendJoinsChannel } = settings.store;

    if ("renderInputVolume" in props) {
        children.splice(children.length - 1, 0,
            <Menu.MenuGroup
                label="Auto Mute"
            >
                <Menu.MenuCheckboxItem
                    checked={isEnabled}
                    id="vc-auto-mute-toggle"
                    label="Mute after inactivity"
                    action={() => {
                        settings.store.isEnabled = !isEnabled;
                        updateAutoMute();
                    }}
                />
                <Menu.MenuControlItem
                    id="vc-auto-mute-timeout"
                    label="Inactivity Timeout"
                    control={(props, ref) => (
                        <Menu.MenuSliderControl
                            {...props}
                            ref={ref}
                            minValue={15}
                            maxValue={900}
                            value={timeout}
                            onChange={debounce((rawValue: number) => {
                                const value = Math.round(rawValue);
                                settings.store.timeout = value;
                                updateTimeout(value);
                            }, 10)}
                            renderValue={(value: number) => {
                                const minutes = Math.floor(value / 60);
                                const seconds = Math.round(value % 60);
                                return [
                                    minutes,
                                    `${seconds < 10 ? "0" + seconds : seconds}${minutes ? "" : "s"}`
                                ].filter(Boolean).join(":");
                            }}
                        />
                    )}
                />
                <Menu.MenuCheckboxItem
                    checked={nonFriendJoinsChannel}
                    id="vc-auto-mute-non-friends"
                    label="Mute when non-friend joins"
                    action={() => {
                        settings.store.nonFriendJoinsChannel = !nonFriendJoinsChannel;
                        updateAutoMute();
                    }}
                />
            </Menu.MenuGroup>
        );
    }
};

let isSpeaking = false;

function updateAutoMute() {
    if (!settings.store.isEnabled) return cancelAutoMute();
    if (!SelectedChannelStore.getVoiceChannelId()) return cancelAutoMute();
    isSpeaking ? cancelAutoMute() : setAutoMute();
}

function autoMute(reason: string) {
    if (!MediaEngineStore.isSelfMute() && SelectedChannelStore.getVoiceChannelId()) {
        toggleSelfMute();
        Toasts.show({
            message: reason,
            type: Toasts.Type.MESSAGE,
            id: Toasts.genId(),
            options: {
                duration: 3500,
                position: Toasts.Position.TOP
            }
        });
    }
}

// Blatantly stolen from VcNarrator plugin

// For every user, channelId and oldChannelId will differ when moving channel.
// Only for the local user, channelId and oldChannelId will be the same when moving channel,
// for some ungodly reason
let clientOldChannelId: string | undefined;

const trustedUsers = new Set<string>();
function isTrusted(userId: string) {
    return trustedUsers.has(userId) ||
        RelationshipStore.isFriend(userId) ||
        UserStore.getCurrentUser().id === userId ||
        UserStore.getUser(userId).bot;
}
function trustEveryone() {
    const allVoiceStates: VoiceState[] = Object.values(VoiceStateStore.getVoiceStatesForChannel(SelectedChannelStore.getVoiceChannelId()));
    allVoiceStates.forEach(({ userId }) => {
        trustedUsers.add(userId);
    });
}

export default definePlugin({
    name: "AutoMute",
    description: "Automatically mute yourself in voice channels if you're not speaking for too long, or if someone who isn't a friend joins.",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    flux: {
        SPEAKING(s: SpeakingState) {
            if (s.userId !== UserStore.getCurrentUser().id) return;
            isSpeaking = (s.speakingFlags & SpeakingFlagsMask.VOICE) === 1;
            isSpeaking ? cancelAutoMute() : setAutoMute();
        },
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            // Blatantly stolen from my other unfinished plugin
            if (!voiceStates) return;
            // flags for non friend mute
            let movingChannel = false;
            let clearTrustedUsers = false;

            voiceStates.forEach(state => {
                if (state.userId !== UserStore.getCurrentUser().id) return;
                const { channelId } = state;
                let { oldChannelId } = state;
                if (channelId !== clientOldChannelId) {
                    oldChannelId = clientOldChannelId;
                    clientOldChannelId = channelId;
                    movingChannel = true;
                }

                if (!oldChannelId && channelId) {
                    updateAutoMute();
                    movingChannel = true;
                }
                if (oldChannelId && !channelId) {
                    cancelAutoMute();
                    isSpeaking = false;
                    trustedUsers.clear();
                    clearTrustedUsers = false;
                }
            });

            const allVoiceStates: VoiceState[] = Object.values(VoiceStateStore.getVoiceStatesForChannel(SelectedChannelStore.getVoiceChannelId()));
            const untrustedUsers = new Set<string>();
            if (!clearTrustedUsers) allVoiceStates.forEach(({ userId }) => {
                if (movingChannel) {
                    if (!MediaEngineStore.isSelfMute()) trustedUsers.add(userId);
                } else {
                    if (!isTrusted(userId)) {
                        untrustedUsers.add(userId);
                    }
                }
            });
            if (untrustedUsers.size && settings.store.nonFriendJoinsChannel) {
                const guildId = ChannelStore.getChannel(SelectedChannelStore.getVoiceChannelId()!).getGuildId();
                const users = [...untrustedUsers].map(userId => {
                    const user = UserStore.getUser(userId);
                    return GuildMemberStore.getNick(guildId, userId) ?? (user as any).globalName ?? user.username;
                });
                autoMute(AutoMuteReasons.NonFriend.replaceAll("[USER]", humanFriendlyJoin(users)));
            }
        },
        AUDIO_TOGGLE_SELF_MUTE() {
            updateAutoMute();
            if (!MediaEngineStore.isSelfMute()) trustEveryone();
        },
        AUDIO_TOGGLE_SELF_DEAF() {
            updateAutoMute();
        },
        AUDIO_TOGGLE_SET_MUTE() {
            updateAutoMute();
            if (!MediaEngineStore.isSelfMute()) trustEveryone();
        },
        AUDIO_TOGGLE_SET_DEAF() {
            updateAutoMute();
        },
    },
    contextMenus: {
        "audio-device-context": AudioDeviceContextMenuPatch
    },
    start() {
        updateTimeout(settings.store.timeout);
    },
    stop() {
        cancelAutoMute();
    },
    trustedUsers
});
