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
    assert.match(shapes[1], /"getOrCreate",\s*"commit",\s*"has",\s*"get"/, "the original 4-prop shape must be tried first, for older builds");
    assert.match(shapes[1], /"getOrCreate",\s*"commit",\s*"get"/, "the shape that matches current builds must be present");
});

test("a failed lazy lookup is detected before it is used", () => {
    // A mismatched findByPropsLazy does not return undefined; it returns a proxy that
    // throws on first access. Without touching it, the code would cache a broken handle.
    assert.match(source, /const candidate = findByPropsLazy\(\.\.\.shape\);/);
    assert.match(source, /void candidate\.get;/);
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
