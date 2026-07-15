/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "ProfileSectionsAPI",
    description: "API to add sections near the 'Member Since' area of user profile panels.",
    authors: [Devs.thororen],
    patches: [
        // dm user sidebar
        {
            find: "SIDEBAR,disableToolbar:",
            replacement: {
                match: /(a6XYD9\),headingColor:"text-strong",children:\(0,\i\.jsx\)\(\i\.A,\{userId:(\i\.id)\}\)\}\))/,
                replace: "$1,Vencord.Api.ProfileSections.renderProfileSections({userId:$2,isSideBar:true})"
            }
        },
        // user profile modal v2
        {
            find: "MODAL_V2,onClose:",
            replacement: {
                match: /(a6XYD9\),children:\(0,\i\.jsx\)\(\i\.\i,\{userId:(\i\.id),guildId:\i\?\.guildId,tooltipDelay:\i\.\i\}\)\})/,
                replace: "$1,Vencord.Api.ProfileSections.renderProfileSections({userId:$2,isSideBar:false})"
            }
        }
    ]
});
