/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import "./style.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { definePluginSettings } from "@api/Settings";
import { addChannelToolbarButton, ChannelToolbarButton, removeChannelToolbarButton } from "@api/HeaderBar";
import { TestcordDevs } from "@utils/constants";
import { getUniqueUsername } from "@utils/discord";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import type { GuildMember, User } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, SelectedChannelStore, SelectedGuildStore, showToast, Toasts, Tooltip, UserStore } from "@webpack/common";

const cl = classNameFactory("vc-memberlist-export-");

const ChannelMemberStore = findStoreLazy("ChannelMemberStore") as {
    getProps(guildId?: string, channelId?: string): { groups: { count: number; id: string; }[]; };
};

const settings = definePluginSettings({
    exportFormat: {
        type: OptionType.SELECT,
        description: "File format used when exporting the member list.",
        options: [
            { label: "JSON", value: "json", default: true },
            { label: "CSV", value: "csv" }
        ]
    }
});

function serializeUser(user: User, member?: GuildMember) {
    return {
        id: user.id,
        username: user.username,
        globalName: user.globalName ?? null,
        displayName: getUniqueUsername(user),
        nickname: member?.nick ?? null,
        bot: user.bot ?? false,
        roles: member?.roles ?? []
    };
}

function escapeCsvValue(value: string | number | boolean | null) {
    const stringValue = String(value ?? "");
    return `"${stringValue.replace(/"/g, '""')}"`;
}

function toCsv(rows: Array<Record<string, string | number | boolean | null>>) {
    if (!rows.length) return "";

    const headers = Object.keys(rows[0]);
    const lines = [headers.map(escapeCsvValue).join(",")];

    for (const row of rows) {
        lines.push(headers.map(header => escapeCsvValue(row[header] ?? null)).join(","));
    }

    return lines.join("\n");
}

function downloadMemberList() {
    const guildId = SelectedGuildStore.getGuildId();
    const channelId = SelectedChannelStore.getChannelId();
    const guild = guildId ? GuildStore.getGuild(guildId) : null;
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;

    if (!guildId || !guild || !channelId || !channel) {
        showToast("Failed to export member list: missing guild or channel context.", Toasts.Type.FAILURE);
        return;
    }

    const groups = ChannelMemberStore.getProps(guildId, channelId)?.groups ?? [];
    const roleIds = new Set(groups.map(group => group.id).filter(id => id && id !== "online" && id !== "offline"));

    const memberIds = GuildMemberStore.getMemberIds(guildId);
    const members = memberIds
        .map(userId => {
            const member = GuildMemberStore.getMember(guildId, userId);
            const user = member?.user ?? UserStore.getUser(userId);
            return member && user ? { member, user } : null;
        })
        .filter((entry): entry is { member: GuildMember; user: User; } => entry != null);

    const visibleMembers = members.filter(({ member }) => {
        if (roleIds.size === 0) return true;
        return member.roles.some(roleId => roleIds.has(roleId));
    });

    const roles = Array.from(roleIds)
        .map(roleId => {
            const role = GuildRoleStore.getRole(guildId, roleId);
            if (!role) return null;

            return {
                id: role.id,
                name: role.name,
                color: role.color,
                colorString: role.colorString ?? null,
                position: role.position,
                members: visibleMembers
                    .filter(({ member }) => member.roles.includes(roleId))
                    .map(({ member, user }) => serializeUser(user, member))
            };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null);

    const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        guild: {
            id: guild.id,
            name: guild.name
        },
        channel: {
            id: channel.id,
            name: channel.name,
            type: channel.type
        },
        memberCount: visibleMembers.length,
        members: visibleMembers.map(({ member, user }) => serializeUser(user, member)),
        roles
    };

    const safeChannelName = (channel.name || channel.id).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || channel.id;
    const memberRows = visibleMembers.map(({ member, user }) => {
        const serialized = serializeUser(user, member);
        return {
            id: serialized.id,
            username: serialized.username,
            globalName: serialized.globalName,
            displayName: serialized.displayName,
            nickname: serialized.nickname,
            bot: serialized.bot,
            roles: serialized.roles.join("|")
        };
    });

    const isCsv = settings.store.exportFormat === "csv";
    const fileContents = isCsv
        ? toCsv(memberRows)
        : JSON.stringify(exportData, null, 2);
    const blob = new Blob([fileContents], { type: isCsv ? "text/csv;charset=utf-8" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `member-list-${safeChannelName}-${channel.id}.${isCsv ? "csv" : "json"}`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`Exported ${visibleMembers.length} members to ${isCsv ? "CSV" : "JSON"}.`, Toasts.Type.SUCCESS);
}

function MemberListExportButton() {
    return (
        <Tooltip text="Download member list as JSON">
            {({ onMouseEnter, onMouseLeave }) => (
                <div
                    className={cl("button")}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29a1 1 0 1 1 1.4 1.41l-4 3.99a1 1 0 0 1-1.4 0l-4-3.99a1 1 0 0 1 1.4-1.41L11 12.59V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
                    </svg>
                </div>
            )}
        </Tooltip>
    );
}

export default definePlugin({
    name: "MemberListExport",
    description: "Adds a download button to export the current member list as JSON or CSV.",
    authors: [TestcordDevs.sirphantom89],
    tags: ["Servers", "Utility"],
    dependencies: ["HeaderBarAPI"],
    settings,
    start() {
        addChannelToolbarButton("MemberListExport", () => {
            const guildId = SelectedGuildStore.getGuildId();
            const channelId = SelectedChannelStore.getChannelId();
            const channel = channelId ? ChannelStore.getChannel(channelId) : null;

            if (!guildId || !channel?.guild_id) return null;

            return (
                <ChannelToolbarButton
                    icon={ErrorBoundary.wrap(() => <MemberListExportButton />, { noop: true }) as any}
                    tooltip={`Download member list as ${settings.store.exportFormat.toUpperCase()}`}
                    onClick={downloadMemberList}
                />
            );
        }, 5);
    },
    stop() {
        removeChannelToolbarButton("MemberListExport");
    }
});
