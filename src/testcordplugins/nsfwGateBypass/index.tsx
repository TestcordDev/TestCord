/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 dxrx99, omaw
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { filters,find } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

export default definePlugin({
    name: "NSFWGateBypass",
    description: "Forces 'Verified Adult' status, unlocks Stages, and clears all invite blocks.",
    tags: ["Privacy", "Utility"],
    authors: [
        {
            name: "dxrx99",
            id: 1463629522359423152n
        },
        {
            name: "omaw",
            id: 1474576133088481351n
        }
    ],

    _patchRestores: [] as Array<() => void>,
    _userOriginalFlags: null as number | null,
    _userOriginalDescriptors: null as Record<string, PropertyDescriptor> | null,

    start() {
        const safeFindByProps = (...props: string[]) =>
            find(filters.byProps(...props), { isIndirect: true }) as Record<string, any> | null;

        const UserStore = safeFindByProps("getCurrentUser");
        const InviteStore = safeFindByProps("getInvite", "resolveInvite");
        const StageStore = safeFindByProps("isStageSpeakerAllowed");

        const restores: Array<() => void> = (this as any)._patchRestores = [];

        const userProps = [
            "date_of_birth", "ageGroup", "ageVerificationStatus",
            "age_gate_done", "underage", "nsfwAllowed", "guild_nsfw_allowed"
        ];

        const applyMasterMask = () => {
            const user = UserStore?.getCurrentUser();
            if (!user) return;

            if ((this as any)._userOriginalFlags === null && typeof user.flags === "number") {
                (this as any)._userOriginalFlags = user.flags;
            }

            if ((this as any)._userOriginalDescriptors === null) {
                const descs: Record<string, PropertyDescriptor> = {};
                for (const prop of userProps) {
                    const desc = Object.getOwnPropertyDescriptor(user, prop);
                    if (desc) descs[prop] = desc;
                }
                (this as any)._userOriginalDescriptors = descs;
            }

            const adultDOB = "1997-11-24";

            Object.defineProperties(user, {
                date_of_birth: { get: () => adultDOB, configurable: true },
                ageGroup: { get: () => 1, configurable: true },
                ageVerificationStatus: { get: () => 3, configurable: true },
                age_gate_done: { get: () => true, configurable: true },
                underage: { get: () => false, configurable: true },
                nsfwAllowed: { get: () => true, configurable: true },
                guild_nsfw_allowed: { get: () => true, configurable: true }
            });

            if (typeof user.flags === "number") {
                user.flags |= 2;
                user.flags |= (1 << 18);
            }
        };

        applyMasterMask();
        const reapply = () => applyMasterMask();
        (this as any)._reapply = reapply;
        FluxDispatcher.subscribe("USER_UPDATE", reapply);
        FluxDispatcher.subscribe("CONNECTION_OPEN", reapply);

        restores.push(() => {
            const user = UserStore?.getCurrentUser?.();
            if (!user) return;

            const origDescs = (this as any)._userOriginalDescriptors as Record<string, PropertyDescriptor> | null;
            if (origDescs) {
                for (const prop of userProps) {
                    if (origDescs[prop]) Object.defineProperty(user, prop, origDescs[prop]);
                    else delete (user as any)[prop];
                }
            }

            if ((this as any)._userOriginalFlags !== null && typeof user.flags === "number") {
                user.flags = (this as any)._userOriginalFlags;
            }
        });

        if (StageStore) {
            const origIsStageSpeakerAllowed = StageStore.isStageSpeakerAllowed;
            const origGetStageSpeakerVerificationStatus = StageStore.getStageSpeakerVerificationStatus;
            StageStore.isStageSpeakerAllowed = () => true;
            StageStore.getStageSpeakerVerificationStatus = () => ({ verified: true });
            restores.push(() => {
                StageStore.isStageSpeakerAllowed = origIsStageSpeakerAllowed;
                StageStore.getStageSpeakerVerificationStatus = origGetStageSpeakerVerificationStatus;
            });
        }

        if (InviteStore) {
            const originalGetInvite = InviteStore.getInvite;
            restores.push(() => { InviteStore.getInvite = originalGetInvite; });
            InviteStore.getInvite = function(...args: any[]) {
                const invite = originalGetInvite.apply(this, args);
                if (invite) {
                    invite.is_minimum_age_verified = true;
                    invite.state = "RESOLVED";
                    if (invite.guild) {
                        invite.guild.nsfw = false;
                        invite.guild.nsfw_level = 0;
                    }
                }
                return invite;
            };
        }

        const ChannelNSFW = safeFindByProps("isNSFW");
        if (ChannelNSFW) {
            const origDescriptor = Object.getOwnPropertyDescriptor(ChannelNSFW, "isNSFW");
            Object.defineProperty(ChannelNSFW, "isNSFW", {
                get: () => () => false,
                configurable: true
            });
            restores.push(() => {
                if (origDescriptor) Object.defineProperty(ChannelNSFW, "isNSFW", origDescriptor);
                else delete ChannelNSFW.isNSFW;
            });
        }
    },

    stop() {
        const reapply = (this as any)._reapply;
        if (reapply) {
            FluxDispatcher.unsubscribe("USER_UPDATE", reapply);
            FluxDispatcher.unsubscribe("CONNECTION_OPEN", reapply);
            (this as any)._reapply = null;
        }
        const restores: Array<() => void> = (this as any)._patchRestores || [];
        while (restores.length) {
            const restore = restores.pop();
            try { restore?.(); } catch { }
        }
        (this as any)._userOriginalFlags = null;
        (this as any)._userOriginalDescriptors = null;
    }
});
