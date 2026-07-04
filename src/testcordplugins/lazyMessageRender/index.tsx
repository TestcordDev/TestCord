/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle, setStyleClassNames } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";

import style from "./style.css?managed";

const classes = findCssClassesLazy("messageListItem");

export default definePlugin({
    name: "LazyMessageRender",
    description: "Prevents message action toolbar from clipping under the message above. content-visibility was removed — Discord's virtualized scroller mis-measures contained rows after recent updates.",
    authors: [TestcordDevs.x2b],

    start() {
        setStyleClassNames(style, { messageListItem: classes.messageListItem });
        enableStyle(style);
    },

    stop() {
        disableStyle(style);
    }
});
