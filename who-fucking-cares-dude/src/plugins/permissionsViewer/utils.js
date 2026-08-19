/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { classNameFactory } from "@utils/css";
import { extractAndLoadChunksLazy, findByPropsLazy } from "@webpack";
import { GuildRoleStore } from "@webpack/common";
import { settings } from ".";
export const loadGetGuildPermissionSpecMap = extractAndLoadChunksLazy([".PRIMARY,badgeTooltipDelay:"]);
export const { getGuildPermissionSpecMap } = findByPropsLazy("getGuildPermissionSpecMap");
export const cl = classNameFactory("vc-permviewer-");
export function getSortedRolesForMember({ id: guildId }, member) {
    // The guild id is the @everyone role
    return GuildRoleStore
        .getSortedRoles(guildId)
        .filter(role => role.id === guildId || member.roles.includes(role.id));
}
export function sortUserRoles(roles) {
    switch (settings.store.permissionsSortOrder) {
        case 0 /* PermissionsSortOrder.HighestRole */:
            return roles.sort((a, b) => b.position - a.position);
        case 1 /* PermissionsSortOrder.LowestRole */:
            return roles.sort((a, b) => a.position - b.position);
        default:
            return roles;
    }
}
export function sortPermissionOverwrites(overwrites, guildId) {
    const roles = GuildRoleStore.getRolesSnapshot(guildId);
    return overwrites.sort((a, b) => {
        if (a.type !== 0 /* PermissionOverwriteType.ROLE */ || b.type !== 0 /* PermissionOverwriteType.ROLE */)
            return 0;
        const roleA = roles[a.id];
        const roleB = roles[b.id];
        const posA = roleA?.position ?? -Infinity;
        const posB = roleB?.position ?? -Infinity;
        return posB - posA;
    });
}
