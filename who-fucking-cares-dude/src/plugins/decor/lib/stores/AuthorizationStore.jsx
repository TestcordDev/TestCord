/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as DataStore from "@api/DataStore";
import { AUTHORIZE_URL, CLIENT_ID } from "@plugins/decor/lib/constants";
import { proxyLazy } from "@utils/lazy";
import { Logger } from "@utils/Logger";
import { OAuth2AuthorizeModal, openModal, showToast, Toasts, UserStore, zustandCreate, zustandPersist } from "@webpack/common";
const indexedDBStorage = {
    async getItem(name) {
        return DataStore.get(name).then(v => v ?? null);
    },
    async setItem(name, value) {
        await DataStore.set(name, value);
    },
    async removeItem(name) {
        await DataStore.del(name);
    },
};
// TODO: Move switching accounts subscription inside the store?
export const useAuthorizationStore = proxyLazy(() => zustandCreate(zustandPersist((set, get) => ({
    token: null,
    tokens: {},
    init: () => { set({ token: get().tokens[UserStore.getCurrentUser().id] ?? null }); },
    setToken: (token) => set({ token, tokens: { ...get().tokens, [UserStore.getCurrentUser().id]: token } }),
    remove: (id) => {
        const { tokens, init } = get();
        const newTokens = { ...tokens };
        delete newTokens[id];
        set({ tokens: newTokens });
        init();
    },
    async authorize() {
        return new Promise((resolve, reject) => openModal(props => <OAuth2AuthorizeModal {...props} scopes={["identify"]} responseType="code" redirectUri={AUTHORIZE_URL} permissions={0n} clientId={CLIENT_ID} cancelCompletesFlow={false} callback={async (response) => {
                try {
                    const url = new URL(response.location);
                    url.searchParams.append("client", "vencord");
                    const req = await fetch(url);
                    if (req?.ok) {
                        const token = await req.text();
                        get().setToken(token);
                    }
                    else {
                        throw new Error("Request not OK");
                    }
                    resolve(void 0);
                }
                catch (e) {
                    if (e instanceof Error) {
                        showToast(`Failed to authorize: ${e.message}`, Toasts.Type.FAILURE);
                        new Logger("Decor").error("Failed to authorize", e);
                        reject(e);
                    }
                }
            }}/>, {
            onCloseCallback() {
                reject(new Error("Authorization cancelled"));
            },
        }));
    },
    isAuthorized: () => !!get().token,
}), {
    name: "decor-auth",
    storage: indexedDBStorage,
    partialize: state => ({ tokens: state.tokens }),
    onRehydrateStorage: () => state => state?.init()
})));
