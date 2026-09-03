/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "ProfileCollectionsAPI",
    description: "API to add collections to the user profile panel like discords game collection.",
    authors: [Devs.thororen],
    patches: [
        {
            find: "n?.widgets!=null&&n.widgets.length>0",
            replacement: {
                match: /user:\i,widgets:\i\?\.\i+,onOpenUserProfileModal:\i\}\)/,
                replace: "$&,Vencord.Api.ProfileCollections.renderProfileCollections(arguments[0])",
            },
        },
        // user panel popout — inject after Discord's widgets component
        {
            find: '"UserProfileAccountPopout"',
            replacement: {
                match: /onOpenUserProfileModal:\i\}\)(?=,)/,
                replace: "$&,Vencord.Api.ProfileCollections.renderProfileCollections({user:t,displayProfile:h,isSideBar:false})",
            },
        },
        // dm sidebar
        {
            find: ".SIDEBAR,disableToolbar:",
            replacement: [
                {
                    match: /user:\i,widgets:.{0,100}?\}\),(?=.{0,100}user:\i,currentUser:\i)/,
                    replace: "$&arguments[0]?.isRedesignEnabled&&Vencord.Api.ProfileCollections.renderProfileCollections({...arguments[0],isSideBar:true}),"
                },
                {
                    match: /user:\i,widgets:.{0,100}?\}\),(?=.{0,100}unownedWishlistItems:\i,wishlistId:\i)/,
                    replace: "$&!arguments[0]?.isRedesignEnabled&&Vencord.Api.ProfileCollections.renderProfileCollections({...arguments[0],isSideBar:true}),"
                }
            ]
        }
    ]
});
