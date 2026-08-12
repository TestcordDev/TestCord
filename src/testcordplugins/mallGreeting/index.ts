/*
 * MallCord, a vaporwave-inspired Discord client mod
 * Copyright (c) 2026 unfamiliardev
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MallCordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

export default definePlugin({
    name: "MallGreeting",
    description: "Greets you with a cozy vaporwave toast every time MallCord starts up.",
    authors: [MallCordDevs.Sharp],
    start() {
        showToast("✦ﾟ｡ welcome back to the mall ｡ﾟ✦", Toasts.Type.MESSAGE);
    }
});
