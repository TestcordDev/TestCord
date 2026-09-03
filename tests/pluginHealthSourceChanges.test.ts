/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PluginHealth } from "../src/api/PluginHealth.ts";

test("records codeChanged as sourceChanges separately from patchFailures in current session", () => {
    const testPlugin = "TestPlugin_SourceChangeCounter";
    PluginHealth.clear(testPlugin);

    PluginHealth.recordPatchFailure(testPlugin, {
        kind: "codeChanged",
        find: "foo",
        error: "Hash changed"
    });

    const session = PluginHealth.getCurrentSession();
    const counts = session.plugins[testPlugin];

    assert.ok(counts, "Plugin counts should exist in current session");
    assert.equal(counts.sourceChanges, 1, "sourceChanges should be incremented");
    assert.equal(counts.patchFailures, 0, "patchFailures should remain 0 for codeChanged");
    assert.equal(counts.runtimeErrors, 0, "runtimeErrors should remain 0");

    // Adding a real patch failure should bump patchFailures, not sourceChanges
    PluginHealth.recordPatchFailure(testPlugin, {
        kind: "noModule",
        find: "bar"
    });

    const updatedCounts = PluginHealth.getCurrentSession().plugins[testPlugin];
    assert.equal(updatedCounts.patchFailures, 1, "patchFailures should increment for noModule");
    assert.equal(updatedCounts.sourceChanges, 1, "sourceChanges should stay at 1");

    PluginHealth.clear(testPlugin);
});

test("hasIssues and totalUnhealthyPlugins respect ignoreSourceHealth setting", async () => {
    const testPlugin = "TestPlugin_HealthToggle";
    PluginHealth.clear(testPlugin);

    PluginHealth.recordPatchFailure(testPlugin, {
        kind: "codeChanged",
        find: "somePattern"
    });

    // Default or explicitly false
    await PluginHealth.setIgnoreSourceHealth(false);
    assert.equal(PluginHealth.isIgnoreSourceHealth(), false);
    assert.equal(PluginHealth.hasIssues(testPlugin), true, "Should have issues when source changes are not ignored");

    // Enabled: ignore source changes for health
    await PluginHealth.setIgnoreSourceHealth(true);
    assert.equal(PluginHealth.isIgnoreSourceHealth(), true);
    assert.equal(PluginHealth.hasIssues(testPlugin), false, "Should NOT have issues when ignoreSourceHealth is true");

    // But if a runtime error is also recorded, it should still have issues
    PluginHealth.recordRuntimeError(testPlugin, "start", new Error("Boom"));
    assert.equal(PluginHealth.hasIssues(testPlugin), true, "Runtime errors must still be counted as issues");

    // Reset back
    await PluginHealth.setIgnoreSourceHealth(false);
    PluginHealth.clear(testPlugin);
});

test("computeStability respects ignoreSourceHistory setting", async () => {
    const testPlugin = "TestPlugin_HistoryToggle";
    PluginHealth.clear(testPlugin);

    // Register as enabled so sessionsSeen is tracked
    PluginHealth.registerEnabledPlugins([testPlugin]);

    // Record codeChanged in the session
    PluginHealth.recordPatchFailure(testPlugin, {
        kind: "codeChanged",
        find: "baz"
    });

    // With ignoreSourceHistory = false, the source change should count towards sessionsBroken
    await PluginHealth.setIgnoreSourceHistory(false);
    assert.equal(PluginHealth.isIgnoreSourceHistory(), false);
    const scoreWithSource = PluginHealth.getStability(testPlugin);
    assert.equal(scoreWithSource.sessionsBroken, 1, "Session should be counted as broken when source changes are not ignored in history");

    // With ignoreSourceHistory = true, the source change should NOT count towards sessionsBroken
    await PluginHealth.setIgnoreSourceHistory(true);
    assert.equal(PluginHealth.isIgnoreSourceHistory(), true);
    const scoreIgnored = PluginHealth.getStability(testPlugin);
    assert.equal(scoreIgnored.sessionsBroken, 0, "Session should NOT be counted as broken when ignoreSourceHistory is true");

    // Reset back
    await PluginHealth.setIgnoreSourceHistory(false);
    PluginHealth.clear(testPlugin);
});
