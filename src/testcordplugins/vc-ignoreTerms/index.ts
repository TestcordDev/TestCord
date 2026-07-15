/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "IgnoreTerms",
    description: "Ignore Discord's new terms of service",
    tags: ["Utility", "Privacy"],
    authors: [TestcordDevs.x2b],
    patches: [],

    closeModal(event) {
        event.transitionState = null;
        event.onClose();
        return null;
    }
});
