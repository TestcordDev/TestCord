/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { SnowflakeUtils, Tooltip } from "@webpack/common";

function addTooltip(element: React.ReactNode, timestamp: number) {
    const joinedDate = new Date(timestamp);
    const daysAgo = Math.floor((Date.now() - joinedDate.getTime()) / 86400000);
    let tooltipText = joinedDate.toLocaleString();
    if (daysAgo === 0) tooltipText += " (Today)";
    else if (daysAgo === 1) tooltipText += " (Yesterday)";
    else tooltipText += ` (${daysAgo} days ago)`;
    return (<Tooltip text={tooltipText}>
        {({ onMouseEnter, onMouseLeave }) => (
            <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
                {element}
            </div>
        )}
    </Tooltip>);
}

export default definePlugin({
    name: "BetterJoinedDate",
    authors: [TestcordDevs.x2b],
    description: "Add a tooltip to the joined date showing the exact time and how many days ago it was",
    tags: ["Utility", "Appearance"],
    patches: [{
        find: "user-profile-sidebar-heading-",
        replacement: [{
            match: /children:(0,\i\.jsx)\((\i\.A),\{userId:(\i)\.id\}\)/,
            replace: "children:$self.discord($1($2,{userId:$3.id}),$3.id)"
        }]
    }],
    discord(element: React.ReactNode, userId: string) {
        return addTooltip(element, SnowflakeUtils.extractTimestamp(userId));
    }
});
