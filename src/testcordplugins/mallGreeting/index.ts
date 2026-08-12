/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

export default definePlugin({
    name: "MallGreeting",
    description: "Greets you with a cozy vaporwave toast every time MallCord starts up.",
    authors: [{ name: "Sharp", id: 0n }],
    start() {
        showToast("✦ﾟ｡ welcome back to the mall ｡ﾟ✦", Toasts.Type.MESSAGE);
    }
});
