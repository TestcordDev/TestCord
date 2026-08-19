/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 dxrx99, omaw
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import definePlugin from "@utils/types";
import { filters, find } from "@webpack";
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
    _patchRestores: [],
    _userOriginalFlags: null,
    _userOriginalDescriptors: null,
    start() {
        const safeFindByProps = (...props) => find(filters.byProps(...props), { isIndirect: true });
        const UserStore = safeFindByProps("getCurrentUser");
        const InviteStore = safeFindByProps("getInvite", "resolveInvite");
        const StageStore = safeFindByProps("isStageSpeakerAllowed");
        const restores = this._patchRestores = [];
        const userProps = [
            "date_of_birth", "ageGroup", "ageVerificationStatus",
            "age_gate_done", "underage", "nsfwAllowed", "guild_nsfw_allowed"
        ];
        const applyMasterMask = () => {
            const user = UserStore?.getCurrentUser();
            if (!user)
                return;
            if (this._userOriginalFlags === null && typeof user.flags === "number") {
                this._userOriginalFlags = user.flags;
            }
            if (this._userOriginalDescriptors === null) {
                const descs = {};
                for (const prop of userProps) {
                    const desc = Object.getOwnPropertyDescriptor(user, prop);
                    if (desc)
                        descs[prop] = desc;
                }
                this._userOriginalDescriptors = descs;
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
        this._reapply = reapply;
        FluxDispatcher.subscribe("USER_UPDATE", reapply);
        FluxDispatcher.subscribe("CONNECTION_OPEN", reapply);
        restores.push(() => {
            const user = UserStore?.getCurrentUser?.();
            if (!user)
                return;
            const origDescs = this._userOriginalDescriptors;
            if (origDescs) {
                for (const prop of userProps) {
                    if (origDescs[prop])
                        Object.defineProperty(user, prop, origDescs[prop]);
                    else
                        delete user[prop];
                }
            }
            if (this._userOriginalFlags !== null && typeof user.flags === "number") {
                user.flags = this._userOriginalFlags;
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
            InviteStore.getInvite = function (...args) {
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
                if (origDescriptor)
                    Object.defineProperty(ChannelNSFW, "isNSFW", origDescriptor);
                else
                    delete ChannelNSFW.isNSFW;
            });
        }
    },
    stop() {
        const reapply = this._reapply;
        if (reapply) {
            FluxDispatcher.unsubscribe("USER_UPDATE", reapply);
            FluxDispatcher.unsubscribe("CONNECTION_OPEN", reapply);
            this._reapply = null;
        }
        const restores = this._patchRestores || [];
        while (restores.length) {
            const restore = restores.pop();
            try {
                restore?.();
            }
            catch { }
        }
        this._userOriginalFlags = null;
        this._userOriginalDescriptors = null;
    }
});
