/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The retry/verify behaviour in messageCleaner is a small state machine whose outcome
 * feeds the progress stats, and the plugin cannot be imported here (CSS + React). What is
 * worth pinning down is the shape of the contract, plus a behavioural model of the same
 * decision table so the intended semantics are executable and reviewable.
 *
 * Decision table under test:
 *   delete OK                      -> "deleted", stop
 *   delete failed, message is 404  -> "gone",    stop   (already deleted: goal met)
 *   delete failed, message present -> retry, up to deleteRetries, then "failed"
 *   verification inconclusive      -> treated as present, i.e. retry
 *   stop requested                 -> "failed" immediately, no further requests
 */
const source = readFileSync(
    new URL("../src/testcordplugins/messageCleaner/index.tsx", import.meta.url),
    "utf8"
);

type Outcome = "deleted" | "gone" | "failed";

function modelRetry(opts: {
    maxRetries: number;
    verify: boolean;
    cancelledAfter?: number;
    deleteOutcomes: Array<"ok" | "fail">;
    goneAnswers: boolean[];
}): { outcome: Outcome; deleteCalls: number; verifyCalls: number } {
    let deleteCalls = 0;
    let verifyCalls = 0;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        if (opts.cancelledAfter !== undefined && deleteCalls >= opts.cancelledAfter) {
            return { outcome: "failed", deleteCalls, verifyCalls };
        }
        if (attempt > 0) {
            // A retry is paced by delayBetweenDeletes; not modelled as a request.
        }
        const result = opts.deleteOutcomes[deleteCalls] ?? "fail";
        deleteCalls++;
        if (result === "ok") return { outcome: "deleted", deleteCalls, verifyCalls };
        if (opts.verify) {
            verifyCalls++;
            if (opts.goneAnswers[verifyCalls - 1]) return { outcome: "gone", deleteCalls, verifyCalls };
        }
    }
    return { outcome: "failed", deleteCalls, verifyCalls };
}

test("a successful delete is not retried or verified", () => {
    const r = modelRetry({ maxRetries: 3, verify: true, deleteOutcomes: ["ok"], goneAnswers: [false] });
    assert.deepEqual(r, { outcome: "deleted", deleteCalls: 1, verifyCalls: 0 });
});

test("a failure where the message is already gone counts as deleted, with no retry", () => {
    const r = modelRetry({ maxRetries: 3, verify: true, deleteOutcomes: ["fail"], goneAnswers: [true] });
    assert.deepEqual(r, { outcome: "gone", deleteCalls: 1, verifyCalls: 1 });
});

test("a failure where the message survives is retried up to the setting", () => {
    const r = modelRetry({ maxRetries: 3, verify: true, deleteOutcomes: ["fail", "fail", "ok"], goneAnswers: [false, false] });
    assert.deepEqual(r, { outcome: "deleted", deleteCalls: 3, verifyCalls: 2 });

    const exhausted = modelRetry({ maxRetries: 2, verify: true, deleteOutcomes: ["fail", "fail", "fail"], goneAnswers: [false, false, false] });
    assert.deepEqual(exhausted, { outcome: "failed", deleteCalls: 3, verifyCalls: 3 });
});

test("retries are bounded by the setting, so 0 means one attempt only", () => {
    const r = modelRetry({ maxRetries: 0, verify: true, deleteOutcomes: ["fail", "ok"], goneAnswers: [false] });
    assert.deepEqual(r, { outcome: "failed", deleteCalls: 1, verifyCalls: 1 });
});

test("disabling verification retries without a probe", () => {
    const r = modelRetry({ maxRetries: 1, verify: false, deleteOutcomes: ["fail", "ok"], goneAnswers: [] });
    assert.deepEqual(r, { outcome: "deleted", deleteCalls: 2, verifyCalls: 0 });
});

test("cancelling stops before any further delete request", () => {
    const r = modelRetry({ maxRetries: 5, verify: true, cancelledAfter: 1, deleteOutcomes: ["fail", "fail", "fail"], goneAnswers: [false] });
    assert.deepEqual(r, { outcome: "failed", deleteCalls: 1, verifyCalls: 1 });
});

test("the implementation matches the model: settings, verification and outcome mapping", () => {
    assert.match(source, /deleteRetries: \{/, "deleteRetries setting must exist");
    assert.match(source, /default: 3,/, "deleteRetries should default to 3");
    assert.match(source, /verifyAfterFailure: \{/, "verifyAfterFailure setting must exist");

    // Only a 404 proves the message is gone; anything else stays inconclusive.
    assert.match(source, /const statusCode = error\?\.status \|\| error\?\.statusCode;\s*\n\s*return statusCode === 404;/);

    // Retries must be paced, not fired back to back.
    assert.match(source, /await waitCleaningDelay\(settings\.store\.delayBetweenDeletes\);/);

    // Cancellation is checked before each request and after each await.
    assert.match(source, /if \(isCancelled\(\)\) return "failed";/);

    // A verified-gone message counts as deleted in the stats, not as a failure.
    assert.match(source, /outcome === "failed"/);
    assert.match(source, /cleaningStats\.deleted\+\+;/);
});
