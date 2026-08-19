/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
export const emptyOverride = Object.freeze({
    username: "",
    avatarUrl: "",
    bannerUrl: "",
    pronouns: "",
    flags: 0 /* OverrideFlags.None */,
});
export const settings = definePluginSettings({})
    .withPrivateSettings();
export const getUserOverride = (userId) => settings.store.users?.[userId] ?? emptyOverride;
export const hasFlag = (field, flag) => (field & flag) === flag;
