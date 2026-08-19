/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { GuildStore, PermissionsBits, PermissionStore, UserStore, useStateFromStores } from "@webpack/common";
export function useAuditLogPermission(guildId) {
    return useStateFromStores([GuildStore, UserStore, PermissionStore], () => PermissionStore.canWithPartialContext(PermissionsBits.VIEW_AUDIT_LOG, { guildId }), [guildId]);
}
