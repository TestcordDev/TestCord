/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Regression guard for "Reload logs does nothing".
 *
 * `findByProps` needs every listed prop on the *same* module. Discord moved `has` off the
 * MessageStore module (build 621499), so `findByPropsLazy("getOrCreate","commit","has","get")`
 * stopped matching - but it still returns a lazy proxy, one that throws on any property
 * access. Every injection path wrapped its body in `try {} catch {}`, so the plugin
 * silently stopped re-adding deleted messages to chat: the messages vanished and the
 * reload button re-ran the whole pipeline only to hit the same silent failure.
 *
 * These assertions pin the two properties that make the class of bug observable again:
 * there is a fallback chain, and no call site can bypass it.
 */
const source = readFileSync(
    new URL("../src/testcordplugins/messageLoggerTestcord/index.tsx", import.meta.url),
    "utf8"
);

test("store internals resolve through a fallback chain of shapes", () => {
    const shapes = source.match(/MESSAGE_STORE_INTERNAL_SHAPES: string\[\]\[\] = \[([\s\S]*?)\];/);
    assert.ok(shapes, "MESSAGE_STORE_INTERNAL_SHAPES must exist");

    const entries = [...shapes[1].matchAll(/\[\s*"([^"]+)"\s*(?:,\s*"([^"]+)"\s*)*\]/g)].length;
    assert.ok(entries >= 2, `expected multiple fallback shapes, found ${entries}`);
    assert.match(shapes[1], /"getOrCreate",\s*"commit",\s*"get"/, "the shape that matches current builds must be present");

    // Order matters, and the original order was wrong. Verified live on build 622282: the
    // four-prop shape still *matches*, but it resolves to a module whose internal is null, so
    // calling .get(channelId) on it throws "Cannot read properties of null" - 5 times out of
    // 5. Tried first, it shadowed the working shape below it and broke every delete path.
    // The three-prop shape resolves to the real store and is usable 3 times out of 3.
    const firstShape = shapes[1].match(/\[\s*"([^"]+)"\s*(?:,\s*"([^"]+)"\s*)*\]/);
    assert.ok(firstShape, "could not read the first shape");
    const firstProps = (firstShape[0].match(/"([^"]+)"/g) ?? []).map(s => s.replace(/"/g, ""));
    assert.deepEqual(firstProps, ["getOrCreate", "commit", "get"], "the null-internal shape must not be tried first");
});

test("a failed lookup is detected before it is used", () => {
    // The guard here used to be `void candidate.get` after a findByPropsLazy. That could never
    // work: findByPropsLazy hands back a proxy whether or not anything matched, and reading a
    // property off a proxy does not throw - it just yields another proxy. So the check always
    // passed, the loop never advanced past a dead shape, and the cached handle then threw on
    // every single call. A non-lazy findByProps throws for real, which is the only genuine
    // proof available here.
    assert.match(source, /findByProps\(\.\.\.shape\)/);
    assert.doesNotMatch(source, /const candidate = findByPropsLazy/);
    assert.doesNotMatch(source, /void candidate\.get;/);
});

test("resolution failure is reported instead of being swallowed", () => {
    assert.match(source, /reportedMissingStoreInternals/);
    assert.match(source, /log\.error\("Could not resolve the MessageStore internals/);
});

test("every store-internal call site goes through the resolver", () => {
    // A bare `MessageStoreInternal` read would reintroduce the unresolvable handle.
    const bare = source.match(/\(MessageStoreInternal as any\)/g);
    assert.equal(bare, null, "found a direct MessageStoreInternal read that bypasses the resolver");
    assert.ok(
        (source.match(/getMessageStoreInternal\(\)/g) ?? []).length >= 7,
        "expected all injection paths to call the resolver"
    );
});
