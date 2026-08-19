/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { LogIcon } from "@components/Icons";
import { getIntlMessage } from "@utils/discord";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { GuildStore, NavigationRouter, PermissionsBits, PermissionStore, UserStore, useStateFromStores } from "@webpack/common";
const ChannelRow = findComponentByCodeLazy(".basicChannelRowLink,");
const Routes = findByPropsLazy("INDEX", "FRIENDS", "ME");
export default function AuditLogChannelRow(props) {
    const canViewAuditLog = useStateFromStores([GuildStore, UserStore, PermissionStore], () => PermissionStore.canWithPartialContext(PermissionsBits.VIEW_AUDIT_LOG, { guildId: props.guild.id }), [props.guild.id]);
    if (!canViewAuditLog)
        return null;
    return <ChannelRow id={`audit-log-${props.guild.id}`} renderIcon={(className) => <LogIcon className={className}/>} text={getIntlMessage("AUDIT_LOG")} selected={props.selected} showUnread={false} onClick={() => {
            NavigationRouter.transitionTo(Routes.CHANNEL(props.guild.id, "audit-log"));
        }}/>;
}
