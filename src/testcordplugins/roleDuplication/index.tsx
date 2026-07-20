/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { getUserSettingLazy } from "@api/UserSettings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Guild, Role } from "@vencord/discord-types";
import { GuildStore, Menu, SelectedGuildStore } from "@webpack/common";

import { createRole } from "./api";
import { openModal } from "./modal";

const DeveloperMode = getUserSettingLazy("appearance", "developerMode")!;

function MakeContextCallback(type: "settings" | "other"): NavContextMenuPatchCallback {
    return type === "settings" ? (children, { guild, role }: { guild: Guild; role: Role; }) => {
        children.splice(-1, 0,
            <Menu.MenuItem
                id={"vc-dup-role"}
                label="Duplicate"
                action={async () => { createRole(guild, role, role.icon ? `https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.webp` : null); }}
            />
        );
    } : (children, contextMenuApiArguments) => {
        const guildid = SelectedGuildStore.getGuildId();
        const role = (GuildStore as any).getRole(guildid, contextMenuApiArguments.id);
        if (!role) return;
        children.splice(-1, 0,
            <Menu.MenuItem
                id={"vc-dup-role"}
                label="Clone"
                action={() => openModal(role, role.icon ? `https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.webp` : null)}
            />
        );
    };
}

export default definePlugin({
    name: "RoleDuplication",
    description: "Be able to duplicate/clone roles",
    tags: ["Servers", "Roles"],
    authors: [
        {
            name: "i am me",
            id: 984392761929256980n,
        },
        TestcordDevs.x2b,
    ],
    contextMenus: {
        "guild-settings-role-context": MakeContextCallback("settings"),
        "dev-context": MakeContextCallback("other")
    },
    start() {
        // DeveloperMode needs to be enabled for the context menu to be shown
        DeveloperMode.updateSetting(true);
    },

    stop() {},
});
