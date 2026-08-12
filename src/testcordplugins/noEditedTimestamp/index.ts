/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MallCordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "NoEditedTimestamp",
    description: "Removes the '(edited)' label from all messages globally, not just your own.",
    authors: [MallCordDevs.Sharp],
    tags: ["Chat", "Utility"],

    patches: [
        {
            find: "#{intl::MESSAGE_EDITED_TIMESTAMP_A11Y_LABEL}",
            replacement: {
                match: /(\i)\.edited_timestamp(?=.{0,300}MESSAGE_EDITED_TIMESTAMP_A11Y_LABEL)/,
                replace: "null",
            },
            noWarn: true,
        },
    ],
});
