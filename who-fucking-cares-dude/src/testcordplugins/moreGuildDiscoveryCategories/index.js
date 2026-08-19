/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findExportedComponentLazy } from "@webpack";
export default definePlugin({
    name: "MoreGuildDiscoveryCategories",
    authors: [TestcordDevs.x2b],
    description: "Show all guild discovery categories in the sidebar",
    tags: ["Servers", "Utility"],
    patches: [
        {
            find: "DISCOVERY_SIDEBAR_CATEGORIES.",
            replacement: {
                match: /\i\.DISCOVERY_SIDEBAR_CATEGORIES(\.slice\(1\)|\.map\(\i=>\i\.find\(\i=>\i\.categoryId===\i\)\))/g,
                replace: "this.getAllCategories()",
            },
        },
        // Use the "Discover" icon for only the home page
        {
            find: "CategoryIcons.Discover:",
            replacement: [
                {
                    match: /(switch\()(\i)(\).{0,100}case\s\i\.CategoryIcons\.Discover:.{0,20})(\i\.default),/,
                    replace: "$1$2.icon$3($2.categoryId===-1?$4:$self.UnknownCategoryIcon),"
                },
                {
                    match: /\.assertNever\)\((\i)\)/,
                    replace: ".assertNever)($1.icon)"
                },
                {
                    match: /(categories:.{0,100}return.{0,100}avatar:\i\(\i)\.icon/,
                    replace: "$1"
                }
            ]
        }
    ],
    UnknownCategoryIcon: findExportedComponentLazy("CircleQuestionIcon")
});
