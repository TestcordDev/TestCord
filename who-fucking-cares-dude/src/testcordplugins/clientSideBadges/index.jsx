/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Badges } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Devs, TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Forms, Toasts, UserStore } from "@webpack/common";
function isCurrentUser(userId) {
    const u = UserStore.getCurrentUser()?.id;
    return u === userId;
}
export default definePlugin({
    name: "ClientSideBadges",
    description: "Adds client-side badges to your profile. Other users can't see them!",
    tags: ["Customisation", "Appearance"],
    authors: [
        Devs.nin0dev,
        { name: "KrystalSkullOfficial", id: 929208515883569182n },
        TestcordDevs.x2b
    ],
    settingsAboutComponent: () => <>
        <Forms.FormTitle style={{ color: "red", fontSize: "2rem", fontWeight: "bold" }}>Only you can view the badges. No, this can't and won't be changed.</Forms.FormTitle>
        <Forms.FormText>You may need to reload Discord after editing your settings for them to apply.</Forms.FormText>
    </>,
    settings: definePluginSettings({
        discordStaff: {
            description: "Show Discord Staff badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        partneredServerOwner: {
            description: "Show Partnered Server Owner badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        earlySupporter: {
            description: "Show Early Supporter badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        activeDeveloper: {
            description: "Show Active Developer badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        earlyVerifiedBotDeveloper: {
            description: "Show Early Verified Bot Developer badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        moderatorProgramsAlumni: {
            description: "Show Moderator Programs Alumni badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        bugHunter: {
            description: "Show Bug Hunter badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        goldenBugHunter: {
            description: "Show Golden Bug Hunter badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        hypesquadEvents: {
            description: "Show HypeSquad Events badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        houseOfBravery: {
            description: "Show HypeSquad Bravery badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        houseOfBrilliance: {
            description: "Show HypeSquad Brilliance badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        houseOfBalance: {
            description: "Show HypeSquad Balance badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        discordQuests: {
            description: "Show Discord Quests badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        nitro: {
            description: "Show Nitro badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        serverBooster: {
            description: "Show Server Booster badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        legacyUsername: {
            description: "Show Legacy Username badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        supportsCommands: {
            description: "Show Supports Commands badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        premiumApp: {
            description: "Show Premium App badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        usesAutomod: {
            description: "Show Uses AutoMod badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
        aClownForATime: {
            description: "Show A Clown For A Time badge",
            type: 3 /* OptionType.BOOLEAN */,
            restartNeeded: true,
        },
    }),
    async start() {
        this.addedBadges = new Set();
        const NativeBadges = [
            {
                id: "discordStaff",
                description: "Discord Staff",
                iconSrc: "https://cdn.discordapp.com/badge-icons/5e74e9b61934fc1f67c65515d1f7e60d.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.discordStaff),
                link: "https://discord.com/company"
            },
            {
                id: "partneredServerOwner",
                description: "Partnered Server Owner",
                iconSrc: "https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.partneredServerOwner),
                link: "https://discord.com/partners"
            },
            {
                id: "earlySupporter",
                description: "Early Supporter",
                iconSrc: "https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.earlySupporter),
                link: "https://discord.com/settings/premium"
            },
            {
                id: "activeDeveloper",
                description: "Active Developer",
                iconSrc: "https://cdn.discordapp.com/badge-icons/6bdc42827a38498929a4920da12695d9.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.activeDeveloper),
                link: "https://support-dev.discord.com/hc/en-us/articles/10113997751447"
            },
            {
                id: "earlyVerifiedBotDeveloper",
                description: "Early Verified Bot Developer",
                iconSrc: "https://cdn.discordapp.com/badge-icons/6df5892e0f35b051f8b61eace34f4967.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.earlyVerifiedBotDeveloper),
                link: "https://discord.com/settings/premium"
            },
            {
                id: "moderatorProgramsAlumni",
                description: "Moderator Programs Alumni",
                iconSrc: "https://cdn.discordapp.com/badge-icons/fee1624003e2fee35cb398e125dc479b.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.moderatorProgramsAlumni),
                link: "https://discord.com/settings/premium"
            },
            {
                id: "bugHunter",
                description: "Discord Bug Hunter",
                iconSrc: "https://cdn.discordapp.com/badge-icons/2717692c7dca7289b35297368a940dd0.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.bugHunter),
                link: "https://discord.com/settings/premium"
            },
            {
                id: "goldenBugHunter",
                description: "Golden Discord Bug Hunter",
                iconSrc: "https://cdn.discordapp.com/badge-icons/848f79194d4be5ff5f81505cbd0ce1e6.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.goldenBugHunter),
                link: "https://discord.com/settings/premium"
            },
            {
                id: "hypesquadEvents",
                description: "HypeSquad Events",
                iconSrc: "https://cdn.discordapp.com/badge-icons/bf01d1073931f921909045f3a39fd264.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.hypesquadEvents),
                link: "https://support.discord.com/hc/en-us/articles/360035962891-Profile-Badges-101#h_01GM67K5EJ16ZHYZQ5MPRW3JT3"
            },
            {
                id: "houseOfBravery",
                description: "HypeSquad Bravery",
                iconSrc: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.houseOfBravery),
                link: "https://discord.com/settings/hypesquad-online"
            },
            {
                id: "houseOfBrilliance",
                description: "HypeSquad Brilliance",
                iconSrc: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.houseOfBrilliance),
                link: "https://discord.com/settings/hypesquad-online"
            },
            {
                id: "houseOfBalance",
                description: "HypeSquad Balance",
                iconSrc: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.houseOfBalance),
                link: "https://discord.com/settings/hypesquad-online"
            },
            {
                id: "discordQuests",
                description: "Discord Quests",
                iconSrc: "https://cdn.discordapp.com/badge-icons/7d9ae358c8c5e118768335dbe68b4fb8.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.discordQuests),
                link: "https://discord.com/discovery/quests"
            },
            {
                id: "nitro",
                description: "Discord Nitro",
                iconSrc: "https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.nitro),
                link: "https://discord.com/settings/premium"
            },
            {
                id: "serverBooster",
                description: "Server Booster",
                iconSrc: "https://cdn.discordapp.com/badge-icons/ec92202290b48d0879b7413d2dde3bab.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.serverBooster),
                link: "https://discord.com/settings/premium"
            },
            {
                id: "supportsCommands",
                description: "Supports Commands",
                iconSrc: "https://cdn.discordapp.com/badge-icons/6f9e37f9029ff57aef81db857890005e.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.supportsCommands),
                link: "https://discord.com/blog/welcome-to-the-new-era-of-discord-apps?ref=badge"
            },
            {
                id: "premiumApp",
                description: "Premium App",
                iconSrc: "https://cdn.discordapp.com/badge-icons/d2010c413a8da2208b7e4f35bd8cd4ac.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.premiumApp),
                link: ""
            },
            {
                id: "usesAutomod",
                description: "Uses Automod",
                iconSrc: "https://cdn.discordapp.com/badge-icons/f2459b691ac7453ed6039bbcfaccbfcd.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.usesAutomod),
                link: ""
            },
            {
                id: "legacyUsername",
                description: "Legacy Username",
                iconSrc: "https://cdn.discordapp.com/badge-icons/6de6d34650760ba5551a79732e98ed60.png",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.legacyUsername),
                link: ""
            },
            {
                id: "aClownForATime",
                description: "A clown, for a limited time",
                iconSrc: "https://discord.com/assets/971cfe4aa5c0582000ea.svg",
                position: 1 /* Badges.BadgePosition.END */,
                shouldShow: (({ userId }) => isCurrentUser(userId) && this.settings.store.aClownForATime),
                link: "https://youtu.be/cc2-4ci4G84"
            }
        ];
        NativeBadges.forEach(b => {
            const id = b.id || b.description.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (!Badges.getBadge?.(id)) {
                Badges.addBadge?.({ ...b, id });
                this.addedBadges.add(id);
            }
        });
    },
    async stop() {
        if (this.addedBadges) {
            this.addedBadges.forEach(id => Badges.removeBadge?.(id));
            this.addedBadges.clear();
        }
        Toasts.show({
            id: Toasts.genId(),
            message: "Client-side badges removed. Reload if issues persist.",
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.BOTTOM }
        });
    }
});
