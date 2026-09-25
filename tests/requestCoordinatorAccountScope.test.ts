/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * `TestcordRequestCoordinator` cannot be imported here: it reaches `@webpack/common`,
 * which pulls in components and `.css` that the bare test runner cannot load. The
 * account-scoping fix is a single key transform applied at every cache access point,
 * so the invariant worth guarding is a source-level one: no map access may use a raw,
 * unscoped key.
 *
 * Discord API keys are not account-unique (several plugins build
 * `discord:messages:<channel>:before:<id>:limit:100` while keeping the auth token inside
 * their `run` closure), so an unscoped access reintroduces cross-account page sharing.
 */
const source = readFileSync(
    new URL("../src/api/TestcordRequestCoordinator.ts", import.meta.url),
    "utf8"
);

test("every cache and inFlight access uses a scoped key", () => {
    // Any `cache.<op>(key` or `inFlight.<op>(key` using the bare `key` parameter means
    // the transform was skipped at that site.
    const unscoped = source.matchAll(/\b(?:cache|inFlight)\.(?:get|set|delete|has)\(\s*key\b/g);

    assert.deepEqual(
        [...unscoped].map(m => m[0]),
        [],
        "found cache accesses that bypass accountScopedKey()"
    );
});

test("the scoped prefix is applied to prefix invalidation too", () => {
    // `startsWith(prefix)` on a raw prefix would never match the now-prefixed keys,
    // silently turning prefix invalidation into a no-op.
    assert.ok(
        !/startsWith\(\s*prefix\s*\)/.test(source),
        "invalidatePrefix still matches the unscoped prefix"
    );
    assert.match(source, /const scopedPrefix = accountScopedKey\(prefix\);/);
});

test("the account id is taken from the store, not from a token", () => {
    // A raw token in a long-lived map key would keep a credential resident in the heap.
    assert.match(source, /function accountScopedKey\(key: string\): string \{/);
    assert.match(source, /UserStore\?\.\s*getCurrentUser\(\)\?\.id/);
    assert.ok(!/accountScopedKey\([^)]*token/i.test(source), "accountScopedKey must not take a token");
});
