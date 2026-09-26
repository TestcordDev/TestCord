/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * "The client is so laggy I can't even talk in DMs."
 *
 * `messageLinkEmbeds` registers a message *decoration*, so `fetchMessage` runs for every
 * visible message that carries a link. The transport-failure branch used to log at error
 * level on every attempt. When link previews are unreachable - blocked CDN, flaky network -
 * that is one console entry, one DevTools update and one `renderer_js.log` write per
 * message, repeating on every cooldown expiry. Error-level logging is the most expensive
 * kind, and the volume is proportional to what is on screen.
 *
 * The backoff itself is correct and is kept: without it a failure either cached a blank
 * for the whole session or retried on every render pass.
 */
const source = readFileSync(new URL("../src/plugins/messageLinkEmbeds/index.tsx", import.meta.url), "utf8");

test("a failed link fetch never logs at error level", () => {
    const block = source.match(/\} catch \(e\) \{[\s\S]*?\n {8}\}/);
    assert.ok(block, "the transport-failure branch not found");
    assert.doesNotMatch(block[0], /logger\.error\(/, "per-attempt error logging is the regression");
});

test("the cooldown branch keeps the backoff", () => {
    assert.match(source, /messageCache\.set\(cacheKey, \{ fetched: false, retryAfter: Date\.now\(\) \+ FETCH_RETRY_DELAY_MS \}\);/);
    assert.match(source, /const FETCH_RETRY_DELAY_MS = 30_000;/);
});

test("a failing link reports at most once per cooldown window", () => {
    const block = source.match(/\} catch \(e\) \{[\s\S]*?\n {8}\}/);
    assert.ok(block, "the transport-failure branch not found");
    assert.match(block[0], /if \(!cooldownLogged\.has\(cacheKey\)\)/, "must be rate limited per key");
    assert.match(block[0], /logger\.debug\(/, "a surviving log must be debug, not error");
});

test("the rate-limit set cannot outlive the cache", () => {
    // Both are keyed per message, so anything that clears one must clear the other or the
    // set becomes a slow leak of every message id ever seen.
    assert.match(source, /const cooldownLogged = new Set<string>\(\);/);
    assert.match(source, /messageCache\.delete\(cacheKey\);\s*\n\s*cooldownLogged\.delete\(cacheKey\);/, "expiry must clear both");
    assert.match(source, /cooldownLogged\.delete\(cacheKey\);\s*\n\s*\n\s*return message;/, "a successful fetch must clear it");
    assert.match(source, /messageCache\.clear\(\); cooldownLogged\.clear\(\);/, "the manual clear must clear both");
});

test("the error object is not interpolated into a string on the hot path", () => {
    const block = source.match(/\} catch \(e\) \{[\s\S]*?\n {8}\}/);
    assert.ok(block, "the transport-failure branch not found");
    assert.doesNotMatch(block[0], /\$\{e\}|,\s*e\)\s*;/, "do not serialise the error per attempt");
});
