/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * "Why didn't it pick up a delete in another server?"
 *
 * `queueRecord(message, LogStatus.DELETED)` was reachable from exactly one place -
 * `saveDeletedMessage`, which only runs off a `MESSAGE_DELETE` / `MESSAGE_DELETE_BULK` flux
 * event. Discord only dispatches those for channels this client is subscribed to, so a
 * deletion in a channel the user is not viewing never reached the handler. The DB kept the
 * message as if it were still live, permanently, and the viewer rendered it straight from
 * the DB - which is why it appeared instantly and still looked undeleted.
 *
 * The `pendingUnknownDeletes` buffer is not the answer either: it only drains when a matching
 * MESSAGE_CREATE arrives within 15s, which cannot help a message logged long ago.
 *
 * Opening the channel is the first moment with an authoritative answer, so reconciliation
 * runs on the fetched history window.
 */
const engine = readFileSync(
    new URL("../src/testcordplugins/messageLoggerTestcord/engine.ts", import.meta.url),
    "utf8"
);
const index = readFileSync(
    new URL("../src/testcordplugins/messageLoggerTestcord/index.tsx", import.meta.url),
    "utf8"
);

test("the only source of a DELETED record is still a single place", () => {
    const sites = [...engine.matchAll(/queueRecord\(\s*\w+\s*,\s*LogStatus\.DELETED\s*\)/g)];
    assert.equal(sites.length, 2, "expected exactly two: the flux path and reconciliation");
});

test("reconciliation only trusts absence inside the fetched window", () => {
    const fn = engine.match(/export async function reconcileDeletedInWindow[\s\S]*?\n\}/);
    assert.ok(fn, "reconcileDeletedInWindow not found");
    // A paginated fetch is not proof of deletion; only a record whose own timestamp sits
    // inside the window is. Without this, paging backwards would delete live messages.
    assert.match(fn[0], /ts < oldestMs \|\| ts > newestMs/);
    assert.match(fn[0], /!Number\.isFinite\(ts\)/, "unparseable timestamps must be skipped, not treated as epoch");
});

test("reconciliation never re-marks what is already handled", () => {
    const fn = engine.match(/export async function reconcileDeletedInWindow[\s\S]*?\n\}/);
    assert.ok(fn);
    assert.match(fn[0], /record\.status === LogStatus\.DELETED\) continue;/);
    assert.match(fn[0], /presentIds\.has\(record\.message_id\)\) continue;/);
    assert.match(fn[0], /isTempHiddenMessage\(record\.message_id\)\) continue;/, "a locally hidden message is not deleted upstream");
});

test("reconciliation respects the saveDeletes setting and the active flag", () => {
    const fn = engine.match(/export async function reconcileDeletedInWindow[\s\S]*?\n\}/);
    assert.ok(fn);
    assert.match(fn[0], /if \(!active \|\| !settings\.store\.saveDeletes\) return \[\];/);
});

test("it persists the same way the flux path does", () => {
    const fn = engine.match(/export async function reconcileDeletedInWindow[\s\S]*?\n\}/);
    assert.ok(fn);
    // Same three primitives saveDeletedMessage uses, so the record is written identically.
    assert.match(fn[0], /remember\(message\);/);
    assert.match(fn[0], /queueRecord\(message, LogStatus\.DELETED\);/);
    assert.match(fn[0], /invalidateLoggedCaches\(message\.id\);/);
});

test("it runs on channel fetch, not only on a delete event", () => {
    assert.match(index, /await reconcileDeletedInWindow\(/, "reconciliation must be wired into the fetch path");
    // The present-id set must come from the live history, never from the injected rows.
    const call = index.match(/const presentIds = new Set<string>\(\);[\s\S]*?reconcileDeletedInWindow\(/);
    assert.ok(call, "presentIds construction not found");
    assert.doesNotMatch(call[0], /response\.body\.extra/, "must compare against live history, not our own injected rows");
});

test("a DB read failure is contained", () => {
    const fn = engine.match(/export async function reconcileDeletedInWindow[\s\S]*?\n\}/);
    assert.ok(fn);
    assert.match(fn[0], /try \{[\s\S]*?getChannelLogsAfter[\s\S]*?\} catch \{\s*return \[\];\s*\}/);
});
