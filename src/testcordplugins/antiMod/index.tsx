/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Guild, GuildMember } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { FluxDispatcher, GuildMemberStore,GuildStore, Toasts, UserStore } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");

const alarm = "https://www.myinstants.com/media/sounds/tmp_7901-951678082.mp3";
let audioElement: HTMLAudioElement | null = null;

export default definePlugin({
    name: "antiMod",
    description: "Tools to avoid mods",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.dot],
    start() { FluxDispatcher.subscribe("VOICE_STATE_UPDATES", cb); },
    stop() { FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", cb); }
});

const avoidPermission: bigint[] = [
    (BigInt(1) << 3n),
    (BigInt(1) << 2n),
    (BigInt(1) << 1n),
    (BigInt(1) << 24n),
    (BigInt(1) << 22n),
    (BigInt(1) << 23n),
    (BigInt(1) << 7n),
    (BigInt(1) << 5n),
    (BigInt(1) << 28n),
    (BigInt(1) << 40n),
    (BigInt(1) << 4n),
];

const cb = async (e: any) => {
    const state = e.voiceStates[0];
    if (!state?.channelId) return;
    if (state.userId === UserStore.getCurrentUser().id || !state.userId) return;
    if (state?.channelId === state?.oldChannelId) return;

    const channelVoiceStates = VoiceStateStore.getVoiceStatesForChannel(state?.channelId) ?? {};
    if (!Object.prototype.hasOwnProperty.call(channelVoiceStates, UserStore.getCurrentUser().id)) return;
    const member = GuildMemberStore.getMember(state.guildId, state.userId!);
    if (!member) return;

    const roles = getSortedRoles(GuildStore.getGuild(state.guildId), member)
        .map(role => ({
            type: 0,
            ...role
        }));
    for (const role of roles) {
        for (const permission of avoidPermission) {
            if ((role.permissions & permission) === permission) {
                Toasts.show({
                    message: `MOD ALERT  ${state.userId} detected`,
                    id: "Vc-permissions",
                    type: Toasts.Type.FAILURE,
                    options: {
                        position: Toasts.Position.BOTTOM,
                    }
                });
                audio();

                break;
            }
        }
    }

};

function getSortedRoles({ id }: Guild, member: GuildMember) {
    // @ts-expect-error Discord API changed
    const roles = GuildStore.getRoles(id);

    return [...member.roles, id]
        .map(id => roles[id])
        .sort((a, b) => b.position - a.position);
}

function audio() {
    if (!audioElement) {
        audioElement = document.createElement("audio");
        audioElement.src = alarm;
        audioElement.volume = 1;
    }
    audioElement.currentTime = 0;
    audioElement.play().catch(() => {});
}
