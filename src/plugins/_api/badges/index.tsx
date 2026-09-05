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
import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { CopyIcon, LinkIcon } from "@components/Icons";
import { openContributorModal } from "@components/settings/tabs";
import { Devs } from "@utils/constants";
import { copyWithToast, fetchUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { shouldShowContributorBadge, shouldShowEquicordContributorBadge, shouldShowTestcordAdminBadge, shouldShowTestcordContributorBadge } from "@utils/misc";
import { isTestcordArtist, isTestcordDeveloper, isTestcordOwner } from "@utils/testcordAdmins";
import { ZWSP } from "@utils/text";
import definePlugin from "@utils/types";
import { Constants, ContextMenuApi, Menu, RestAPI, Toasts, UserProfileStore, UserStore } from "@webpack/common";
import testcordArtistIconBase64 from "file://../../../../browser/TestcordArtist.png?base64";

import Plugins, { PluginMeta } from "~plugins";

import { EquicordTranslatorModal, TestCordDonorModal, VencordDonorModal } from "./modals";

const CONTRIBUTOR_BADGE = "https://cdn.discordapp.com/emojis/1092089799109775453.png?size=64";
const EQUICORD_CONTRIBUTOR_BADGE = "https://Equicord.org/assets/favicon.png";
const TESTCORD_CONTRIBUTOR_BADGE = "https://raw.githubusercontent.com/TestcordDev/TestCord/main/browser/icon.png";
const USERPLUGIN_CONTRIBUTOR_BADGE = "https://Equicord.org/assets/icons/misc/userplugin.png";
const TESTCORD_ADMIN_BADGE = "https://raw.githubusercontent.com/TestcordDev/tbadges/main/admnew.png";
const TESTCORD_OWNER_BADGE = "https://raw.githubusercontent.com/TestcordDev/tbadges/refs/heads/main/ownnew.png";
const TESTCORD_DEV_BADGE = "https://raw.githubusercontent.com/TestcordDev/tbadges/refs/heads/main/devnew.png";
const TESTCORD_ARTIST_BADGE_URL = "https://raw.githubusercontent.com/TestcordDev/TestCord/main/browser/TestcordArtist.png";

const TESTCORD_ARTIST_BADGE = `data:image/png;base64,${testcordArtistIconBase64}`;

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

const HEART_BADGE_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#db61a2\" fill-rule=\"evenodd\" d=\"M4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.565 20.565 0 008 13.393a20.561 20.561 0 003.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.75.75 0 01-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5zM8 14.25l-.345.666-.002-.001-.006-.003-.018-.01a7.643 7.643 0 01-.31-.17 22.075 22.075 0 01-3.434-2.414C2.045 10.731 0 8.35 0 5.5 0 2.836 2.086 1 4.25 1 5.797 1 7.153 1.802 8 3.02 8.847 1.802 10.203 1 11.75 1 13.914 1 16 2.836 16 5.5c0 2.85-2.045 5.231-3.885 6.818a22.08 22.08 0 01-3.744 2.584l-.018.01-.006.003h-.002L8 14.25zm0 0l.345.666a.752.752 0 01-.69 0L8 14.25z\"/></svg>"
)}`;

const TestcordUserBadge: ProfileBadge = {
    id: "testcord_user",
    description: "Testcord User",
    iconSrc: HEART_BADGE_ICON,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => !!UserProfileStore.getUserProfile(userId)?.pronouns?.includes(ZWSP),
    props: {
        style: {
            transform: "scale(0.9)"
        }
    },
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

const TestcordArtistBadge: ProfileBadge = {
    id: "testcord_artist",
    description: "Testcord Artist",
    iconSrc: TESTCORD_ARTIST_BADGE,
    link: TESTCORD_ARTIST_BADGE_URL,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => isTestcordArtist(userId),
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

const badgeLogger = new Logger("BadgeAPI");

async function ensurePronounsMarker() {
    if ((Settings as any).plugins?.TestcordHelper?.pronounsBadge === false) return;

    const selfId = UserStore.getCurrentUser()?.id;
    if (!selfId) return;

    if (UserProfileStore.getUserProfile(selfId)?.pronouns?.includes(ZWSP)) return;

    try {
        const { body } = await RestAPI.get({ url: Constants.Endpoints.USER_PROFILE(selfId) });
        const pronouns: string | undefined = body?.user_profile?.pronouns ?? body?.pronouns;
        if (pronouns?.includes(ZWSP)) return;

        const { body: updated } = await RestAPI.patch({
            url: Constants.Endpoints.USER_PROFILE("@me"),
            body: { pronouns: `${pronouns ?? ""}${ZWSP}` }
        });

        await fetchUserProfile(selfId, {}, false);
        badgeLogger.debug("Appended Testcord marker to pronouns", updated);
    } catch (e) {
        badgeLogger.error("Failed to add Testcord marker to pronouns", e);
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
                    leadingAccessory={{ type: "icon", icon: CopyIcon }}
                />
            )}
            {badge.iconSrc && (
                <Menu.MenuItem
                    id="vc-badge-copy-link"
                    label="Copy Badge Image Link"
                    action={() => copyWithToast(badge.link ?? badge.iconSrc!)}
                    leadingAccessory={{ type: "icon", icon: LinkIcon }}
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

    userProfileBadges: [ContributorBadge, EquicordContributorBadge, TestcordContributorBadge, TestcordUserBadge, TestcordAdminBadge, TestcordOwnerBadge, TestcordDevBadge, TestcordArtistBadge, UserPluginContributorBadge],

    start() {
        setTimeout(() => {
            ensurePronounsMarker();
            loadAllBadges();
        }, 100);
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
