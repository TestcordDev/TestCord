/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps, findByPropsLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, React, UserStore, useStateFromStores } from "@webpack/common";

const StreamStore = findByPropsLazy("getActiveStreamForUser", "getAllActiveStreams");
const RTCConnectionStore = findByPropsLazy("getMediaSessionId");
const StreamerModeStore = findByPropsLazy("hidePersonalInformation");

const settings = definePluginSettings({
    hideGroups: {
        type: OptionType.BOOLEAN,
        description: "Hide Group DMs too while streaming",
        default: false
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug Mode - Shows detailed logs in the console",
        default: false
    }
});

let originalNotification: any = null;
let originalPlaySound: any = null;
let originalShowNotification: any = null;
let originalMakeTextNotification: any = null;

function isStreaming(): boolean {
    try {
        if (StreamerModeStore?.hidePersonalInformation) {
            return true;
        }

        const currentUser = UserStore?.getCurrentUser?.();
        if (!currentUser) return false;

        const userStream = StreamStore?.getActiveStreamForUser?.(currentUser.id);
        if (userStream) {
            if (settings.store.debugMode) console.log("[NoDMWhileStreaming] [DEBUG] Stream detected via getActiveStreamForUser", userStream);
            return true;
        }

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
        console.error("[NoDMWhileStreaming] Error during stream check:", e);
        return false;
    }
}

