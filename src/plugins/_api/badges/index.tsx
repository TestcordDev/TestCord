/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./fixDiscordBadgePadding.css";

import { _getBadges, BadgePosition, BadgeUserArgs, ProfileBadge } from "@api/Badges";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heart } from "@components/Heart";
import { openContributorModal } from "@components/settings/tabs";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { shouldShowContributorBadge, shouldShowEquicordContributorBadge, shouldShowTestcordAdminBadge, shouldShowTestcordContributorBadge } from "@utils/misc";
import { isTestcordDeveloper, isTestcordOwner } from "@utils/testcordAdmins";
import { ZWSP } from "@utils/text";
import definePlugin from "@utils/types";
import { Constants, ContextMenuApi, FluxDispatcher, Menu, RestAPI, Toasts, UserProfileStore, UserStore } from "@webpack/common";
import type { Ref } from "react";

import Plugins, { PluginMeta } from "~plugins";

import { EquicordTranslatorModal, TestCordDonorModal, VencordDonorModal } from "./modals";

const CONTRIBUTOR_BADGE = "https://cdn.discordapp.com/emojis/1092089799109775453.png?size=64";
const EQUICORD_CONTRIBUTOR_BADGE = "https://Equicord.org/assets/favicon.png";
const TESTCORD_CONTRIBUTOR_BADGE = "https://raw.githubusercontent.com/TestcordDev/TestCord/main/browser/icon.png";
const USERPLUGIN_CONTRIBUTOR_BADGE = "https://Equicord.org/assets/icons/misc/userplugin.png";
const TESTCORD_ADMIN_BADGE = "https://raw.githubusercontent.com/TestcordDev/tbadges/main/admnew.png";
const TESTCORD_OWNER_BADGE = "https://raw.githubusercontent.com/TestcordDev/tbadges/refs/heads/main/ownnew.png";
const TESTCORD_DEV_BADGE = "https://raw.githubusercontent.com/TestcordDev/tbadges/refs/heads/main/devnew.png";

// URL for custom testcord badges (managed by /badge command)
const TBADGES_JSON_URL = "https://raw.githubusercontent.com/TestcordDev/tbadges/main/badges.json";
const TBADGES_REPO_URL = "https://raw.githubusercontent.com/TestcordDev/tbadges/main";

const ContributorBadge: ProfileBadge = {
    id: "vencord_contributor_badge",
    description: "Vencord Contributor",
    iconSrc: CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId))
};

