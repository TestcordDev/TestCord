/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
import { proxyLazy } from "@utils/lazy";
import { UserStore, zustandCreate } from "@webpack/common";
import { API_URL } from "../constants";
import { useAuthorizationStore } from "./AuthorizationStore";
export const useStreaksStore = proxyLazy(() => zustandCreate((set, get) => ({
    streaks: {},
    clear: () => set({ streaks: {} }),
    async fetch() {
        const { token } = useAuthorizationStore.getState();
        if (!token)
            return;
        try {
            const res = await fetch(`${API_URL}/streaks`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                const myId = UserStore.getCurrentUser()?.id;
                const streaksMap = {};
                for (const s of data) {
                    const otherId = s.user_a_id === myId ? s.user_b_id : s.user_a_id;
                    streaksMap[otherId] = s;
                }
                set({ streaks: streaksMap });
            }
        }
        catch (e) {
            console.error("Failed to fetch streaks", e);
        }
    },
    async update(recipientId) {
        const { token } = useAuthorizationStore.getState();
        if (!token)
            return;
        try {
            const res = await fetch(`${API_URL}/streaks/${recipientId}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const streak = await res.json();
                set({ streaks: { ...get().streaks, [recipientId]: streak } });
            }
        }
        catch (e) {
            console.error("Failed to update streak", e);
        }
    },
    async refresh(recipientId) {
        const { token } = useAuthorizationStore.getState();
        if (!token)
            return;
        try {
            const res = await fetch(`${API_URL}/streaks/${recipientId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const streak = await res.json();
                set({ streaks: { ...get().streaks, [recipientId]: streak } });
            }
        }
        catch (e) {
            console.error("Failed to refresh streak", e);
        }
    },
    async migrate() {
        const { token } = useAuthorizationStore.getState();
        if (!token)
            return;
        const legacyData = await DataStore.get("vc-streaks-data");
        if (!legacyData || Object.keys(legacyData).length === 0)
            return;
        try {
            const res = await fetch(`${API_URL}/streaks/migrate`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(legacyData)
            });
            if (res.ok) {
                await DataStore.del("vc-streaks-data");
                console.log("Successfully migrated local streaks to API");
            }
        }
        catch (e) {
            console.error("Failed to migrate streaks", e);
        }
    }
})));
