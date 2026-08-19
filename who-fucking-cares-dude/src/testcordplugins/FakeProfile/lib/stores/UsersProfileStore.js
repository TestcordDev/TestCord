/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { addProfileBadge, removeProfileBadge } from "@api/Badges";
import { debounce } from "@shared/debounce";
import { proxyLazy } from "@utils/lazy";
import { useEffect, zustandCreate } from "@webpack/common";
import { settings } from "../../settings";
import { getBadges, getEffects, getPresets, getUsers } from "../api";
import { FETCH_COOLDOWN } from "../constants";
const USERS_CACHE_MAX = 1000;
const FETCH_QUEUE_MAX = 250;
function pruneUsers(users) {
    while (users.size > USERS_CACHE_MAX) {
        const oldest = users.keys().next().value;
        if (!oldest)
            break;
        users.delete(oldest);
    }
}
function capFetchQueue(fetchQueue) {
    while (fetchQueue.size > FETCH_QUEUE_MAX) {
        const oldest = fetchQueue.values().next().value;
        if (!oldest)
            break;
        fetchQueue.delete(oldest);
    }
    return fetchQueue;
}
export const useUsersProfileStore = proxyLazy(() => zustandCreate((set, get) => ({
    users: new Map(),
    decorations: new Map(),
    profileEffects: new Map(),
    badges: new Map(),
    addedBadges: [],
    decorationsFetched: false,
    fetchBadges: debounce(async () => {
        if (!settings.store.enableCustomBadges)
            return;
        const { addedBadges } = get();
        addedBadges.forEach(badge => removeProfileBadge(badge));
        try {
            const fetchedBadges = await getBadges();
            if (!fetchedBadges || typeof fetchedBadges !== "object" || Array.isArray(fetchedBadges))
                return;
            const newBadges = new Map(Object.entries(fetchedBadges).map(([key, value]) => [key, value]));
            const newAddedBadges = [];
            newBadges.forEach((userBadges, userId) => {
                if (Array.isArray(userBadges)) {
                    userBadges.forEach((badge, index) => {
                        const iconSrc = typeof badge.badge === "string" ? badge.badge.trim() : "";
                        if (!iconSrc)
                            return;
                        const description = typeof badge.tooltip === "string" && badge.tooltip.length
                            ? badge.tooltip
                            : "fakeProfile badge";
                        const newBadge = {
                            id: badge.badge_id ?? `fakeprofile-${userId}-${index}`,
                            iconSrc,
                            description,
                            position: 0 /* BadgePosition.START */,
                            shouldShow: ({ userId: badgeUserId }) => badgeUserId === userId,
                        };
                        addProfileBadge(newBadge);
                        newAddedBadges.push(newBadge);
                    });
                }
            });
            set({
                badges: newBadges,
                addedBadges: newAddedBadges,
            });
        }
        catch (e) {
            console.error("[FakeProfile] Failed to fetch badges:", e);
        }
    }),
    fetchProfileEffects: debounce(async () => {
        try {
            const fetchedProfileEffects = await getEffects();
            if (!Array.isArray(fetchedProfileEffects))
                return;
            const newProfileEffects = new Map(fetchedProfileEffects.flatMap(effect => {
                if (!effect || typeof effect !== "object")
                    return [];
                return [
                    [effect.skuId, effect],
                    [effect.id, effect]
                ];
            }));
            set({
                profileEffects: newProfileEffects,
            });
        }
        catch (e) {
            console.error("[FakeProfile] Failed to fetch profile effects:", e);
        }
    }),
    fetchDecorations: debounce(async () => {
        try {
            const fetchedDecorations = await getPresets();
            if (!Array.isArray(fetchedDecorations)) {
                set({ decorationsFetched: true });
                return;
            }
            const newDecorations = new Map(fetchedDecorations.map(decoration => [decoration.asset, decoration]));
            set({
                decorations: newDecorations,
                decorationsFetched: true,
            });
        }
        catch (e) {
            console.error("[FakeProfile] Failed to fetch decorations:", e);
            set({ decorationsFetched: true });
        }
    }),
    fetchQueue: new Set(),
    bulkFetch: debounce(async () => {
        const { fetchQueue, users } = get();
        if (fetchQueue.size === 0)
            return;
        set({ fetchQueue: new Set() });
        const fetchIds = [...fetchQueue];
        try {
            const fetchedUsers = await getUsers(fetchIds);
            if (!fetchedUsers || typeof fetchedUsers !== "object")
                return;
            const newUsers = new Map(users);
            for (const fetchId of fetchIds) {
                const newUser = fetchedUsers[fetchId] ?? null;
                newUsers.set(fetchId, newUser);
            }
            pruneUsers(newUsers);
            set({ users: newUsers });
        }
        catch (e) {
            console.error("[FakeProfile] Failed to bulk fetch users:", e);
        }
    }),
    async fetch(userId, force = false) {
        const { users, fetchQueue, bulkFetch } = get();
        const { fetchedAt } = users.get(userId) ?? {};
        if (fetchedAt) {
            if (!force && Date.now() - fetchedAt.getTime() < FETCH_COOLDOWN)
                return;
        }
        set({ fetchQueue: capFetchQueue(new Set(fetchQueue).add(userId)) });
        bulkFetch();
    },
    async fetchMany(userIds) {
        if (!userIds.length)
            return;
        const { users, fetchQueue, bulkFetch } = get();
        const newFetchQueue = new Set(fetchQueue);
        const now = Date.now();
        for (const userId of userIds) {
            const { fetchedAt } = users.get(userId) ?? {};
            if (fetchedAt) {
                if (now - fetchedAt.getTime() < FETCH_COOLDOWN)
                    continue;
            }
            newFetchQueue.add(userId);
        }
        set({ fetchQueue: capFetchQueue(newFetchQueue) });
        bulkFetch();
    },
    get(userId) {
        const user = get().users.get(userId);
        return user && typeof user === "object" ? user : undefined;
    },
    getDecorAsset(userId) {
        const user = get().users.get(userId);
        if (!user || typeof user !== "object")
            return undefined;
        const d = user.decoration;
        if (!d)
            return undefined;
        return typeof d === "string" ? d : d.asset;
    },
    getEffectAsset(userId) {
        const user = get().users.get(userId);
        return user && typeof user === "object" ? user.profileEffectId : undefined;
    },
    set(userId, data) {
        const { users } = get();
        const newUsers = new Map(users);
        newUsers.set(userId, { ...data, fetchedAt: new Date() });
        pruneUsers(newUsers);
        set({ users: newUsers });
    }
})));
export function useUserAvatarDecoration(user) {
    const avatarDecoration = useUsersProfileStore(state => user ? state.getDecorAsset(user.id) : undefined);
    const decoration = useUsersProfileStore(state => avatarDecoration ? state.decorations.get(avatarDecoration) : undefined);
    const decorationsFetched = useUsersProfileStore(state => state.decorationsFetched);
    useEffect(() => {
        if (!user)
            return;
        useUsersProfileStore.getState().fetch(user.id);
    }, [user?.id]);
    useEffect(() => {
        if (avatarDecoration && !decoration && !decorationsFetched) {
            useUsersProfileStore.getState().fetchDecorations();
        }
    }, [avatarDecoration, decoration, decorationsFetched]);
    if (!avatarDecoration)
        return null;
    return decoration ? { asset: avatarDecoration, skuId: decoration.skuId, animated: decoration.animated } : null;
}