const EquicordContributorBadge: ProfileBadge = {
    id: "equicord_contributor_badge",
    description: "Equicord Contributor",
    iconSrc: EQUICORD_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowEquicordContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const TestcordContributorBadge: ProfileBadge = {
    id: "testcord_contributor",
    description: "Testcord Contributor",
    iconSrc: TESTCORD_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowTestcordContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const TestcordUserBadge: ProfileBadge = {
    id: "testcord_user",
    description: "Testcord User",
    key: "testcord-user-badge",
    component: (props: ProfileBadge & BadgeUserArgs & { ref?: Ref<SVGSVGElement>; }) => (
        <Heart ref={props.ref} width={22} height={22} {...props} />
    ),
    position: BadgePosition.START,
    shouldShow: ({ userId }) => !!UserProfileStore.getUserProfile(userId)?.pronouns?.includes(ZWSP),
};

const UserPluginContributorBadge: ProfileBadge = {
    id: "user_plugin_contributor_badge",
    description: "User Plugin Contributor",
    iconSrc: USERPLUGIN_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => {
        if (!IS_DEV) return false;
        const allPlugins = Object.values(Plugins);
        return allPlugins.some(p => {
            const pluginMeta = PluginMeta[p.name];
            return pluginMeta?.userPlugin && p.authors.some(a => a && a.id.toString() === userId);
        });
    },
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const TestcordAdminBadge: ProfileBadge = {
    id: "testcord_admin",
    description: "Testcord Admin",
    iconSrc: TESTCORD_ADMIN_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowTestcordAdminBadge(userId),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const TestcordOwnerBadge: ProfileBadge = {
    id: "testcord_owner",
    description: "Testcord Owner",
    iconSrc: TESTCORD_OWNER_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => isTestcordOwner(userId),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const TestcordDevBadge: ProfileBadge = {
    id: "testcord_developer",
    description: "Testcord Dev",
    iconSrc: TESTCORD_DEV_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => isTestcordDeveloper(userId),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

let DonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let EquicordDonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let TestcordCustomBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;

async function loadBadges(url: string, noCache = false) {
    const init = {} as RequestInit;
    if (noCache) init.cache = "no-cache";

    return await fetch(url, init).then(r => r.ok ? r.json() : {}).catch(() => ({}));
}

async function loadAllBadges(noCache = false) {
    const init = {} as RequestInit;
    if (noCache) init.cache = "no-cache";

    const urls = [
        { key: "vencord", url: "https://badges.vencord.dev/badges.json" },
        { key: "equicord", url: "https://badge.equicord.org/badges.json" },
        { key: "testcord", url: TBADGES_JSON_URL }
    ];

    const results = await Promise.allSettled(
        urls.map(({ url }) => fetch(url, init).then(r => r.ok ? r.json() : {}))
    );

    const logger = new Logger("BadgeAPI#loadAllBadges");

    // Process results
    results.forEach((result, index) => {
        const { key } = urls[index];
        if (result.status === "fulfilled") {
            if (key === "vencord") {
                DonorBadges = result.value;
            } else if (key === "equicord") {
                EquicordDonorBadges = result.value;
            } else if (key === "testcord") {
                TestcordCustomBadges = result.value;
            }
        } else {
            logger.error(`Failed to fetch ${key} badges:`, result.reason);
        }
    });
}

let intervalId: any;

async function ensurePronounsMarker() {
    const selfId = UserStore.getCurrentUser()?.id;
    if (!selfId) return;

    if (UserProfileStore.getUserProfile(selfId)?.pronouns?.includes(ZWSP)) return;

    try {
        const { body } = await RestAPI.get({ url: Constants.Endpoints.USER_PROFILE("@me") });
        const pronouns: string | undefined = body?.pronouns;
        if (pronouns?.includes(ZWSP)) return;

        const { body: updated } = await RestAPI.patch({
            url: Constants.Endpoints.USER_PROFILE("@me"),
            body: { pronouns: `${pronouns ?? ""}${ZWSP}` }
        });

        FluxDispatcher.dispatch({
            type: "USER_PROFILE_UPDATE_SUCCESS",
            userId: selfId,
            guildId: null,
            ...updated
        });
    } catch (e) {
        new Logger("BadgeAPI#ensurePronounsMarker").error("Failed to add Testcord marker to pronouns", e);
    }
}

export function BadgeContextMenu({ badge }: { badge: Omit<ProfileBadge, "id"> & BadgeUserArgs; }) {
    return (
        <Menu.Menu
            navId="vc-badge-context"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Badge Options"
        >
            {badge.description && (
                <Menu.MenuItem
                    id="vc-badge-copy-name"
                    label="Copy Badge Name"
                    action={() => copyWithToast(badge.description!)}
                />
            )}
            {badge.iconSrc && (
                <Menu.MenuItem
                    id="vc-badge-copy-link"
                    label="Copy Badge Image Link"
                    action={() => copyWithToast(badge.iconSrc!)}
                />
            )}
        </Menu.Menu>
    );
}

export default definePlugin({
    name: "BadgeAPI",
    description: "API to add badges to users",
    authors: [Devs.Megu, Devs.Ven, Devs.TheSun],
    required: true,
    patches: [
        {
            find: "#{intl::PROFILE_USER_BADGES}",
            replacement: [
                {
                    match: /alt:" ","aria-hidden":!0,src:.{0,50}(\i).iconSrc/,
                    replace: "...$1.props,$&"
                },
                // Path with 2026-04-badge-discovery OFF
                {
                    match: /(?<=forceOpen:.{0,40}?ariaHidden:!0,)children:(?=.{0,50}?(\i)\.id)/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}):"
                },
                // Path with 2026-04-badge-discovery ON
                {
                    match: /(?<=fallbackIconSrc:.{0,50}?)children:(?=.{0,50}?(\i)\.id)/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}):"
                },
                // handle onClick and onContextMenu
                {
                    match: /href:(\i)\.link/,
                    replace: "...$self.getBadgeMouseEventHandlers($1),$&"
                }
            ]
        },
        {
            find: "getLegacyUsername(){",
            replacement: {
                match: /getBadges\(\)\{.{0,100}?return\[/,
                replace: "$&...$self.getBadges(this),"
            }
        }
    ],

    // for access from the console or other plugins
    get DonorBadges() {
        return DonorBadges;
    },

    get EquicordDonorBadges() {
        return EquicordDonorBadges;
    },

    get TestcordCustomBadges() {
        return TestcordCustomBadges;
    },

    toolboxActions: {
        async "Refetch Badges"() {
            await loadAllBadges(true);
            Toasts.show({
                id: Toasts.genId(),
                message: "Successfully refetched badges!",
                type: Toasts.Type.SUCCESS
            });
        }
    },

    userProfileBadges: [ContributorBadge, EquicordContributorBadge, TestcordContributorBadge, TestcordUserBadge, TestcordAdminBadge, TestcordOwnerBadge, TestcordDevBadge, UserPluginContributorBadge],

    async start() {
        ensurePronounsMarker();
        await loadAllBadges();
        clearInterval(intervalId);
        intervalId = setInterval(loadAllBadges, 1000 * 60 * 30); // 30 minutes
    },

    async stop() {
        clearInterval(intervalId);
    },

    getBadges(profile: { userId: string; guildId: string; }) {
        if (!profile) return [];

        try {
            return _getBadges(profile);
        } catch (e) {
            new Logger("BadgeAPI#getBadges").error(e);
            return [];
        }
    },

    renderBadgeComponent: ErrorBoundary.wrap((badge: ProfileBadge & BadgeUserArgs) => {
        const Component = badge.component!;
        return <Component {...badge} />;
    }, { noop: true }),

    getBadgeMouseEventHandlers(badge: ProfileBadge & BadgeUserArgs) {
        const handlers = {} as Record<string, (e: React.MouseEvent) => void>;

        if (!badge) return handlers; // sanity check

        const { onClick, onContextMenu } = badge;

        if (onClick) handlers.onClick = e => onClick(e, badge);
        if (onContextMenu) handlers.onContextMenu = e => onContextMenu(e, badge);

        return handlers;
    },

    getDonorBadges(userId: string) {
        return DonorBadges[userId]?.map((badge, idx) => ({
            id: `vencord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: {
                style: {
                    borderRadius: "50%",
                    transform: "scale(0.9)"
                }
            },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick() {
                return VencordDonorModal();
            },
        } satisfies ProfileBadge));
    },

    getEquicordDonorBadges(userId: string) {
        return EquicordDonorBadges[userId]?.map((badge, idx) => ({
            id: `equicord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: {
                style: {
                    borderRadius: "50%",
                    transform: "scale(0.9)"
                }
            },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick() {
                return badge.tooltip === "Equicord Translator" ? EquicordTranslatorModal() : TestCordDonorModal();
            },
        } satisfies ProfileBadge));
    },

    // Get custom testcord badges (managed by /badge command)
    getTestCordCustomBadges(userId: string) {
        const userBadges = TestcordCustomBadges[userId];
        if (!userBadges) return [];

        // Handle both array format and object format (with numeric keys like "0", "1")
        let badgesArray: Array<{ tooltip: string; badge: string; }>;
        if (Array.isArray(userBadges)) {
            badgesArray = userBadges;
        } else if (typeof userBadges === "object") {
            // Convert object with numeric keys to array
            badgesArray = Object.values(userBadges);
        } else {
            return [];
        }

        return badgesArray.map(badge => {
            // Check if badge URL is full URL or just filename
            const iconSrc = typeof badge.badge === "string" && badge.badge.startsWith("http")
                ? badge.badge
                : `${TBADGES_REPO_URL}/${badge.badge}`;

            return {
                id: `external_badge_${badge.badge}`,
                iconSrc,
                description: badge.tooltip,
                position: BadgePosition.START,
                props: {
                    style: {
                        borderRadius: "50%",
                        transform: "scale(0.9)"
                    }
                }
            } satisfies ProfileBadge;
        });
    },

    // Alias for backward compatibility
    getTestCordDonorBadges: function (userId: string) {
        return this.getEquicordDonorBadges(userId);
    }
});
