/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { proxyLazy } from "@utils/lazy";
import { UserStore, zustandCreate, zustandPersist } from "@webpack/common";
export const useAuthorizationStore = proxyLazy(() => zustandCreate(zustandPersist(((set, get) => ({
    tokens: {},
    getToken() {
        return get().tokens[UserStore.getCurrentUser()?.id];
    },
    setToken(access, refresh) {
        const userId = UserStore.getCurrentUser()?.id;
        if (userId) {
            set({
                tokens: {
                    ...get().tokens,
                    [userId]: { access, refresh },
                },
            });
        }
    },
    deleteTokens() {
        set({ tokens: {} });
    },
    isAuthorized() {
        return !!get().getToken();
    },
})), {
    name: "songspotlight-auth",
    version: 1,
    migrate(persisted, version) {
        if (version === 0) {
            persisted.tokens = Object.fromEntries(Object.entries(persisted.tokens).map(([userId, access]) => [userId, {
                    access,
                    refresh: "",
                }]));
        }
        return persisted;
    },
    storage: {
        async getItem(name) {
            return (await DataStore.get(name)) ?? null;
        },
        async setItem(name, value) {
            return await DataStore.set(name, value);
        },
        async removeItem(name) {
            return await DataStore.del(name);
        },
    },
    partialize: ({ tokens }) => ({ tokens }),
})));
