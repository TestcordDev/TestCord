/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import { THEME_RAW_API_URL, THEMES_API_URL } from "./MarketplaceData";

const OVERRIDE_PREFIX = "MarketplaceOverride_";

export const overrideKey = (id: number) => `${OVERRIDE_PREFIX}${id}`;

export function getMarketplaceLink(id: number): string {
    return `${THEME_RAW_API_URL}/${id}`;
}

/**
 * Matches both link forms used across the client:
 * https://themes.equicord.org/api/<id> and https://themes.equicord.org/api/themes/<id>
 */
export function parseMarketplaceId(link: string): number | null {
    const match = /(?:\/api\/themes\/|\/api\/)(\d+)(?:[/?#]|$)/.exec(link);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isInteger(id) ? id : null;
}

export function getOverride(id: number): Promise<string | undefined> {
    return DataStore.get<string>(overrideKey(id));
}

export function setOverride(id: number, css: string): Promise<void> {
    return DataStore.set(overrideKey(id), css);
}

export function deleteOverride(id: number): Promise<void> {
    return DataStore.del(overrideKey(id));
}

export async function listOverriddenIds(): Promise<number[]> {
    try {
        const allKeys = await DataStore.keys<string>();
        const ids: number[] = [];
        for (const key of allKeys) {
            if (typeof key !== "string" || !key.startsWith(OVERRIDE_PREFIX)) continue;
            const id = Number(key.slice(OVERRIDE_PREFIX.length));
            if (Number.isInteger(id)) ids.push(id);
        }
        return ids;
    } catch {
        return [];
    }
}

export function isMarketplaceLink(link: string): boolean {
    if (link.startsWith(THEME_RAW_API_URL) || link.startsWith(THEMES_API_URL)) return parseMarketplaceId(link) !== null;
    return false;
}
