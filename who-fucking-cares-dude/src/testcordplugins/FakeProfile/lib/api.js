/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BASE_URL } from "./constants";
export const getEffects = async () => {
    try {
        const res = await fetch(BASE_URL + "/profile-effects");
        if (!res.ok)
            return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    }
    catch {
        return [];
    }
};
export const getBadges = async () => {
    try {
        const res = await fetch(BASE_URL + "/badges");
        if (!res.ok)
            return {};
        const data = await res.json();
        return data && typeof data === "object" ? data : {};
    }
    catch {
        return {};
    }
};
export const getPresets = async () => {
    try {
        const res = await fetch(BASE_URL + "/decorations");
        if (!res.ok)
            return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    }
    catch {
        return [];
    }
};
export const getUsers = async (ids) => {
    if (ids?.length === 0)
        return {};
    try {
        const url = new URL(BASE_URL + "/users");
        if (ids && ids.length !== 0)
            url.searchParams.set("ids", JSON.stringify(ids));
        const res = await fetch(url);
        if (!res.ok)
            return {};
        const data = await res.json();
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    }
    catch {
        return {};
    }
};
