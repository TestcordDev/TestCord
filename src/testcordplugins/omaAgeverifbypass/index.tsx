import definePlugin from "@utils/types";
import { filters, find } from "@webpack";

export default definePlugin({
    name: "AgeVerificationBypass",
    description: "Bypass Discord's age verification checks, allowing you to access everything without verifying your age.",
    tags: ["Privacy", "Utility"],
    authors: [{
        name: "dxrx99",
        id: 1463629522359423152n 
    },
    {
        name: "omaw",
        id: 1155026301791514655n
    }
    ],
    patches: [
        {
            find: "#{intl::AGE_GATE_AGE_VERIFIED}",
            replacement: {
                match: /return (\i)\.ageVerified\b/,
                replace: "return ($1.ageVerified,true)",
            },
        },
        {
            find: "#{intl::AGE_GATE_NSFW_BODY}",
            replacement: {
                match: /if\s*\((\i)\.isNSFW\b/,
                replace: "if(($1.isNSFW,false)",
            },
        },
        {
            find: "useAgeGateVerifyContentForGuild",
            replacement: {
                match: /null==(\i)\.nsfwAllowed/g,
                replace: "false",
            },
        },
        
        {
            find: "#{intl::AGE_GATE_NSFW_BODY}",
            replacement: {
                match: /(\i)\.nsfwLevel\s*>=\s*(\i)\b/,
                replace: "$1.nsfwLevel>=($2,Infinity)",
            },
        },
        {
            find: "#{intl::AGE_GATE_FAMILY_CENTER_BODY}",
            replacement: {
                match: /(\i)\.isFamilyCenterEnabled\b/,
                replace: "($1.isFamilyCenterEnabled,false)",
            },
        },
        {
            find: "useAgeGateVerifyContentForGuild",
            replacement: {
                match: /((?:\i\.)*\i)\.getCurrentUser\(\)\?\.nsfwAllowed===!1/g,
                replace: "($1.getCurrentUser()?.nsfwAllowed,false)",
            },
        },
    ],
    start() {
        const safeFindByProps = (...props: string[]) =>
            find(filters.byProps(...props), { isIndirect: true }) as Record<string, any> | null;

        const UserStore = safeFindByProps("getCurrentUser");
        const InviteStore = safeFindByProps("getInvite", "resolveInvite");
        const StageStore = safeFindByProps("isStageSpeakerAllowed");


        const applyMasterMask = () => {
            const user = UserStore?.getCurrentUser();
            if (!user) return;

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
        const interval = setInterval(applyMasterMask, 500); 
        (this as any)._interval = interval;

        if (StageStore) {
            StageStore.isStageSpeakerAllowed = () => true;
            StageStore.getStageSpeakerVerificationStatus = () => ({ verified: true });
        }

        if (InviteStore) {
            const originalGetInvite = InviteStore.getInvite;
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
            Object.defineProperty(ChannelNSFW, "isNSFW", {
                get: () => () => false,
                configurable: true
            });
        }
    },

    stop() {
        if ((this as any)._interval) clearInterval((this as any)._interval);
    }
});
