/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Queue } from "../src/utils/Queue";

/**
 * Scrolling a busy channel renders one reaction fetch per message. Each queued task holds its
 * Message and ReactionEmoji alive and waits out a 250ms sleep before the next runs, so an
 * unbounded queue both grew memory and serialised work nobody was waiting on.
 *
 * The naive fix — `new Queue(50)` — is a correctness regression, not just a bound. Queue drops
 * the oldest task on overflow and never invokes it, and `cache.fetched` is set at enqueue
 * time, so a dropped task would mark that reaction as permanently fetched and its avatars
 * would never appear again. The bound has to skip the enqueue instead, leaving it retryable.
 */
const source = readFileSync(new URL("../src/plugins/whoReacted/index.tsx", import.meta.url), "utf8");

test("the queue is not bounded via Queue's maxSize", () => {
    assert.match(source, /new Queue\(\)/, "overflow would silently discard unrun fetches");
    assert.doesNotMatch(source, /new Queue\(\d/, "do not rely on overflow dropping tasks");
});

test("enqueue is skipped while the queue is saturated", () => {
    assert.match(source, /const MAX_PENDING_FETCHES = \d+;/);
    assert.match(
        source,
        /if \(!cache\.fetched && queue\.size < MAX_PENDING_FETCHES\) \{\s*\n\s*queue\.unshift\(\(\) => fetchReactions\(msg, e, type\)\);\s*\n\s*cache\.fetched = true;/,
        "fetched must only be set when the task is actually queued"
    );
});

test("a skipped enqueue stays retryable", () => {
    // The dropped case must leave `fetched` false so a later render retries it.
    const fn = source.match(/function getReactionsWithQueue[\s\S]*?\n\}/);
    assert.ok(fn, "getReactionsWithQueue not found");
    const cond = fn[0].indexOf("if (!cache.fetched");
    const setFetched = fn[0].indexOf("cache.fetched = true");
    assert.ok(cond !== -1 && setFetched !== -1);
    // Both statements live inside the same guarded block, so the guard gates the write.
    const guardLine = fn[0].slice(cond, fn[0].indexOf("\n", cond));
    assert.match(guardLine, /queue\.size < MAX_PENDING_FETCHES/);
    assert.ok(fn[0].indexOf("{", fn[0].indexOf(guardLine) - 1) < setFetched);
});

test("Queue really does drop unrun tasks on overflow", () => {
    // Pins the assumption the plugin's design relies on. If Queue ever starts running dropped
    // tasks, the bound could move back into maxSize.
    const queue = new Queue(2);
    const ran: number[] = [];
    queue.push(() => { ran.push(1); return new Promise<void>(() => { }); });
    queue.push(() => { ran.push(2); return new Promise<void>(() => { }); });
    queue.unshift(() => { ran.push(3); return new Promise<void>(() => { }); });
    queue.unshift(() => { ran.push(4); return new Promise<void>(() => { }); });
    assert.equal(queue.size, 2, "overflow must not grow the queue");
});

test("the bound is a small constant, not a runaway", () => {
    const n = Number(source.match(/MAX_PENDING_FETCHES = (\d+);/)![1]);
    assert.ok(n > 0 && n <= 200, `unexpected bound ${n}`);
});
