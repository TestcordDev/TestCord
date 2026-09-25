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

import ErrorBoundary from "@components/ErrorBoundary";
import globalBadges from "@equicordplugins/globalBadges";
import BadgeAPIPlugin from "@plugins/_api/badges";
import { ComponentType, HTMLProps } from "react";

import { isPluginEnabled } from "./PluginManager";

export const enum BadgePosition {
    START,
    END
}

export interface ProfileBadge {
    /**
     * Badge id, unused by vencord, required by discord
     */
    id: string,
    /** The tooltip to show on hover. Required for image badges */
    description?: string;
    /** Custom component for the badge (tooltip not included) */
    component?: ComponentType<ProfileBadge & BadgeUserArgs>;
    /** The custom image to use */
    iconSrc?: string;
    link?: string;
    /** Action to perform when you click the badge */
    onClick?(event: React.MouseEvent, props: ProfileBadge & BadgeUserArgs): void;
    /** Action to perform when you right click the badge */
    onContextMenu?(event: React.MouseEvent, props: ProfileBadge & BadgeUserArgs): void;
    /** Should the user display this badge? */
    shouldShow?(userInfo: BadgeUserArgs): boolean;
    /** Optional props (e.g. style) for the badge, ignored for component badges */
    props?: HTMLProps<HTMLImageElement>;
    /** Insert at start or end? */
    position?: BadgePosition;
    /** The badge name to display, Discord uses this. Required for component badges */
    key?: string;

    /**
     * Allows dynamically returning multiple badges.
     * Must not call hooks
     */
    getBadges?(userInfo: BadgeUserArgs): ProfileBadge[];
}

const Badges = new Set<ProfileBadge>();

function getBadgeId(badge: Partial<ProfileBadge>, userId: string, index: number) {
    return badge.id || `vc-badge-${badge.key ?? badge.description ?? badge.iconSrc ?? "badge"}-${userId}-${index}`
        .replace(/[^a-z0-9_-]/gi, "_");
}

function isRenderableBadge(badge: Partial<ProfileBadge>) {
    return typeof badge.component === "function"
        || typeof badge.iconSrc === "string" && badge.iconSrc.length > 0;
}

/**
 * `ErrorBoundary.wrap` returns a brand-new function component on every call, so wrapping
 * inline in `normalizeBadges` gave every badge a fresh component type on every render.
 * Discord calls this once per message author, and React treats a changed component type
 * as a different component: it unmounted and remounted the whole badge subtree each pass
 * (losing internal state) and allocated a closure per badge per author per render.
 *
 * The props are the same constant object at this call site, so caching on the source
 * component is exact. `ErrorBoundary.wrap` itself is untouched - other callers pass
 * varying props and must keep getting fresh wrappers.
 */
const wrappedBadgeComponents = new WeakMap<ComponentType<any>, ComponentType<any>>();
const wrappedBadgeOutputs = new WeakSet<ComponentType<any>>();

/** Idempotent, so a component that was already wrapped at registration is not wrapped again. */
function wrapBadgeComponent(component: ComponentType<any>) {
    if (wrappedBadgeOutputs.has(component)) return component;

    const cached = wrappedBadgeComponents.get(component);
    if (cached) return cached;

    const wrapped = ErrorBoundary.wrap(component, { noop: true });
    wrappedBadgeComponents.set(component, wrapped);
    wrappedBadgeOutputs.add(wrapped);
    return wrapped;
}

function normalizeBadges(rawBadges: unknown[] | undefined, args: BadgeUserArgs, offset = 0) {
    return (rawBadges ?? [])
        .filter((badge): badge is Partial<ProfileBadge> => typeof badge === "object" && badge != null)
        .map((badge, index) => ({
            ...args,
            ...badge,
            id: getBadgeId(badge, args.userId, offset + index),
            component: badge.component && wrapBadgeComponent(badge.component)
        }))
        .filter(isRenderableBadge);
}

/**
 * Register a new badge with the Badges API
 * @param badge The badge to register
 */
export function addProfileBadge(badge: ProfileBadge) {
    badge.component &&= wrapBadgeComponent(badge.component);
    Badges.add(badge);
}

/**
 * Unregister a badge from the Badges API
 * @param badge The badge to remove
 */
export function removeProfileBadge(badge: ProfileBadge) {
    return Badges.delete(badge);
}

/**
 * Inject badges into the profile badges array.
 * You probably don't need to use this.
 */
export function _getBadges(args: BadgeUserArgs) {
    const badges = [] as ProfileBadge[];
    for (const badge of Badges) {
        if (badge.shouldShow && !badge.shouldShow(args)) {
            continue;
        }

        const b = normalizeBadges(badge.getBadges ? badge.getBadges(args) : [badge], args, badges.length);

        if (badge.position === BadgePosition.START) {
            badges.unshift(...b);
        } else {
            badges.push(...b);
        }
    }

    const donorBadges = normalizeBadges(BadgeAPIPlugin.getDonorBadges(args.userId), args, badges.length);
    const equicordDonorBadges = normalizeBadges(BadgeAPIPlugin.getEquicordDonorBadges(args.userId), args, badges.length);
    const testcordCustomBadges = normalizeBadges(BadgeAPIPlugin.getTestCordCustomBadges(args.userId), args, badges.length);
    const GlobalBadges = isPluginEnabled(globalBadges.name)
        ? normalizeBadges(globalBadges.getGlobalBadges(args.userId), args, badges.length)
        : [];

    // Build final array with prepended groups in correct order
    return [
        ...testcordCustomBadges,
        ...equicordDonorBadges,
        ...donorBadges,
        ...GlobalBadges,
        ...badges
    ];
}

export interface BadgeUserArgs {
    userId: string;
    guildId: string;
}
