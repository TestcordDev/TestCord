/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import FriendCodesPanel from "./components/FriendCodesPanel";

export default definePlugin({
    name: "FriendCodes",
    description: "Generate FriendCodes to easily add friends",
    tags: ["Friends", "Utility"],
    authors: [TestcordDevs.x2b, TestcordDevs.nnenaza],
    patches: [],

    get FriendCodesPanel() {
        return <FriendCodesPanel />;
    }
});
