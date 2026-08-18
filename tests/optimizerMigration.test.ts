/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { migrateOptimizerSettings } from "../src/testcordplugins/TestcordOptimizer/migration.ts";

test("legacy optimizer settings migrate without losing stored values", () => {
    const plugins = {
        optimizerPremium: { enabled: true, networkCacheMinutes: 42, forcePassiveListeners: false }
    };

    assert.equal(migrateOptimizerSettings(plugins), true);
    assert.deepEqual(plugins.TestcordOptimizer, {
        enabled: true,
        networkCacheMinutes: 42,
        forcePassiveListeners: false
    });
    assert.equal("optimizerPremium" in plugins, false);
});

test("legacy values fill missing canonical settings and preserve explicit canonical values", () => {
    const plugins = {
        TestcordOptimizer: { enabled: false, networkCacheMinutes: 10 },
        optimizerPremium: { enabled: true, networkCacheMinutes: 42, forcePassiveListeners: false }
    };

    assert.equal(migrateOptimizerSettings(plugins), true);
    assert.deepEqual(plugins.TestcordOptimizer, {
        enabled: true,
        networkCacheMinutes: 10,
        forcePassiveListeners: false
    });
    assert.equal("optimizerPremium" in plugins, false);
    assert.equal(migrateOptimizerSettings(plugins), false);
});
