/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import definePlugin from "@utils/types";

import style from "./style.css?managed";

export default definePlugin({
    name: "Starfield",
    description: "A faint twinkling starfield drifting behind everything.",
    authors: [{ name: "Sharp", id: 0n }],
    tags: ["Appearance"],
    start: () => enableStyle(style),
    stop: () => disableStyle(style),
});
