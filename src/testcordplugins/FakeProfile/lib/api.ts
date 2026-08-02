/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BASE_URL } from "./constants";

export interface Badge {
    badge: string;
    tooltip: string;
    badge_id?: string;
}

export interface Decoration {
    asset: string;
    skuId: string;
    animated: boolean;
}

export interface UserProfile {
    userId: string;
    profileEffectId: string;
    banner: string;
    avatar: string;
    badges: Badge[];
    decoration: Decoration;
    nameplate: string;
}

export interface Users {
    version: string;
    users: Record<string, string>;
}

export interface ProfileEffects {
    id: string;
    skuId: string;
    config: {
        type: number;
        id: string;
        sku_id: string;
        title: string;
        description: string;
        accessibilityLabel: string;
        animationType: number;
        thumbnailPreviewSrc: string;
        reducedMotionSrc: string;
        effects: Array<{
            src: string;
            loop: boolean;
            alt: string | null;
            height: number;
            width: number;
            duration: number;
            start: number;
            loopDelay: number;
            position: {
                x: number;
                y: number;
            };
            zIndex: number;
            randomizedSources: boolean;
        }>;
    };
}
export interface Decors {
    name: string;
    asset: string;
    skuId: string;
    animated: boolean;
}

export const getEffects = async (): Promise<ProfileEffects[]> => {
    try {
        const res = await fetch(BASE_URL + "/profile-effects");
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
};

export const getBadges = async (): Promise<Badge[]> => {
    try {
        const res = await fetch(BASE_URL + "/badges");
        if (!res.ok) return {} as any;
        const data = await res.json();
        return data && typeof data === "object" ? data : ({} as any);
    } catch {
        return {} as any;
    }
};

export const getPresets = async (): Promise<Decors[]> => {
    try {
        const res = await fetch(BASE_URL + "/decorations");
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
};

export const getUsers = async (ids?: string[]): Promise<Record<string, UserProfile | null>> => {
    if (ids?.length === 0) return {};

    try {
        const url = new URL(BASE_URL + "/users");
        if (ids && ids.length !== 0) url.searchParams.set("ids", JSON.stringify(ids));

        const res = await fetch(url);
        if (!res.ok) return {};
        const data = await res.json();
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
};
