/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle, setStyleClassNames } from "@api/Styles";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";

import style from "./style.css?managed";

const classes = findCssClassesLazy("sidebar", "membersWrap", "members");

export default definePlugin({
    name: "GlassPanels",
    description: "Frosted-glass blur on the sidebar and member list.",
    authors: [{ name: "Sharp", id: 0n }],
    start() {
        setStyleClassNames(style, {
            sidebar: classes.sidebar,
            membersWrap: classes.membersWrap,
            members: classes.members,
        });
        enableStyle(style);
    },
    stop: () => disableStyle(style),
});
