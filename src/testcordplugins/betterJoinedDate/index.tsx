/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { SnowflakeUtils } from "@webpack/common";

function formatTimestamp(userId: string): string {
    const timestamp = SnowflakeUtils.extractTimestamp(userId);
    const date = new Date(timestamp);
    const daysAgo = Math.floor((Date.now() - timestamp) / 86400000);
    let text = date.toLocaleString();
    if (daysAgo === 0) text += " (Today)";
    else if (daysAgo === 1) text += " (Yesterday)";
    else text += ` (${daysAgo} days ago)`;
    return text;
}

export default definePlugin({
    name: "BetterJoinedDate",
    authors: [TestcordDevs.x2b],
    description: "Add a tooltip to the joined date showing the exact time and how many days ago it was",
    tags: ["Utility", "Appearance"],
    dependencies: ["ProfileSectionsAPI"],
    renderProfileSection: {
        render: ({ userId }) => {
            if (!userId) return null;
            return (
                <div style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    padding: "8px 16px",
                    textAlign: "center",
                    borderTop: "1px solid var(--profile-body-divider-color, var(--divider-color, var(--background-modifier-accent)))",
                    marginTop: 4,
                }}>
                    Account created: {formatTimestamp(userId)}
                </div>
            );
        },
        priority: -10,
    }
});
