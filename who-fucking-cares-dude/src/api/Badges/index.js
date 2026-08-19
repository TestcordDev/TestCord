/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findStoreLazy } from "@webpack";
export var BadgePosition;
(function (BadgePosition) {
    BadgePosition[BadgePosition["START"] = 0] = "START";
    BadgePosition[BadgePosition["END"] = 1] = "END";
})(BadgePosition || (BadgePosition = {}));
let badges = [];
export const Badges = {
    /**
     * Add a badge that conditionally shows on profiles.
     */
    addBadge(badge) {
        badges.push(badge);
    },
    /**
     * Remove a badge.
     */
    removeBadge(badge) {
        const index = badges.indexOf(badge);
        if (index > -1) {
            badges.splice(index, 1);
        }
    },
    /**
     * Clear all badges.
     */
    clearBadges() {
        badges = [];
    }
};
// Patch UserProfileStore to inject badges
const UserProfileStore = findStoreLazy("UserProfileStore");
let originalGetUserProfile = null;
const patchesApplied = {
    getUserProfile: false
};
export function init() {
    // Wait for store if not ready
    const checkStore = () => {
        if (UserProfileStore.getUserProfile) {
            applyBadgesPatches();
        }
        else {
            setTimeout(checkStore, 100);
        }
    };
    checkStore();
}
function applyBadgesPatches() {
    if (patchesApplied.getUserProfile || !UserProfileStore.getUserProfile)
        return;
    originalGetUserProfile = UserProfileStore.getUserProfile;
    UserProfileStore.getUserProfile = function (userId) {
        const profile = originalGetUserProfile.call(this, userId);
        if (!profile)
            return profile;
        if (!profile.badges)
            profile.badges = [];
        const filteredBadges = badges
            .filter(badge => badge.shouldShow({ userId }))
            .sort((a, b) => a.position - b.position);
        const startBadges = filteredBadges.filter(b => b.position === BadgePosition.START);
        const endBadges = filteredBadges.filter(b => b.position === BadgePosition.END);
        const newStartBadges = startBadges.map(b => ({
            id: `custom-${b.description.replace(/[^a-z0-9]/gi, "")}-${userId.slice(-8)}`,
            description: b.description,
            icon: b.image?.startsWith("http") ?? false ? b.image : `/assets/${b.image}.png`,
            link: b.link
        }));
        const newEndBadges = endBadges.map(b => ({
            id: `custom-${b.description.replace(/[^a-z0-9]/gi, "")}-${userId.slice(-8)}`,
            description: b.description,
            icon: b.image?.startsWith("http") ?? false ? b.image : `/assets/${b.image}.png`,
            link: b.link
        }));
        // Filter out invalid badges (missing image/description) to prevent renderer crash
        const validBadges = profile.badges.filter(b => b && b.icon && typeof b.icon === "string" && b.description);
        profile.badges = [
            ...newStartBadges,
            ...validBadges,
            ...newEndBadges
        ];
        return profile;
    };
    patchesApplied.getUserProfile = true;
}
export function unpatch() {
    if (originalGetUserProfile && patchesApplied.getUserProfile && UserProfileStore.getUserProfile) {
        UserProfileStore.getUserProfile = originalGetUserProfile;
        patchesApplied.getUserProfile = false;
    }
    Badges.clearBadges();
}
// Auto init
init();