export default definePlugin({
    name: "NoDMWhileStreaming",
    description: "Hides DM and Group DM notifications and sidebar items while you are streaming",
    authors: [{ name: "Unknown", id: 0n }],
    tags: ["Appearance", "Utility", "Privacy"],
    enabledByDefault: false,
    settings,
    patches: [
        // Filters DMs (type 1) and Group DMs (type 3) from the private channel list
        {
            find: '"dm-quick-launcher"===',
            replacement: {
                match: /privateChannelIds:([^,]+)(?=,listRef:)/,
                replace: "privateChannelIds:$self.filterChannels($1)"
            }
        },
        // Reactive hook to force re-render when stream status changes
        {
            find: ".FRIENDS},\"friends\"",
            replacement: {
                match: /let{showLibrary:\i,/,
                replace: "$self.useStreamStatus();$&"
            }
        }
    ],

    // Flux events — intercept MESSAGE_CREATE to auto-ack DMs/Groups during stream
    flux: {
        MESSAGE_CREATE(event: any) {
            if (!isStreaming()) return;

            const message = event?.message;
            if (!message) return;

            const channel = ChannelStore?.getChannel?.(message.channel_id);
            if (!channel) return;

            // Type 1 = Private DM, Type 3 = Group DM
            const isDM = channel.type === 1;
            const isGroup = channel.type === 3 && settings.store.hideGroups;

            if (!isDM && !isGroup) return;

            // Suppress desktop notification & alert sound at the Flux event level!
            event.isPushNotification = false;
            event.optimistic = false;
            event.silent = true;
            if (event.message) {
                event.message.flags = (event.message.flags || 0) | 4096; // 4096 = EPHEMERAL/SILENT
            }

            // Do not ack own messages
            const currentUser = UserStore?.getCurrentUser?.();
            if (currentUser && message.author?.id === currentUser.id) return;

            if (settings.store.debugMode) {
                console.log(`[NoDMWhileStreaming] [ACK] Auto-ack message from ${message.author?.username} in channel ${message.channel_id}`);
            }

            // Mark the channel as read. Must be in a queueMicrotask to prevent Flux dispatch collision synchronously
            // but process it before the browser repaints the next frame (instant clean)!
            queueMicrotask(() => {
                try {
                    FluxDispatcher.dispatch({
                        type: "BULK_ACK",
                        context: "APP",
                        channels: [{
                            channelId: channel.id,
                            messageId: message.id, // Use the new message ID directly to clear it instantly
                            readStateType: 0
                        }]
                    });
                } catch (e) {
                    if (settings.store.debugMode) {
                        console.error("[NoDMWhileStreaming] Error during ack:", e);
                    }
                }
            });
        }
    },

    useStreamStatus() {
        const streaming = useStateFromStores([StreamerModeStore, StreamStore], () => isStreaming());
        React.useEffect(() => {
            if (streaming) {
                document.body.classList.add("no-dm-while-streaming-active");
            } else {
                document.body.classList.remove("no-dm-while-streaming-active");
            }
        }, [streaming]);
    },

    filterChannels(ids: string[]) {
        const streaming = isStreaming();
        if (settings.store.debugMode) {
            console.log(`[NoDMWhileStreaming] [DEBUG] 🎨 filterChannels called. IDs count: ${ids?.length}, Streaming: ${streaming}`);
        }
        if (!streaming) return ids;

        const filtered = ids.filter((id: string) => {
            const type = ChannelStore?.getChannel?.(id)?.type;
            if (type === 1) return false;
            if (type === 3 && settings.store.hideGroups) return false;
            return true;
        });

        if (settings.store.debugMode) {
            console.log(`[NoDMWhileStreaming] [DEBUG] 🎨 filterChannels filtered. Remaining: ${filtered.length}`);
        }

        // If streaming and filtered is empty, but we had original DMs,
        // return [ids[0]] so that privateChannelIds is non-empty.
        // This keeps the "Direct Messages" header rendering, and our CSS hides this single item!
        if (filtered.length === 0 && ids.length > 0) {
            return [ids[0]];
        }

        return filtered;
    },

    start() {
        if (settings.store.debugMode) console.log("[NoDMWhileStreaming] Plugin started");

        // Patch window.Notification to block desktop notifications while streaming
        if (typeof window !== "undefined" && window.Notification) {
            originalNotification = window.Notification;
            try {
                // @ts-ignore
                window.Notification = function (title: string, options: any) {
                    if (isStreaming()) {
                        if (settings.store.debugMode) {
                            console.log("[NoDMWhileStreaming] [Notification] Blocked desktop notification:", title);
                        }
                        return {
                            close() { },
                            onclick: null,
                            onclose: null,
                            onerror: null,
                            onshow: null,
                        };
                    }
                    return new originalNotification(title, options);
                };
                // Copy properties to maintain compatibility
                window.Notification.prototype = originalNotification.prototype;
                (window.Notification as any).permission = originalNotification.permission;
                window.Notification.requestPermission = originalNotification.requestPermission;
            } catch (e) {
                console.error("[NoDMWhileStreaming] Failed to patch window.Notification:", e);
            }
        }

        // Patch playSound to block message sounds while streaming
        try {
            const soundModule = findByProps("playSound", "createSound");
            if (soundModule) {
                originalPlaySound = soundModule.playSound;
                soundModule.playSound = function (soundName: string, ...args: any[]) {
                    if (isStreaming() && soundName === "message") {
                        if (settings.store.debugMode) {
                            console.log("[NoDMWhileStreaming] [Sound] Blocked message notification sound");
                        }
                        return;
                    }
                    return originalPlaySound.call(soundModule, soundName, ...args);
                };
            }
        } catch (e) {
            console.error("[NoDMWhileStreaming] Failed to patch soundModule:", e);
        }

        // Patch Discord's internal notification actions to fully prevent in-app/desktop notification creation
        try {
            const notificationActions = findByProps("showNotification");
            if (notificationActions) {
                if (notificationActions.showNotification) {
                    originalShowNotification = notificationActions.showNotification;
                    notificationActions.showNotification = function (channelId: string, ...args: any[]) {
                        if (isStreaming()) {
                            const channel = ChannelStore?.getChannel?.(channelId);
                            if (channel) {
                                const isDM = channel.type === 1;
                                const isGroup = channel.type === 3 && settings.store.hideGroups;
                                if (isDM || isGroup) {
                                    if (settings.store.debugMode) {
                                        console.log("[NoDMWhileStreaming] [Notification] Blocked native showNotification for channel:", channelId);
                                    }
                                    return;
                                }
                            }
                        }
                        return originalShowNotification.call(notificationActions, channelId, ...args);
                    };
                }

                if (notificationActions.makeTextNotification) {
                    originalMakeTextNotification = notificationActions.makeTextNotification;
                    notificationActions.makeTextNotification = function (channel: any, ...args: any[]) {
                        if (isStreaming()) {
                            const isDM = channel?.type === 1;
                            const isGroup = channel?.type === 3 && settings.store.hideGroups;
                            if (isDM || isGroup) {
                                if (settings.store.debugMode) {
                                    console.log("[NoDMWhileStreaming] [Notification] Blocked native makeTextNotification");
                                }
                                return;
                            }
                        }
                        return originalMakeTextNotification.call(notificationActions, channel, ...args);
                    };
                }
            }
        } catch (e) {
            console.error("[NoDMWhileStreaming] Failed to patch native notificationActions:", e);
        }
    },

    stop() {
        if (settings.store.debugMode) console.log("[NoDMWhileStreaming] Plugin stopped");

        // Restore window.Notification
        if (originalNotification && typeof window !== "undefined") {
            try {
                window.Notification = originalNotification;
            } catch (e) {
                console.error("[NoDMWhileStreaming] Failed to restore window.Notification:", e);
            }
            originalNotification = null;
        }

        // Restore playSound
        if (originalPlaySound) {
            try {
                const soundModule = findByProps("playSound", "createSound");
                if (soundModule) {
                    soundModule.playSound = originalPlaySound;
                }
            } catch (e) {
                console.error("[NoDMWhileStreaming] Failed to restore soundModule:", e);
            }
            originalPlaySound = null;
        }

        // Restore notificationActions
        try {
            const notificationActions = findByProps("showNotification");
            if (notificationActions) {
                if (originalShowNotification && notificationActions.showNotification) {
                    notificationActions.showNotification = originalShowNotification;
                }
                if (originalMakeTextNotification && notificationActions.makeTextNotification) {
                    notificationActions.makeTextNotification = originalMakeTextNotification;
                }
            }
        } catch (e) {
            console.error("[NoDMWhileStreaming] Failed to restore notificationActions:", e);
        }
        originalShowNotification = null;
        originalMakeTextNotification = null;
    }
});
