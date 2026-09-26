/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * "Error during handleStoreDelete2 TypeError: Function.prototype.apply was called on
 * undefined" - thrown on every MESSAGE_DELETE, repeated a dozen times in a row.
 *
 * Two independent bugs stacked, both introduced in b183a6c14.
 *
 * 1. The first candidate shape required a `has` prop. Verified live on build 622282, that
 *    four-prop shape does resolve - but to a module whose internal is null, so calling
 *    `.get(channelId)` on it throws "Cannot read properties of null". Reproduced 5 out of
 *    5 times. The three-prop shape resolves to the real store and is usable 3 out of 3.
 *    So the old ordering bound the logger to a broken store on the very first try, and the
 *    narrower, correct shapes further down the list were never reached.
 *
 * 2. The "touch it to prove the shape matched" check could not do that. findByPropsLazy
 *    hands back a proxy whether or not anything matched, and reading a property off a
 *    proxy never throws - it just yields another proxy. So the check always passed, the
 *    loop never advanced past a bad shape, and the accepted proxy then threw on every
 *    single call. A non-lazy findByProps throws for real when nothing matches, which is the
 *    only genuine proof available here.
 */
const source = readFileSync(
    new URL("../src/testcordplugins/messageLoggerTestcord/index.tsx", import.meta.url),
    "utf8"
);

const shapes = source.match(/const MESSAGE_STORE_INTERNAL_SHAPES: string\[\]\[\] = \[([\s\S]*?)\];/);
assert.ok(shapes, "shape table not found");

test("the known-good shape is tried first", () => {
    const entries = [...shapes[1].matchAll(/\[([^\]]+)\]/g)].map(m =>
        m[1].split(",").map(s => s.trim().replace(/^"|"$/g, ""))
    );
    assert.deepEqual(
        entries[0],
        ["getOrCreate", "commit", "get"],
        "this is the shape verified to resolve to the real store on build 622282"
    );
    // The four-prop shape is kept only as a later fallback, never first: it binds to a
    // module whose internal is null.
    const four = entries.findIndex(e => e.includes("has"));
    assert.ok(four === -1 || four > 0, "the null-internal four-prop shape must not be tried first");
});

test("resolution uses a finder that actually throws when nothing matches", () => {
    const fn = source.match(/function getMessageStoreInternal\(\)[\s\S]*?\n\}/);
    assert.ok(fn, "getMessageStoreInternal not found");
    // Strip comments: the body explains at length why the lazy finder is wrong, and that
    // prose must not be mistaken for a call.
    const code = fn[0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.match(code, /findByProps\(\.\.\.shape\)/, "must use the non-lazy finder");
    assert.doesNotMatch(
        code,
        /findByPropsLazy/,
        "a lazy lookup cannot prove a shape exists, so it must not gate this"
    );
    // And it must not even be imported any more.
    assert.doesNotMatch(
        source,
        /import\s*\{[^}]*\bfindByPropsLazy\b[^}]*\}\s*from\s*"@webpack"/,
        "the lazy finder is no longer used by this module"
    );
});

test("there is no ineffective proxy smoke test", () => {
    const fn = source.match(/function getMessageStoreInternal\(\)[\s\S]*?\n\}/);
    assert.ok(fn);
    // `void candidate.get` is the exact construct that made the check a no-op.
    assert.doesNotMatch(fn[0], /void\s+\w+\.\w+/, "reading a proxy property never throws");
});

test("an unresolvable store degrades instead of throwing at every caller", () => {
    const fn = source.match(/function getMessageStoreInternal\(\)[\s\S]*?\n\}/);
    assert.ok(fn);
    // Callers all do `Internal.get?.(...)`. Optional call syntax guards the property, not
    // the object it is read from, so returning undefined would throw at all of them.
    assert.match(fn[0], /messageStoreInternal = \{\};/, "must return a stub, not undefined");
    // And it must be cached, otherwise the scan re-runs on every single delete.
    const cached = source.match(/if \(messageStoreInternal !== undefined\) return messageStoreInternal;/);
    assert.ok(cached, "result must be memoised");
});

test("callers are not left reading properties off a possibly-undefined object", () => {
    const calls = [...source.matchAll(/= getMessageStoreInternal\(\);/g)];
    assert.ok(calls.length >= 8, `expected the 8 known call sites, found ${calls.length}`);
    // Every one of them immediately dereferences Internal, so the stub is load-bearing.
    const deref = source.match(/Internal\.get\?\./g) || [];
    assert.ok(deref.length >= 8, "callers dereference Internal directly");
});
