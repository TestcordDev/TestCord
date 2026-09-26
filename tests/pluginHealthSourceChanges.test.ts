/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { describeRejection, PluginHealth } from "../src/api/PluginHealth.ts";

// Plain-object rejections used to stringify to "[object Object]", which also
// stopped the global-error ignore-list from matching AbortError/429/network noise.
test("describeRejection extracts details from plain-object rejections", () => {
    const described = describeRejection({ code: 40001, message: "Cannot send message to this user" });
    assert.equal(described.message, "Cannot send message to this user (code 40001)");
    assert.doesNotMatch(described.message, /\[object Object\]/);
});

test("describeRejection keeps the name so the ignore-list can match it", () => {
    const described = describeRejection({ name: "AbortError" });
    assert.equal(described.message, "AbortError");
    assert.match(described.message, /AbortError/);
});

test("describeRejection falls back to the body when no message is present", () => {
    const described = describeRejection({ status: 429, body: { retry_after: 5 } });
    assert.match(described.message, /retry_after/);
    assert.match(described.message, /status 429/);
});

test("describeRejection passes Errors through with name and stack intact", () => {
    const err = new TypeError("boom");
    const described = describeRejection(err);
    assert.equal(described.message, "TypeError: boom");
    assert.equal(described.stack, err.stack);
});

test("recordRuntimeError stores real detail for non-Error rejections", () => {
    const testPlugin = "TestPlugin_RejectionDetail";
    PluginHealth.clear(testPlugin);

    PluginHealth.recordRuntimeError(testPlugin, "flux:LOAD_MESSAGES_SUCCESS", { code: 50035, message: "Invalid Form Body" });

    const entry = PluginHealth.get(testPlugin);
    const errors = entry?.runtimeErrors ?? [];
    assert.equal(errors.length, 1, "Rejection should be recorded");
    assert.doesNotMatch(errors[0].error, /^\[object Object\]$/, "Should not be an opaque [object Object]");
    assert.match(errors[0].error, /Invalid Form Body/);

    PluginHealth.clear(testPlugin);
});

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

    await PluginHealth.setIgnoreSourceHealth(false);
    assert.equal(PluginHealth.isIgnoreSourceHealth(), false);
    assert.equal(PluginHealth.hasIssues(testPlugin), true, "Should have issues when source changes are not ignored");

    await PluginHealth.setIgnoreSourceHealth(true);
    assert.equal(PluginHealth.isIgnoreSourceHealth(), true);
    assert.equal(PluginHealth.hasIssues(testPlugin), false, "Should NOT have issues when ignoreSourceHealth is true");

    PluginHealth.recordRuntimeError(testPlugin, "start", new Error("Boom"));
    assert.equal(PluginHealth.hasIssues(testPlugin), true, "Runtime errors must still be counted as issues");

    await PluginHealth.setIgnoreSourceHealth(false);
    PluginHealth.clear(testPlugin);
});

test("computeStability respects ignoreSourceHealth setting", async () => {
    const testPlugin = "TestPlugin_HistoryToggle";
    PluginHealth.clear(testPlugin);

    PluginHealth.registerEnabledPlugins([testPlugin]);

    PluginHealth.recordPatchFailure(testPlugin, {
        kind: "codeChanged",
        find: "baz"
    });

    await PluginHealth.setIgnoreSourceHealth(false);
    assert.equal(PluginHealth.isIgnoreSourceHealth(), false);
    const scoreWithSource = PluginHealth.getStability(testPlugin);
    assert.equal(scoreWithSource.sessionsBroken, 1, "Session should be counted as broken when source changes are not ignored in health");
    assert.equal(scoreWithSource.badge, "unstable", "Badge should be unstable when broken");

    await PluginHealth.setIgnoreSourceHealth(true);
    assert.equal(PluginHealth.isIgnoreSourceHealth(), true);
    const scoreIgnored = PluginHealth.getStability(testPlugin);
    assert.equal(scoreIgnored.sessionsBroken, 0, "Session should NOT be counted as broken when ignoreSourceHealth is true");

    await PluginHealth.setIgnoreSourceHealth(false);
    PluginHealth.clear(testPlugin);
});
