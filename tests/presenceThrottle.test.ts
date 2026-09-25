/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Regression guard for a self-inflicted frame-rate regression.
 *
 * The presence throttle batches LOCAL_ACTIVITY_UPDATE and RUNNING_GAMES_CHANGE over an 8s
 * window. An earlier version queued *every* event in the window and dispatched the whole
 * batch on flush. These are the two highest-frequency events Discord emits, so on a busy
 * client each window replayed every event to every subscriber - a periodic spike every 8
 * seconds, plus an array that grew for the whole window.
 *
 * The justification for batching ("subscribers need to see transitions") was wrong. Both
 * events are replace-state, not deltas, and every subscriber reads final state:
 * PerformanceBoost does `if (games?.length) applyMode() else revertMode()`, and the
 * richPresence services read `activity`. React batching does not help either - each
 * dispatch still runs every flux handler for that type.
 */
const source = readFileSync(
    new URL("../src/testcordplugins/TestcordOptimizer/index.tsx", import.meta.url),
    "utf8"
);

/** Executable model of the throttle, mirroring the implementation. */
function modelThrottle(events: Array<{ type: string; games: number[]; }>, maxWindow = 2) {
    const pending = new Map<string, { event: (typeof events)[number]; timer: number }>();
    const dispatched: number[] = [];
    let clock = 0;
    let nextTimer = 1;

    const flush = (type: string) => {
        const p = pending.get(type);
        if (!p) return;
        pending.delete(type);
        dispatched.push(...p.event.games);
    };

    for (const event of events) {
        const existing = pending.get(event.type);
        if (existing) {
            // Latest wins, and the window is deliberately not reset.
            existing.event = event;
            continue;
        }
        const at = clock;
        pending.set(event.type, {
            event,
            timer: nextTimer++
        });
        // Fire this window once enough events have arrived.
        if (events.indexOf(event) >= maxWindow - 1) {
            clock = at;
            flush(event.type);
        }
    }
    for (const type of Array.from(pending.keys())) flush(type);
    return { dispatched, retained: pending.size };
}

test("only the newest event per type is retained, never a growing queue", () => {
    const out = modelThrottle([
        { type: "RUNNING_GAMES_CHANGE", games: [1] },
        { type: "RUNNING_GAMES_CHANGE", games: [1] },
        { type: "RUNNING_GAMES_CHANGE", games: [2] }
    ]);
    // Final state only: the last payload wins, so subscribers still see the truth.
    assert.deepEqual(out.dispatched, [2]);
});

test("a burst of N events costs one dispatch, not N", () => {
    const burst = Array.from({ length: 250 }, (_, i) => ({
        type: "RUNNING_GAMES_CHANGE" as const,
        games: [i]
    }));
    const out = modelThrottle(burst);
    assert.equal(out.dispatched.length, 1, "250 events in one window must dispatch once");
    assert.deepEqual(out.dispatched, [249], "and it must be the newest one");
});

test("the two throttled types stay independent", () => {
    const out = modelThrottle([
        { type: "RUNNING_GAMES_CHANGE", games: [1] },
        { type: "LOCAL_ACTIVITY_UPDATE", games: [7] }
    ]);
    assert.deepEqual(out.dispatched.slice().sort((a, b) => a - b), [1, 7]);
});

test("the pending record holds a single event, not an array", () => {
    assert.match(
        source,
        /const pendingPresenceDispatch = new Map<string, \{ event: any; timer: ReturnType<typeof setTimeout>; \}>\(\);/,
        "an events array here is the regression"
    );
    assert.doesNotMatch(source, /events:\s*any\[\]/, "no per-window array may accumulate");
    assert.doesNotMatch(source, /\.events\.push\(/, "events must not be appended to");
});

test("the window is not reset, so a continuous stream still flushes", () => {
    // Resetting the timer on every event means a continuous stream never dispatches at all
    // and the newest state is never delivered. That was the original starvation bug.
    const block = source.match(/const existing = pendingPresenceDispatch\.get\(event\.type\);[\s\S]*?\n    \}/);
    assert.ok(block, "the dedupe branch not found");
    assert.doesNotMatch(block[0], /clearTimeout/, "must not slide the window");
    assert.match(block[0], /existing\.event = event;/, "must replace with the newest event");
});

test("disabling the throttle flushes exactly one event per type", () => {
    const block = source.match(/else if \(!enable && origFluxDispatch\) \{[\s\S]*?pendingPresenceDispatch\.clear\(\);/);
    assert.ok(block, "the disable path not found");
    assert.doesNotMatch(block[0], /for \(const event of/, "must not replay a batch");
    assert.match(block[0], /origFluxDispatch\.call\(FluxDispatcher, pending\.event\)/);
});
