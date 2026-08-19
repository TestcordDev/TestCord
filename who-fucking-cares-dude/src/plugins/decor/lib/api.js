/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { API_URL } from "./constants";
import { useAuthorizationStore } from "./stores/AuthorizationStore";
export async function fetchApi(url, options) {
    const res = await fetch(url, {
        ...options,
        headers: {
            ...options?.headers,
            Authorization: `Bearer ${useAuthorizationStore.getState().token}`
        }
    });
    if (res.ok)
        return res;
    else
        throw new Error(await res.text());
}
export const getUsersDecorations = async (ids) => {
    if (ids?.length === 0)
        return {};
    const url = new URL(API_URL + "/users");
    if (ids && ids.length !== 0)
        url.searchParams.set("ids", JSON.stringify(ids));
    return await fetch(url).then(c => c.json());
};
export const getUserDecorations = async (id = "@me") => fetchApi(API_URL + `/users/${id}/decorations`).then(c => c.json());
export const getUserDecoration = async (id = "@me") => fetchApi(API_URL + `/users/${id}/decoration`).then(c => c.json());
export const setUserDecoration = async (decoration, id = "@me") => {
    const formData = new FormData();
    if (!decoration) {
        formData.append("hash", "null");
    }
    else if ("hash" in decoration) {
        formData.append("hash", decoration.hash);
    }
    else if ("file" in decoration) {
        formData.append("image", decoration.file);
        formData.append("alt", decoration.alt ?? "null");
    }
    return fetchApi(API_URL + `/users/${id}/decoration`, { method: "PUT", body: formData }).then(c => decoration && "file" in decoration ? c.json() : c.text());
};
export const getDecoration = async (hash) => fetch(API_URL + `/decorations/${hash}`).then(c => c.json());
export const deleteDecoration = async (hash) => {
    await fetchApi(API_URL + `/decorations/${hash}`, { method: "DELETE" });
};
export const getPresets = async () => fetch(API_URL + "/decorations/presets").then(c => c.json());
