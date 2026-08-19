/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { EyeIcon } from "@components/Icons";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { getCurrentGuild } from "@utils/discord";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { ChannelStore, ContextMenuApi, GuildMemberStore, GuildRoleStore, Menu, Tooltip, useStateFromStores } from "@webpack/common";
const cl = classNameFactory("vc-sric-");
const SETTINGS_KEYS = ["showBots", "useRoleColor", "excludedRoles"];
const roleCache = new Map();
const MAX_ROLE_CACHE = 1000;
function cacheRoleKey(guildId, userId, excludedRoles) {
    return `${guildId}:${userId}:${excludedRoles?.join(",") ?? ""}`;
}
const settings = definePluginSettings({
    showBots: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Whether to show the highest role on bots.",
        default: false
    },
    useRoleColor: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Use the role's color for the icon.",
        default: true
    }
}).withPrivateSettings();
function getHighestRole(guildId, userId, excludedRoles) {
    const key = cacheRoleKey(guildId, userId, excludedRoles);
    const cached = roleCache.get(key);
    if (cached !== undefined)
        return cached;
    const roles = GuildMemberStore.getMember(guildId, userId)?.roles;
    if (!roles?.length) {
        roleCache.set(key, null);
        if (roleCache.size > MAX_ROLE_CACHE) {
            const first = roleCache.keys().next().value;
            if (first)
                roleCache.delete(first);
        }
        return null;
    }
    const role = GuildRoleStore.getSortedRoles(guildId).find(r => roles.includes(r.id) && !excludedRoles?.includes(r.id));
    const result = role ? { roleId: role.id, name: role.name, colorString: role.colorString ?? null } : null;
    roleCache.set(key, result);
    if (roleCache.size > MAX_ROLE_CACHE) {
        const first = roleCache.keys().next().value;
        if (first)
            roleCache.delete(first);
    }
    return result;
}
function toggleRole(roleId) {
    const excluded = settings.store.excludedRoles ?? [];
    settings.store.excludedRoles = excluded.includes(roleId) ? excluded.filter(id => id !== roleId) : [...excluded, roleId];
}
function makeToggleRoleItem(roleId) {
    const isExcluded = settings.store.excludedRoles?.includes(roleId);
    return (<Menu.MenuItem id="toggle" icon={isExcluded ? EyeIcon : EyeSlashIcon} label={isExcluded ? "Show Role in Chat" : "Hide Role in Chat"} action={() => toggleRole(roleId)}/>);
}
function EyeSlashIcon() {
    return (<svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="currentColor" d="M1.3 21.3a1 1 0 1 0 1.4 1.4l20-20a1 1 0 0 0-1.4-1.4l-20 20ZM3.16 16.05c.18.24.53.26.74.05l.72-.72c.18-.18.2-.45.05-.66a15.7 15.7 0 0 1-1.43-2.52.48.48 0 0 1 0-.4c.4-.9 1.18-2.37 2.37-3.72C7.13 6.38 9.2 5 12 5c.82 0 1.58.12 2.28.33.18.05.38 0 .52-.13l.8-.8c.25-.25.18-.67-.15-.79A9.79 9.79 0 0 0 12 3C4.89 3 1.73 10.11 1.11 11.7a.83.83 0 0 0 0 .6c.25.64.9 2.15 2.05 3.75Z"/>
            <path fill="currentColor" d="M8.18 10.81c-.13.43.36.65.67.34l2.3-2.3c.31-.31.09-.8-.34-.67a4 4 0 0 0-2.63 2.63ZM12.85 15.15c-.31.31-.09.8.34.67a4.01 4.01 0 0 0 2.63-2.63c.13-.43-.36-.65-.67-.34l-2.3 2.3Z"/>
            <path fill="currentColor" d="M9.72 18.67a.52.52 0 0 0-.52.13l-.8.8c-.25.25-.18.67.15.79 1.03.38 2.18.61 3.45.61 7.11 0 10.27-7.11 10.89-8.7a.83.83 0 0 0 0-.6c-.25-.64-.9-2.15-2.05-3.75a.49.49 0 0 0-.74-.05l-.72.72a.51.51 0 0 0-.05.66 15.7 15.7 0 0 1 1.43 2.52c.06.13.06.27 0 .4-.4.9-1.18 2.37-2.37 3.72C16.87 17.62 14.8 19 12 19c-.82 0-1.58-.12-2.28-.33Z"/>
        </svg>);
}
const HighestRoleIndicator = ErrorBoundary.wrap(({ user, channelId, isCompact }) => {
    const { showBots, useRoleColor, excludedRoles } = settings.use(SETTINGS_KEYS);
    const guildId = (!user.bot || showBots) ? ChannelStore.getChannel(channelId)?.guild_id : null;
    const cached = useStateFromStores([GuildMemberStore, GuildRoleStore], () => guildId ? getHighestRole(guildId, user.id, excludedRoles) : null, [guildId, user.id, excludedRoles]);
    if (!guildId || !cached)
        return null;
    const handleContextMenu = (e) => {
        ContextMenuApi.openContextMenu(e, () => {
            const userRoles = GuildMemberStore.getMember(guildId, user.id)?.roles ?? [];
            const excluded = excludedRoles ?? [];
            const hiddenRoles = GuildRoleStore.getSortedRoles(guildId).filter(r => excluded.includes(r.id) && userRoles.includes(r.id));
            return (<Menu.Menu navId="vc-sric-context" onClose={ContextMenuApi.closeContextMenu} aria-label="Chat Role Actions">
                    <Menu.MenuGroup>
                        {makeToggleRoleItem(cached.roleId)}

                        {hiddenRoles.length > 0 && (<Menu.MenuItem id="unhide-menu" label="Unhide Roles in Chat">
                                {hiddenRoles.map(r => (<Menu.MenuItem key={r.id} id={`unhide-${r.id}`} label={r.name} action={() => toggleRole(r.id)}/>))}
                            </Menu.MenuItem>)}
                    </Menu.MenuGroup>
                </Menu.Menu>);
        });
    };
    return (<Tooltip text={cached.name}>
            {tooltipProps => (<span {...tooltipProps} className={classes(cl("indicator"), isCompact && cl("indicator-compact"))} onContextMenu={handleContextMenu} style={useRoleColor && cached.colorString
                ? { "--vc-sric-icon-color": cached.colorString }
                : undefined}>
                    {isCompact ? null : cached.name}
                </span>)}
        </Tooltip>);
}, { noop: true });
export default definePlugin({
    name: "ShowRolesInChat",
    description: "Shows a user's highest role next to their name in chat messages. Hide/show specific roles in their context menu (right-click).",
    tags: ["Appearance", "Chat", "Roles", "Servers"],
    authors: [EquicordDevs.lucabeyer],
    settings,
    contextMenus: {
        "dev-context"(children, { id }) {
            if (GuildRoleStore.getRole(getCurrentGuild()?.id ?? "", id)) {
                children.push(<Menu.MenuGroup>
                        {makeToggleRoleItem(id)}
                    </Menu.MenuGroup>);
            }
        },
        "guild-settings-role-context"(children, props) {
            children.push(<Menu.MenuGroup>
                    {makeToggleRoleItem(props.role.id)}
                </Menu.MenuGroup>);
        }
    },
    renderMessageDecoration: ({ message, compact }) => (<HighestRoleIndicator user={message.author} channelId={message.channel_id} isCompact={compact}/>)
});
