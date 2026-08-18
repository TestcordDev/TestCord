/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { migrateHyprTilesSettings } from "../src/testcordplugins/hyprTiles/migration.ts";

test("HyprTiles Premium settings migrate to the canonical plugin", () => {
    const plugins = {
        HyprTiles: { enabled: false, borderColor: "#ffffff" },
        HyprTilesPremium: { enabled: true, borderColor: "#000000", borderWidth: 4 }
    };

    assert.equal(migrateHyprTilesSettings(plugins), true);
    assert.deepEqual(plugins.HyprTiles, { enabled: true, borderColor: "#ffffff", borderWidth: 4 });
    assert.equal("HyprTilesPremium" in plugins, false);
});
