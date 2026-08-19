/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Forms, GuildMemberStore, GuildRoleStore, PermissionsBits, React, useMemo, UserStore } from "@webpack/common";
export const PERM_LABELS = {
    ADMINISTRATOR: "Administrator",
    MANAGE_GUILD: "Manage Server",
    MANAGE_ROLES: "Manage Roles",
    MANAGE_CHANNELS: "Manage Channels",
    MANAGE_WEBHOOKS: "Manage Webhooks",
    MANAGE_GUILD_EXPRESSIONS: "Manage Expressions",
    MANAGE_NICKNAMES: "Manage Nicknames",
    KICK_MEMBERS: "Kick Members",
    BAN_MEMBERS: "Ban Members",
    VIEW_AUDIT_LOG: "View Audit Log",
    CREATE_INSTANT_INVITE: "Create Invite",
    CHANGE_NICKNAME: "Change Nickname",
    MENTION_EVERYONE: "Mention @everyone",
    MANAGE_MESSAGES: "Manage Messages",
    MUTE_MEMBERS: "Mute Members",
    DEAFEN_MEMBERS: "Deafen Members",
    MOVE_MEMBERS: "Move Members",
};
export function PermissionsTab({ guild }) {
    const me = UserStore.getCurrentUser();
    const myPerms = useMemo(() => {
        const member = GuildMemberStore.getMember?.(guild.id, me.id);
        if (!member)
            return 0n;
        if (guild.ownerId === me.id) {
            // Owner has all perms
            return BigInt("0xFFFFFFFFFFFFFFFF");
        }
        const rolesObj = GuildRoleStore.getRolesSnapshot(guild.id) ?? {};
        let total = 0n;
        const everyone = rolesObj[guild.id];
        if (everyone)
            total |= BigInt(everyone.permissions ?? 0);
        for (const rid of member.roles ?? []) {
            const r = rolesObj[rid];
            if (r)
                total |= BigInt(r.permissions ?? 0);
        }
        return total;
    }, [guild.id, me.id]);
    const isOwner = guild.ownerId === me.id;
    const isAdmin = (myPerms & BigInt(PermissionsBits?.ADMINISTRATOR ?? 0x8n)) !== 0n;
    const has = (bit) => {
        if (bit == null)
            return false;
        return (myPerms & BigInt(bit)) !== 0n || isAdmin || isOwner;
    };
    return (<div className="gt-perms">
            <Forms.FormSection title={`Your role in ${guild.name}`}>
                <div className="gt-perm-summary">
                    {isOwner && <span className="gt-pill gt-pill-good">Owner</span>}
                    {isAdmin && !isOwner && <span className="gt-pill gt-pill-good">Administrator</span>}
                    {!isOwner && !isAdmin && <span className="gt-pill">Regular member</span>}
                </div>
            </Forms.FormSection>

            <Forms.FormSection title="Permission breakdown">
                <div className="gt-perm-grid">
                    {Object.entries(PERM_LABELS).map(([key, label]) => {
            const bit = PermissionsBits?.[key];
            const ok = has(bit);
            return (<div key={key} className={`gt-perm-row ${ok ? "gt-perm-yes" : "gt-perm-no"}`}>
                                <span className="gt-perm-icon">{ok ? "✓" : "✗"}</span>
                                <span className="gt-perm-label">{label}</span>
                            </div>);
        })}
                </div>
            </Forms.FormSection>
        </div>);
}
