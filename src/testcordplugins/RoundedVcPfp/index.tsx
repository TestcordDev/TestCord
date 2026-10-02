/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import { getUserAvatarUrl } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelRTCStore, ChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import style from "./style.css?managed";

const settings = definePluginSettings({
    cornerRadius: {
        type: OptionType.SLIDER,
        description: "Tile corner rounding in pixels. 0 is flat like FullVCPFP; 12 is a clean, visible round.",
        markers: [0, 4, 8, 12, 16, 20, 24],
        default: 12,
        stickToMarkers: false
    }
});

export default definePlugin({
    name: "RoundedVCPFP",
    description: "Fork of FullVCPFP: fills the vc tile with the full-size avatar, with lightly rounded corners instead of square ones",
    tags: ["Appearance", "Voice"],
    authors: [EquicordDevs.mochienya, TestcordDevs.DavidHiFi],
    settings,
    managedStyle: style,
    patches: [
        {
            find: "\"data-selenium-video-tile\":",
            replacement: {
                match: /(?<=function\((\i),\i\)\{)/,
                replace: "Object.assign($1.style=$1.style||{},$self.getVoiceBackgroundStyles($1));",
            }
        },
    ],

    getVoiceBackgroundStyles({ participantUserId }: { className?: string; participantUserId?: string; }) {
        if (!participantUserId) return;

        const user = UserStore.getUser(participantUserId);
        if (!user) return;

        const channelId = VoiceStateStore.getVoiceStateForUser(participantUserId)?.channelId;
        const guildId = channelId ? ChannelStore.getChannel(channelId)?.guild_id : undefined;
        const isSpeaking = channelId
            ? ChannelRTCStore.getSpeakingParticipants(channelId).some(p => p.user.id === participantUserId && p.speaking)
            : false;

        // Fallback chain from the local FullVCPFP fix: getUserAvatarUrl's guild
        // branch can return undefined, which used to render blank tiles.
        const avatarUrl = getUserAvatarUrl(user, guildId, isSpeaking, 1024)
            || user.getAvatarURL?.(guildId, 1024, isSpeaking)
            || user.getAvatarURL?.(undefined, 1024, isSpeaking)
            || ("getDefaultAvatarURL" in user && typeof user.getDefaultAvatarURL === "function" ? user.getDefaultAvatarURL() : undefined)
            || "https://cdn.discordapp.com/embed/avatars/0.png";

        return {
            "--full-res-avatar": `url("${avatarUrl}")`,
            "--vc-pfp-radius": `${settings.store.cornerRadius}px`
        };
    },
});
