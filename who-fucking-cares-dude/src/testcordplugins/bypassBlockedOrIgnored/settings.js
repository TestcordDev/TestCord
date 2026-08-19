/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export default definePluginSettings({
    bypassIgnoredUsersModal: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Bypass the ignored users modal.",
        default: true
    },
    bypassBlockedUsersModal: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Bypass the blocked users modal.",
        default: true
    },
    bypassWhenJoining: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Bypass the modal when joining a voice channel.",
        default: true
    },
    bypassWhenUserJoins: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Bypass the modal when a user joins your voice channel.",
        default: true
    },
    alwaysShowBlockedProfiles: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Always show profiles for blocked users.",
        default: false
    }
});
