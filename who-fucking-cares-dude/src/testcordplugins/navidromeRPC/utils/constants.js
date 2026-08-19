/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { classNameFactory } from "@api/Styles";
import { localStorage } from "@utils/localStorage";
import { ApplicationAssetUtils } from "@webpack/common";
export const cl = classNameFactory("vc-navidrome-rpc-");
export async function checkCSP(url) {
    if (VencordNative.csp.isDomainAllowed) {
        return (await VencordNative.csp.isDomainAllowed(url, ["connect-src"]));
    }
    return true;
}
export const navidromePassword = {
    get: () => localStorage.getItem(cl("password")) || "",
    set: (p) => localStorage.setItem(cl("password"), p)
};
export async function getApplicationAsset(key) {
    return (await ApplicationAssetUtils.fetchAssetIds("1396969056136986775", [key]))[0];
}
