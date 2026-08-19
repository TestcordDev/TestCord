/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, RestAPI, Toasts, UserStore } from "@webpack/common";
// @ts-ignore
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const vc = findByPropsLazy("getVoiceChannelId");
const trackedmfs = [];
const friendststore = findStoreLazy("RelationshipStore");
const settings = definePluginSettings({
    enablenormalkeybinds: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "enable normal key binds (if streamer mode is not on at the method)",
        default: true,
    },
});
function keybind2(e) {
    if (settings.store.enablenormalkeybinds === false)
        return;
    if (!Vencord.Plugins.plugins.vcOwnerDetector.settings.store.amivcowner) {
        Toasts.show({
            message: "you're not the vc owner  also u gotta be in a vc to do this",
            id: "cutelittlemessage",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        return;
    }
    if (e.altKey && e.key.toLowerCase() === "s") {
        const cChannelId = vc.getVoiceChannelId();
        if (cChannelId) {
            const cChannel = ChannelStore.getChannel(cChannelId);
            if (cChannel) {
                const mftokick = trackedmfs[trackedmfs.length - 1] ?? "";
                if (mftokick && friendststore.getFriendIDs().includes(mftokick)) {
                    trackedmfs.splice(trackedmfs.indexOf(mftokick), 1);
                    Toasts.show({
                        message: "this person is on your friends list (skipping)",
                        id: "recent-ban-friend",
                        type: Toasts.Type.FAILURE,
                        options: {
                            position: Toasts.Position.BOTTOM
                        }
                    });
                    return;
                }
                if (mftokick) {
                    Toasts.show({
                        message: "should be kicking the first person on the list now ",
                        id: "recent-kick",
                        type: Toasts.Type.FAILURE,
                        options: {
                            position: Toasts.Position.BOTTOM
                        }
                    });
                    RestAPI.post({
                        url: `/channels/${cChannelId}/messages`,
                        body: { content: `!voice-kick ${mftokick}`, nonce: Math.floor(Math.random() * 10000000000000) }
                    }).then(() => {
                        trackedmfs.splice(trackedmfs.indexOf(mftokick), 1);
                    });
                }
            }
        }
    }
}
function keybind(e) {
    if (settings.store.enablenormalkeybinds === false)
        return;
    if (!Vencord.Plugins.plugins.vcOwnerDetector.settings.store.amivcowner) {
        Toasts.show({
            message: "you're not the vc owner",
            id: "cutelittlemessage",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        return;
    }
    if (e.altKey && e.key.toLowerCase() === "z") {
        const cChannelId = vc.getVoiceChannelId();
        if (cChannelId) {
            const cChannel = ChannelStore.getChannel(cChannelId);
            if (cChannel) {
                const mftoban = trackedmfs.pop() ?? "";
                if (mftoban && friendststore.getFriendIDs().includes(mftoban)) {
                    trackedmfs.splice(trackedmfs.indexOf(mftoban), 1);
                    Toasts.show({
                        message: "this person is on your friends list (skipping) ",
                        id: "recent-ban-friend",
                        type: Toasts.Type.FAILURE,
                        options: {
                            position: Toasts.Position.BOTTOM
                        }
                    });
                    return;
                }
                if (mftoban) {
                    Toasts.show({
                        message: "should be banning the first person on the list now ",
                        id: "recent-ban",
                        type: Toasts.Type.FAILURE,
                        options: {
                            position: Toasts.Position.BOTTOM
                        }
                    });
                    RestAPI.post({
                        url: `/channels/${cChannelId}/messages`,
                        body: { content: `!voice-ban ${mftoban}`, nonce: Math.floor(Math.random() * 10000000000000) }
                    }).then(() => {
                        trackedmfs.splice(trackedmfs.indexOf(mftoban), 1);
                    });
                }
            }
        }
    }
}
const MAX_TRACKED = 200;
const cb = async (e) => {
    const state = e.voiceStates[0];
    if (!state?.channelId)
        return;
    if (state.userId === UserStore.getCurrentUser().id || !state.userId)
        return;
    if (state?.channelId === state?.oldChannelId)
        return;
    const Cvcstates = VoiceStateStore.getVoiceStatesForChannel(state?.channelId) ?? {};
    if (!Object.keys(Cvcstates).includes(UserStore.getCurrentUser().id))
        return;
    trackedmfs.push(state.userId);
    // Cap growth: drop oldest entries (front of the stack) once over the limit
    while (trackedmfs.length > MAX_TRACKED)
        trackedmfs.shift();
};
const good = async (e) => {
    if (settings.store.enablenormalkeybinds === true)
        return;
    if (!Vencord.Plugins.plugins.vcOwnerDetector.settings.store.amivcowner) {
        Toasts.show({
            message: "you're not the vc owner ",
            id: "cutelittlemessage",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        return;
    }
    const Cvcstates = VoiceStateStore.getVoiceStatesForChannel(vc.getVoiceChannelId()) ?? {};
    if (!Object.keys(Cvcstates).includes(UserStore.getCurrentUser().id))
        return;
    const cChannelId = vc.getVoiceChannelId();
    if (cChannelId) {
        const cChannel = ChannelStore.getChannel(cChannelId);
        if (cChannel) {
            const mftoban = trackedmfs.pop() ?? "";
            if (mftoban && friendststore.getFriendIDs().includes(mftoban)) {
                trackedmfs.splice(trackedmfs.indexOf(mftoban), 1);
                Toasts.show({
                    message: "this person is on your friends list (skipping) ",
                    id: "recent-ban-friend",
                    type: Toasts.Type.FAILURE,
                    options: {
                        position: Toasts.Position.BOTTOM
                    }
                });
                return;
            }
            if (mftoban) {
                console.log("trying to ban first person on list (streamer mode method)");
                Toasts.show({
                    message: "should be banning the first person on the list now (streamer mode method)",
                    id: "recent-ban",
                    type: Toasts.Type.FAILURE,
                    options: {
                        position: Toasts.Position.BOTTOM
                    }
                });
                RestAPI.post({
                    url: `/channels/${cChannelId}/messages`,
                    body: { content: `!voice-ban ${mftoban}`, nonce: Math.floor(Math.random() * 10000000000000) }
                }).then(() => {
                    trackedmfs.splice(trackedmfs.indexOf(mftoban), 1);
                });
            }
        }
    }
};
export default definePlugin({
    name: "recentBan",
    description: "Tools to ban recently joined VC users (only if owner)",
    tags: ["Servers", "Utility"],
    authors: [TestcordDevs.dot],
    settings,
    start() {
        document.addEventListener("keydown", keybind);
        document.addEventListener("keydown", keybind2);
        FluxDispatcher.subscribe("STREAMER_MODE_UPDATE", good);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", cb);
    },
    stop() {
        document.removeEventListener("keydown", keybind);
        document.removeEventListener("keydown", keybind2);
        FluxDispatcher.unsubscribe("STREAMER_MODE_UPDATE", good);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", cb);
        trackedmfs.length = 0;
    },
});
