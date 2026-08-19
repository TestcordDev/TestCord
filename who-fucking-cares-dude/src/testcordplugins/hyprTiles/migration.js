/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function migrateHyprTilesSettings(plugins) {
    const legacy = plugins.HyprTilesPremium;
    if (!legacy)
        return false;
    const canonical = plugins.HyprTiles;
    if (!canonical)
        plugins.HyprTiles = { ...legacy };
    else {
        for (const [key, value] of Object.entries(legacy)) {
            if (key === "enabled") {
                if (value === true)
                    canonical.enabled = true;
            }
            else if (!Object.hasOwn(canonical, key))
                canonical[key] = value;
        }
    }
    delete plugins.HyprTilesPremium;
    return true;
}
