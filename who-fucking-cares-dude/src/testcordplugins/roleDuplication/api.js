/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Constants, RestAPI } from "@webpack/common";
async function fetchBlob(url) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Failed to fetch ${url} - ${res.status}`);
    return res.blob();
}
export async function createRole(guild, role, icon) {
    if (!role)
        throw new Error("No guild or role provided");
    const data = new FormData();
    data.append("name", role.name);
    data.append("color", role.color.toString());
    data.append("permissions", role.permissions.toString());
    data.append("mentionable", String(role.mentionable));
    data.append("hoist", String(role.hoist));
    if (icon && guild.features.has("ROLE_ICONS")) {
        const iconData = await fetchBlob(icon);
        const dataUrl = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(iconData);
        });
        data.append("icon", iconData);
    }
    await RestAPI.post({
        url: Constants.Endpoints.GUILD_ROLES(guild.id),
        body: Object.fromEntries(data.entries())
    });
}
