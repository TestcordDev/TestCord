/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "NightcordPort",
    description: "Marks userplugins ported from Nightcord.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    required: true,
    enabledByDefault: true,

    isNightcordPlugin(name: string) {
        return name === "LarpCord" || name === "StreamProofEnhanched";
    }
});
