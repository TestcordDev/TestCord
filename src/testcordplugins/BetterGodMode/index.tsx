/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Guild } from "@vencord/discord-types";
import { Forms, GuildStore, Menu, PermissionStore, React } from "@webpack/common";

// Constants for Permission bitmasks
const ADMINISTRATOR_PERMISSION = 8n;

const BooleanFns = [
    "can",
    "canAccessMemberSafetyPage",
    "canAccessGuildSettings",
    "canBasicChannel",
    "canImpersonateRole",
    "canManageUser",
    "canWithPartialContext",
    "isRoleHigher"
];

const BigIntFns = [
    "computeBasicPermissions",
    "computePermissions",
    "getGuildPermissions",
    "getChannelPermissions"
];

const NeedsToBePatchedFns = [...BooleanFns, ...BigIntFns];

let OriginalFns: Record<string, any> = {};
const godModeEnabledGuilds = new Set<string>();

function getGuildIdFromArgs(args: any[]): string | null {
    for (const arg of args) {
        if (typeof arg === "string" && GuildStore.getGuild(arg)) return arg;
        if (arg?.guild_id && GuildStore.getGuild(arg.guild_id)) return arg.guild_id;
        if (arg?.guildId && GuildStore.getGuild(arg.guildId)) return arg.guildId;
        if (arg?.id && GuildStore.getGuild(arg.id)) return arg.id;
    }
    return null;
}

const ContextMenuPatch: NavContextMenuPatchCallback = (children, { guild }: { guild: Guild; }) => {
    const [checked, setChecked] = React.useState(godModeEnabledGuilds.has(guild.id));

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuCheckboxItem
            id="bgm-toggle-god-mode"
            label="God Mode"
            checked={checked}
            action={() => {
                if (checked) godModeEnabledGuilds.delete(guild.id);
                else godModeEnabledGuilds.add(guild.id);
                setChecked(!checked);
            }}
        />
    );
};

export default definePlugin({
    name: "BetterGodMode [Risky]",
    description: "Get all permissions on any guild (client-side)",
    authors: [EquicordDevs.TheArmagan, TestcordDevs.sirphantom89],

    settingsAboutComponent: () => (
        <Forms.FormText className="plugin-warning">
            Usage of this plugin might get detected by Discord. Use this plugin at your own risk!
        </Forms.FormText>
    ),

    start: () => {
        NeedsToBePatchedFns.forEach(fnName => {
            if (typeof PermissionStore[fnName] !== "function") return;

            OriginalFns[fnName] = PermissionStore[fnName];

            PermissionStore[fnName] = function (...args: any[]) {
                const guildId = getGuildIdFromArgs(args);

                if (guildId && godModeEnabledGuilds.has(guildId)) {
                    // Return the correct data type based on the function name
                    if (BigIntFns.includes(fnName)) {
                        return ADMINISTRATOR_PERMISSION;
                    }
                    return true;
                }

                return OriginalFns[fnName].apply(this, args);
            };
        });
    },

    stop: () => {
        godModeEnabledGuilds.clear();
        for (const fnName in OriginalFns) {
            PermissionStore[fnName] = OriginalFns[fnName];
        }
        OriginalFns = {};
    },

    contextMenus: {
        "guild-context": ContextMenuPatch,
    }
});
