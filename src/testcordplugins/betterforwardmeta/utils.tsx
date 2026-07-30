/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import { Guild } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";

export const ServerProfileComponent = findComponentByCodeLazy("{guildProfile:", "GUILD_PROFILE");
export const cl = classNameFactory("vc-serverprofileforward-");

export const ArrowSvg = () => <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z" className=""></path></svg>;

export const checkForIconExistence = (guild: Guild) => {
    if (!guild) return false;
    if (!guild.icon) return false;
    return true;
};
