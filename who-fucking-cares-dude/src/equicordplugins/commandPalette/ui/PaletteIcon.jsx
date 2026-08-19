/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { classNameFactory } from "@utils/css";
const cl = classNameFactory("vc-cmdpal-");
export function PaletteIcon({ icon, className }) {
    if (!icon)
        return null;
    if (typeof icon === "string") {
        return <img className={className ?? cl("icon")} src={icon} alt=""/>;
    }
    const Icon = icon;
    return <Icon className={className ?? cl("icon")}/>;
}
