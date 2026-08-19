/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export let EXTENSION_VERSION;
export let EXTENSION_BASE_URL;
export let RENDERER_CSS_URL;
let resolveMetaReady;
export const metaReady = new Promise(res => resolveMetaReady = res);
if (IS_EXTENSION) {
    const listener = (e) => {
        if (e.data?.type === "vencord:meta") {
            ({ EXTENSION_BASE_URL, EXTENSION_VERSION, RENDERER_CSS_URL } = e.data.meta);
            window.removeEventListener("message", listener);
            resolveMetaReady();
        }
    };
    window.addEventListener("message", listener);
}
