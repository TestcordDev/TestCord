/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * `PatchVersioning` imports DataStore/VencordNative, so it cannot be imported by the bare
 * test runner, and `new Function` does not behave reliably under the runner in this
 * environment. The invariant worth guarding is therefore a source-level one.
 *
 * Why it matters: `checkAndStore` runs once per *applied patch*, and every patch on a
 * module is handed the same `originalFactoryCode` string, so hashing walked that whole
 * string once per patch. The memo exists to make it one walk per module. The regression
 * this test exists to prevent is the one that was actually shipped at first: adding the
 * memo helper and leaving `checkAndStore` calling `djb2` directly, which looks optimised
 * and is not.
 */
const source = readFileSync(
    new URL("../src/api/PatchVersioning.ts", import.meta.url),
    "utf8"
);

test("checkAndStore hashes through the memo, not the raw walk", () => {
    assert.match(
        source,
        /const currentHash = hashSource\(originalSource\);/,
        "checkAndStore must use the memoised hash"
    );
    assert.ok(
        !/const currentHash = djb2\(originalSource\);/.test(source),
        "checkAndStore still walks the full module source once per patch"
    );
});

test("djb2 is only reached through hashSource", () => {
    // Exactly two textual occurrences: the declaration, and the single call inside
    // hashSource. Any further one means some path re-walks the full source per patch.
    assert.equal(
        [...source.matchAll(/\bdjb2\s*\(/g)].length,
        2,
        "djb2 should appear only as its declaration and one call inside hashSource"
    );
});

test("the memo is keyed on the string reference, not a derived value", () => {
    // Keying on anything other than the reference (a length, a prefix) would return a
    // stale hash for a different module, silently suppressing codeChanged reporting.
    assert.match(source, /if \(source === lastHashedSource\) return lastHashedValue;/);
    assert.match(source, /lastHashedSource = source;/);
    assert.match(source, /lastHashedValue = hash;/);
});
