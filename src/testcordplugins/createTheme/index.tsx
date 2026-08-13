/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "CreateTheme",
    description: "Create Theme UI — registered via settings.tsx",
    authors: [Devs.Ven],
    tags: ["Utility"],
    required: false,
});
