/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { proxyLazy } from "@utils/lazy";
import { UserStore, zustandCreate } from "@webpack/common";
export const useSongStore = proxyLazy(() => zustandCreate(((set, get) => ({
    users: {},
    update({ userId, data, at }) {
        userId ??= UserStore.getCurrentUser()?.id;
        if (userId) {
            set({
                users: {
                    ...get().users,
                    [userId]: { data, at },
                },
            });
        }
        get().$refresh();
    },
    delete(userId) {
        userId ??= UserStore.getCurrentUser()?.id;
        if (userId) {
            const { [userId]: _, ...users } = get().users;
            set({ users });
        }
        get().$refresh();
    },
    $refresh() {
        set({
            self: get().users[UserStore.getCurrentUser()?.id],
        });
    },
}))));
