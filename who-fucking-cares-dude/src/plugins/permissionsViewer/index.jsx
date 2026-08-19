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
import "./styles.css";
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { SafetyIcon } from "@components/Icons";
import { TooltipContainer } from "@components/TooltipContainer";
import { Devs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { Button, ChannelStore, Dialog, GuildMemberStore, GuildRoleStore, GuildStore, match, Menu, PermissionsBits, Popout, useEffect, useRef, UserStore } from "@webpack/common";
import openRolesAndUsersPermissionsModal from "./components/RolesAndUsersPermissions";
import UserPermissions from "./components/UserPermissions";
import { getSortedRolesForMember, loadGetGuildPermissionSpecMap, sortPermissionOverwrites } from "./utils";
const PopoutClasses = findCssClassesLazy("container", "popoutRoleDot");
export const settings = definePluginSettings({
    permissionsSortOrder: {
        description: "The sort method used for defining which role grants an user a certain permission",
        type: 4 /* OptionType.SELECT */,
        options: [
            { label: "Highest Role", value: 0 /* PermissionsSortOrder.HighestRole */, default: true },
            { label: "Lowest Role", value: 1 /* PermissionsSortOrder.LowestRole */ }
        ]
    },
});
function MenuItem(guildId, id, type) {
    if (type === 0 /* MenuItemParentType.User */ && !GuildMemberStore.isMember(guildId, id))
        return null;
    return (<Menu.MenuItem id="perm-viewer-permissions" label="Permissions" action={() => {
            const guild = GuildStore.getGuild(guildId);
            const { permissions, header } = match(type)
                .returnType()
                .with(0 /* MenuItemParentType.User */, () => {
                const member = GuildMemberStore.getMember(guildId, id);
                const permissions = getSortedRolesForMember(guild, member)
                    .map(role => ({
                    type: 0 /* PermissionOverwriteType.ROLE */,
                    ...role
                }));
                if (guild.ownerId === id) {
                    permissions.push({
                        type: 2 /* PermissionOverwriteType.OWNER */,
                        permissions: Object.values(PermissionsBits).reduce((prev, curr) => prev | curr, 0n)
                    });
                }
                return {
                    permissions,
                    header: member.nick ?? UserStore.getUser(member.userId).username
                };
            })
                .with(1 /* MenuItemParentType.Channel */, () => {
                const channel = ChannelStore.getChannel(id);
                const permissions = sortPermissionOverwrites(Object.values(channel.permissionOverwrites).map(({ id, allow, deny, type }) => ({
                    type,
                    id,
                    overwriteAllow: allow,
                    overwriteDeny: deny
                })), guildId);
                return {
                    permissions,
                    header: channel.name
                };
            })
                .otherwise(() => {
                const permissions = GuildRoleStore.getSortedRoles(guild.id).map(role => ({
                    type: 0 /* PermissionOverwriteType.ROLE */,
                    ...role
                }));
                return {
                    permissions,
                    header: guild.name
                };
            });
            openRolesAndUsersPermissionsModal(permissions, guild, header);
        }}/>);
}
function makeContextMenuPatch(childId, type) {
    return (children, props) => {
        if (!props ||
            (type === 0 /* MenuItemParentType.User */ && !props.user) ||
            (type === 2 /* MenuItemParentType.Guild */ && !props.guild) ||
            (type === 1 /* MenuItemParentType.Channel */ && (!props.channel || !props.guild))) {
            return;
        }
        const group = findGroupChildrenByChildId(childId, children);
        const item = match(type)
            .with(0 /* MenuItemParentType.User */, () => MenuItem(props.guildId, props.user.id, type))
            .with(1 /* MenuItemParentType.Channel */, () => MenuItem(props.guild.id, props.channel.id, type))
            .with(2 /* MenuItemParentType.Guild */, () => MenuItem(props.guild.id))
            .otherwise(() => null);
        if (item == null)
            return;
        if (group) {
            return group.push(item);
        }
        // "roles" may not be present due to the member not having any roles. In that case, add it above "Copy ID"
        if (childId === "roles" && props.guildId) {
            children.splice(-1, 0, <Menu.MenuGroup>{item}</Menu.MenuGroup>);
        }
    };
}
export default definePlugin({
    name: "PermissionsViewer",
    description: "View the permissions a user or channel has, and the roles of a server",
    tags: ["Servers", "Roles", "Utility"],
    authors: [Devs.Nuckyz, Devs.Ven],
    settings,
    patches: [
        {
            find: "#{intl::COLLAPSE_ROLES}",
            replacement: {
                match: /(?<=\i\.id\)\),\i\(\))(?=,\i\?)/,
                replace: ",$self.ViewPermissionsButton(arguments[0])"
            }
        }
    ],
    ViewPermissionsButton: ErrorBoundary.wrap(({ className, guild, userId }) => {
        const buttonRef = useRef(null);
        useEffect(() => void loadGetGuildPermissionSpecMap(), []);
        const guildMember = GuildMemberStore.getMember(guild.id, userId);
        if (!guildMember)
            return null;
        return (<Popout position="bottom" align="center" targetElementRef={buttonRef} renderPopout={({ closePopout }) => (<Dialog className={PopoutClasses.container} style={{ width: "500px" }}>
                        <UserPermissions guild={guild} guildMember={guildMember} closePopout={closePopout}/>
                    </Dialog>)}>
                {popoutProps => (<TooltipContainer text="View Permissions">
                        <Button {...popoutProps} ref={buttonRef} color={Button.Colors.CUSTOM} look={Button.Looks.FILLED} size={Button.Sizes.NONE} className={classes(className, "vc-permviewer-role-button")}>
                            <SafetyIcon height="16" width="16"/>
                        </Button>
                    </TooltipContainer>)}
            </Popout>);
    }, { noop: true }),
    contextMenus: {
        "user-context": makeContextMenuPatch("roles", 0 /* MenuItemParentType.User */),
        "channel-context": makeContextMenuPatch(["mute-channel", "unmute-channel"], 1 /* MenuItemParentType.Channel */),
        "guild-context": makeContextMenuPatch("privacy", 2 /* MenuItemParentType.Guild */),
        "guild-header-popout": makeContextMenuPatch("privacy", 2 /* MenuItemParentType.Guild */)
    }
});
