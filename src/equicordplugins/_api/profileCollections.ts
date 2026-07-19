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
            find: "SIDEBAR,disableToolbar:",
            replacement: {
                match: /widgets:\i\.widgets,onOpenUserProfileModal:\i\}\)\}\)(?=,)/,
                replace: "$&,Vencord.Api.ProfileCollections.renderProfileCollectionsForUser(n.id,true)"
            }
        },
        // user profile popout — message/member list popup
        {
            find: '"UserProfilePopout"',
            replacement: {
                match: /onOpenUserProfileModal:\i}\)(?=,)/,
                replace: "$&,Vencord.Api.ProfileCollections.renderProfileCollections({user:i,displayProfile:n,isSideBar:false})"
            }
        }
    ]
});
