/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createInterpositionSlot } from "../src/api/RuntimeInterpositionCore.ts";

test("layers are deterministic and restore the captured original in every disposal order", () => {
    const original = (value: string) => `original(${value})`;
    let current = original;
    let sequence = 0;
    let changes = 0;
    const slot = createInterpositionSlot(
        "test",
        () => current,
        value => { current = value; },
        () => sequence++,
        () => { changes++; }
    );

    for (let cycle = 0; cycle < 20; cycle++) {
        const disposeBehavior = slot.register("behavior", 0, next => value => `behavior(${next(value)})`);
        const disposeDiagnostics = slot.register("diagnostics", 10_000, next => value => `diagnostics(${next(value)})`);
        assert.equal(current("x"), "diagnostics(behavior(original(x)))");

        if (cycle % 2 === 0) {
            disposeBehavior();
            assert.equal(current("x"), "diagnostics(original(x))");
            disposeDiagnostics();
        } else {
            disposeDiagnostics();
            assert.equal(current("x"), "behavior(original(x))");
            disposeBehavior();
        }

        disposeBehavior();
        disposeDiagnostics();
        assert.equal(current, original);
        assert.deepEqual(slot.ownership(), []);
    }

    assert.equal(changes, 80);
});

test("a failed registration rolls back the complete chain", () => {
    const original = (value: number) => value;
    let current = original;
    let sequence = 0;
    const slot = createInterpositionSlot(
        "test",
        () => current,
        value => { current = value; },
        () => sequence++,
        () => undefined
    );
    const dispose = slot.register("healthy", 0, next => value => next(value) + 1);

    assert.throws(() => slot.register("broken", 1, () => {
        throw new Error("installation failed");
    }), /installation failed/);
    assert.equal(current(1), 2);
    assert.deepEqual(slot.ownership(), [{ owner: "healthy", hook: "test", priority: 0 }]);

    dispose();
    assert.equal(current, original);
});
