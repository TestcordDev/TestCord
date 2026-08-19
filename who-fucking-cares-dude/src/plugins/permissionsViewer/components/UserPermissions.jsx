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
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingTertiary } from "@components/Heading";
import { cl, getGuildPermissionSpecMap, getSortedRolesForMember, sortUserRoles } from "@plugins/permissionsViewer/utils";
import { getIntlMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import { findCssClassesLazy } from "@webpack";
import { PermissionsBits, Tooltip, useMemo, UserStore } from "@webpack/common";
import { settings } from "..";
import openRolesAndUsersPermissionsModal from "./RolesAndUsersPermissions";
const RoleClasses = findCssClassesLazy("role", "roleName", "roleRemoveButton", "roleNameOverflow", "root");
const RoleBorderClasses = findCssClassesLazy("roleCircle", "dot", "dotBorderColor");
function FakeRole({ text, color, ...props }) {
    return (<div {...props} className={classes(RoleClasses.role)}>
            <div className={RoleClasses.roleRemoveButton}>
                <span className={RoleBorderClasses.roleCircle} style={{ backgroundColor: color }}/>
            </div>
            <div className={RoleClasses.roleName}>
                <BaseText size="xs" weight="medium" className={RoleClasses.roleNameOverflow}>
                    {text}
                </BaseText>
            </div>
        </div>);
}
function GrantedByTooltip({ roleName, roleColor }) {
    return (<>
            <BaseText size="sm">Granted By</BaseText>
            <FakeRole text={roleName} color={roleColor}/>
        </>);
}
function UserPermissionsComponent({ guild, guildMember, closePopout }) {
    const { permissionsSortOrder } = settings.use(["permissionsSortOrder"]);
    const guildPermissionSpecMap = useMemo(() => getGuildPermissionSpecMap(guild), [guild.id]);
    const [rolePermissions, userPermissions] = useMemo(() => {
        const userPermissions = [];
        const userRoles = getSortedRolesForMember(guild, guildMember);
        const rolePermissions = userRoles.map(role => ({
            type: 0 /* PermissionOverwriteType.ROLE */,
            ...role
        }));
        if (guild.ownerId === guildMember.userId) {
            rolePermissions.push({
                type: 2 /* PermissionOverwriteType.OWNER */,
                permissions: Object.values(PermissionsBits).reduce((prev, curr) => prev | curr, 0n)
            });
            const OWNER = getIntlMessage("GUILD_OWNER") ?? "Server Owner";
            userPermissions.push({
                permission: OWNER,
                roleName: "Owner",
                roleColor: "var(--primary-300)",
                rolePosition: Infinity
            });
        }
        sortUserRoles(userRoles);
        for (const bit of Object.values(PermissionsBits)) {
            for (const { permissions, colorString, position, name } of userRoles) {
                if ((permissions & bit) === bit) {
                    userPermissions.push({
                        permission: guildPermissionSpecMap[String(bit)].title,
                        roleName: name,
                        roleColor: colorString || "var(--primary-300)",
                        rolePosition: position
                    });
                    break;
                }
            }
        }
        userPermissions.sort((a, b) => b.rolePosition - a.rolePosition);
        return [rolePermissions, userPermissions];
    }, [permissionsSortOrder]);
    return <div>
        <div className={cl("user-header-container")}>
            <HeadingTertiary>Permissions</HeadingTertiary>
            <div className={cl("user-header-btns")}>
                <Tooltip text={`Sorting by ${permissionsSortOrder === 0 /* PermissionsSortOrder.HighestRole */ ? "Highest Role" : "Lowest Role"}`}>
                    {tooltipProps => (<div {...tooltipProps} className={cl("user-header-btn")} role="button" tabIndex={0} onClick={() => {
                settings.store.permissionsSortOrder = permissionsSortOrder === 0 /* PermissionsSortOrder.HighestRole */ ? 1 /* PermissionsSortOrder.LowestRole */ : 0 /* PermissionsSortOrder.HighestRole */;
            }}>
                            <svg width="24" height="24" viewBox="0 96 960 960" transform={permissionsSortOrder === 0 /* PermissionsSortOrder.HighestRole */ ? "scale(1 1)" : "scale(1 -1)"}>
                                <path fill="var(--text-default)" d="M440 896V409L216 633l-56-57 320-320 320 320-56 57-224-224v487h-80Z"/>
                            </svg>
                        </div>)}
                </Tooltip>
                <Tooltip text="Role Details">
                    {tooltipProps => (<div {...tooltipProps} className={cl("user-header-btn")} role="button" tabIndex={0} onClick={() => {
                closePopout();
                openRolesAndUsersPermissionsModal(rolePermissions, guild, guildMember.nick || UserStore.getUser(guildMember.userId).username);
            }}>
                            <svg width="24" height="24" viewBox="0 0 24 24">
                                <path fill="var(--text-default)" d="M7 12.001C7 10.8964 6.10457 10.001 5 10.001C3.89543 10.001 3 10.8964 3 12.001C3 13.1055 3.89543 14.001 5 14.001C6.10457 14.001 7 13.1055 7 12.001ZM14 12.001C14 10.8964 13.1046 10.001 12 10.001C10.8954 10.001 10 10.8964 10 12.001C10 13.1055 10.8954 14.001 12 14.001C13.1046 14.001 14 13.1055 14 12.001ZM19 10.001C20.1046 10.001 21 10.8964 21 12.001C21 13.1055 20.1046 14.001 19 14.001C17.8954 14.001 17 13.1055 17 12.001C17 10.8964 17.8954 10.001 19 10.001Z"/>
                            </svg>
                        </div>)}
                </Tooltip>
            </div>
        </div>
        {userPermissions.length > 0 && (<div className={classes(RoleClasses.root)}>
                {userPermissions.map(({ permission, roleColor, roleName }) => (<Tooltip key={permission} text={<GrantedByTooltip roleName={roleName} roleColor={roleColor}/>} tooltipClassName={cl("granted-by-container")} tooltipContentClassName={cl("granted-by-content")}>
                        {tooltipProps => (<FakeRole {...tooltipProps} text={permission} color={roleColor}/>)}
                    </Tooltip>))}
            </div>)}
    </div>;
}
export default ErrorBoundary.wrap(UserPermissionsComponent, { noop: true });
