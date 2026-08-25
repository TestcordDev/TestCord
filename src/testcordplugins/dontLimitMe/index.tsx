/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "DontLimitMe",
    description: "removes the limit on message sending. spam away! (Bannable)",
    tags: ["Utility", "Chat"],
    authors: [{ name: "Death", id: 1003477997728313405n }],
    patches: [
        {
            find: "cancelQueueMetricTimers",
            replacement: {
                match: /isFull\(\)\{return this\.queue\.length>=this\.maxSize\}/,
                replace: "isFull(){return false}"
            }
        }
    ]
});
