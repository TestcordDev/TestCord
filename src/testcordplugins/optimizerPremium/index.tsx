/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "optimizerPremium",
    description: "Legacy settings migration shim for TestcordOptimizer.",
    authors: [TestcordDevs.x2b, TestcordDevs.SirPhantom89],
    hidden: true
});
