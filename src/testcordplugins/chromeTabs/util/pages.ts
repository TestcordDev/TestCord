/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ComponentType } from "react";

import { ActivityIcon, DiscoveryIcon, EnvelopeIcon, FriendsIcon, ICYMIIcon, LibraryIcon, NitroIcon, QuestIcon, ShopIcon } from "./icons";

/**
 * Discord pages that aren't channels (Friends, Shop, Quests, ...) get a synthetic
 * channel id so they can live in a tab like everything else. Real channel ids are
 * snowflakes, so the `__name__` prefix can never collide with one.
 */
export interface SyntheticPage {
    id: string;
    route: string;
    label: string;
    Icon: ComponentType<any>;
}

export const SYNTHETIC_PAGES: SyntheticPage[] = [
    { id: "__friends__", route: "/channels/@me", label: "Friends", Icon: FriendsIcon },
    { id: "__activity__", route: "/channels/@me/activity", label: "Activity", Icon: ActivityIcon },
    { id: "__quests__", route: "/quest-home", label: "Quests", Icon: QuestIcon },
    { id: "__message-requests__", route: "/message-requests", label: "Message Requests", Icon: EnvelopeIcon },
    { id: "__shop__", route: "/shop", label: "Shop", Icon: ShopIcon },
    { id: "__library__", route: "/library", label: "Library", Icon: LibraryIcon },
    { id: "__discovery__", route: "/discovery", label: "Discovery", Icon: DiscoveryIcon },
    { id: "__nitro__", route: "/store", label: "Nitro", Icon: NitroIcon },
    { id: "__icymi__", route: "/icymi", label: "ICYMI", Icon: ICYMIIcon }
];

const pagesById = new Map(SYNTHETIC_PAGES.map(page => [page.id, page]));

export function isSyntheticChannelId(channelId: string | null | undefined): boolean {
    return !!channelId?.startsWith("__");
}

export function getSyntheticPage(channelId: string | null | undefined): SyntheticPage | undefined {
    return channelId ? pagesById.get(channelId) : undefined;
}

/**
 * Maps the current location back onto a synthetic page id. Used when Discord
 * navigates somewhere that has no channel id, so the active tab can still update.
 *
 * Ordering matters: `/channels/@me/activity` must be tested before `/channels/@me`.
 */
export function getSyntheticPageIdForPath(pathname: string): string | undefined {
    if (pathname === "/channels/@me/activity") return "__activity__";
    if (pathname === "/channels/@me") return "__friends__";

    if (pathname.includes("quest-home")) return "__quests__";
    if (pathname.includes("/message-requests")) return "__message-requests__";
    if (pathname.includes("/discovery")) return "__discovery__";
    if (pathname.includes("/library")) return "__library__";
    if (pathname.includes("/icymi")) return "__icymi__";
    if (pathname.includes("/shop")) return "__shop__";
    // `/store` is Nitro; checked after `/shop` since neither contains the other
    if (pathname.includes("/store")) return "__nitro__";

    return undefined;
}
