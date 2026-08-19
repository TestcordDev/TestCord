/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { request } from "https";
// These links don't support CORS, so this has to be native
const validRedirectUrls = /^https:\/\/(spotify\.link|s\.team)\/.+$/;
function getRedirect(url) {
    return new Promise((resolve, reject) => {
        const req = request(new URL(url), { method: "HEAD" }, res => {
            resolve(res.headers.location
                ? getRedirect(res.headers.location)
                : url);
        });
        req.on("error", reject);
        req.end();
    });
}
export async function resolveRedirect(_, url) {
    if (!validRedirectUrls.test(url))
        return url;
    return getRedirect(url);
}
