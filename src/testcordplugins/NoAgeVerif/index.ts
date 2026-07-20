/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "TrustMeBro",
    description: "Bypasses Discord’s age verification required under the UK Online Safety Act.",
    tags: ["Privacy", "Utility"],
    authors: [{ name: "Menhera.st Team", id: 1325012503419420734n }],

    start() {
        const modules = Object.values((window as any).webpackChunkdiscord_app.push([[Symbol()], {}, (r: any) => r.c])) as any[];
        const userStore = modules.find((x: any) => x?.exports?.default?.getCurrentUser);
        const currentUser = userStore.exports.default.getCurrentUser();
        currentUser.ageVerificationStatus = 3;
    },

    stop() {},
});
