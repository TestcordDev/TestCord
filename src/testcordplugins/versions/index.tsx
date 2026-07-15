/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import gitRemote from "~git-remote";

export default definePlugin({
    name: "Versions",
    description: "Adds extra information to the version info",
    tags: ["Utility", "Developers"],
    authors: [TestcordDevs.x2b],

    patches: [],

    makeInfoElements(Component: React.ComponentType<React.PropsWithChildren>, props: React.PropsWithChildren) {
        const versions = VencordNative.native.getVersions();
        return (
            <>
                {versions.node && <Component {...props}>Node {versions.node}</Component>}
                <Component {...props}>{gitRemote}</Component>
            </>
        );
    }
});
