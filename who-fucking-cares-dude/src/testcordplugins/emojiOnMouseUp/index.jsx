/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 sadan
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
export default definePlugin({
    name: "EmojiOnMouseUp",
    description: "Sends the emoji you are hovering when you take your mouse button up.",
    tags: ["Emotes", "Utility"],
    authors: [TestcordDevs.x2b],
    patches: [
        {
            find: ".customItem;",
            replacement: {
                match: /onClick:(\i\?void 0:\i)/,
                replace: "$&,onMouseUp:$1"
            }
        }
    ]
});
