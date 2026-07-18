/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import { fetchUserProfile } from "@utils/discord";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { UserProfileActions, UserProfileStore } from "@webpack/common";

import settings from "./settings";
import { RelationshipStore } from "./stores";

const { getBlockedUsersForVoiceChannel, getIgnoredUsersForVoiceChannel } = findByPropsLazy("getBlockedUsersForVoiceChannel", "getIgnoredUsersForVoiceChannel");
const pendingProfileFetches = new Set<string>();

export default definePlugin({
    name: "BypassBlockedOrIgnored",
    description: "Bypass the blocked or ignored user modal if is present in voice channels.",
    tags: ["Utility", "Privacy"],
    authors: [{
        name: "nicola02nb",
        id: 257900031351193600n
    }, TestcordDevs.x2b],
    settings,
    patches: [
        {
            find: "async handleVoiceConnect(",
            replacement: {
                match: /async handleVoiceConnect\((\i)\){/,
                replace: "async handleVoiceConnect($1){$self.handleVoiceConnect($1);"
            }
        },
        {
            find: "user-profile-sidebar-heading-",
            replacement: {
                match: /null==(\i)\|\|null==(\i)(\?null:)/,
                replace: "null==$1||null==$2||$self.shouldShowBlockedProfilesFor($1.id)$3"
            }
        },
        {
            find: "handleBlockedOrIgnoredUserVoiceChannelJoin",
            replacement: {
                match: /handleBlockedOrIgnoredUserVoiceChannelJoin\(\i,\i\)\{/,
                replace: "$&if($self.handleBlockedOrIgnoredUserVoiceChannelJoin(arguments[0],arguments[1]))return;"
            }
        }
    ],
    start: () => {
    },
    stop: () => {
    },

    handleVoiceConnect(...args) {
        if (!settings.store.bypassWhenJoining) return;

        const channelId = args[0].channel.id;
        args[0].bypassBlockedWarningModal = this.shouldBypass(channelId);
    },

    handleBlockedOrIgnoredUserVoiceChannelJoin(...args) {
        if (!settings.store.bypassWhenUserJoins) return;

        const userId = args[1];

        if (settings.store.bypassIgnoredUsersModal && RelationshipStore.isIgnored(userId)
            || settings.store.bypassBlockedUsersModal && RelationshipStore.isBlocked(userId)) {
            return true;
        }
    },

    shouldBypass(channelId) {
        const shouldBypassBlocked = settings.store.bypassBlockedUsersModal;
        const hasBlockedUsers = getBlockedUsersForVoiceChannel(channelId).size;
        const shouldBypassIgnored = settings.store.bypassIgnoredUsersModal;
        const hasIgnoredUsers = getIgnoredUsersForVoiceChannel(channelId).size;

        return shouldBypassBlocked && hasBlockedUsers && shouldBypassIgnored
            || !hasBlockedUsers && shouldBypassIgnored && hasIgnoredUsers
            || shouldBypassBlocked && hasBlockedUsers && !hasIgnoredUsers;
    },

    shouldShowBlockedProfiles() {
        return settings.store.alwaysShowBlockedProfiles;
    },

    shouldShowBlockedProfilesFor(userId) {
        const shouldShow = settings.store.alwaysShowBlockedProfiles && RelationshipStore.isBlocked(userId);
        if (shouldShow) this.fetchBlockedProfile(userId);

        return shouldShow;
    },

    fetchBlockedProfile(userId) {
        if (pendingProfileFetches.has(userId) || UserProfileStore.getUserProfile(userId) != null) return;

        pendingProfileFetches.add(userId);
        void fetchUserProfile(userId)
            .catch(() => null)
            .finally(() => pendingProfileFetches.delete(userId));
    },

    openBlockedProfile(props) {
        props.onHide?.();
        UserProfileActions.openUserProfileModal({
            userId: props.user.id,
            guildId: props.guildId,
            channelId: props.channelId,
            messageId: props.messageId,
            roleId: props.roleId,
            sourceAnalyticsLocations: props.newAnalyticsLocations
        });

        return null;
    },

    closeRestrictedProfile(props) {
        props.onHide?.();
        props.onClose?.();

        return null;
    }
});
