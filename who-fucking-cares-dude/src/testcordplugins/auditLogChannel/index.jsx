/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import AuditLogChannelRow from "./components/AuditLogChannelRow";
import AuditLogPage from "./components/AuditLogPage";
import AuditLogPageWrapper from "./components/AuditLogPageWrapper";
export default definePlugin({
    name: "AuditLogChannel",
    description: "Adds an audit log channel",
    tags: ["Servers", "Utility"],
    authors: [TestcordDevs.x2b],
    patches: [
        {
            // Inject option into list of special channels
            find: ".GUILD_NEW_MEMBER_ACTIONS_PROGRESS_BAR):",
            group: true,
            replacement: [
                {
                    match: /(\i)\.push\(\i\.\i\.GUILD_MOD_DASH_MEMBER_SAFETY\),/,
                    replace: '$&$1.push("audit-log"),'
                }
            ]
        },
        {
            // Render button
            find: 'this,"updateChannelListScroll",',
            replacement: {
                match: /case \i\.\i\.GUILD_MOD_DASH_MEMBER_SAFETY(:.{0,30}?jsx\)\()\i\.\i(,.{0,30}?)\i\.\i\.MEMBER_SAFETY},\i\.\i\.GUILD_MOD_DASH_MEMBER_SAFETY\);/,
                replace: '$&case "audit-log"$1$self.AuditLogChannelRow$2"audit-log"},"audit-log");'
            }
        },
        {
            // Render page
            find: "app view user trigger debugging",
            replacement: {
                match: /case \i\.\i\.MEMBER_SAFETY(:.{0,20}?jsx\)\()\i(,.{0,20}?;)/,
                replace: '$&case "audit-log"$1$self.AuditLogPageWrapper$2'
            }
        },
        {
            // Mark this route as valid at /channels/:guildId/audit-log
            find: 'MEMBER_SAFETY="member-safety"',
            replacement: {
                match: /(\i)\.MEMBER_SAFETY="member-safety"/,
                replace: '$&,$1.AUDIT_LOG="audit-log"'
            }
        },
        {
            find: "!this.props.showLoadMore&&this.props.logs.length",
            replacement: {
                match: /(\i)\.\i=\i\.\i\.connectStores\(.{0,600}?}}\)\((\i)/,
                replace: "$1.vcAuditLogComponent=$2;$&"
            }
        }
    ],
    AuditLogChannelRow,
    AuditLogPage,
    AuditLogPageWrapper,
});
