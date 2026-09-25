/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { describeConsoleArg } from "../src/testcordplugins/TestcordHelper/consoleArgs.ts";

test("primitives render directly and are length capped", () => {
    assert.equal(describeConsoleArg("hello"), "hello");
    assert.equal(describeConsoleArg(42), "42");
    assert.equal(describeConsoleArg(true), "true");
    assert.equal(describeConsoleArg(null), "null");
    assert.equal(describeConsoleArg(undefined), "undefined");
    assert.equal(describeConsoleArg(Symbol("s")), "Symbol(s)");
    assert.equal(describeConsoleArg("x".repeat(5000)).length, 500);
});

test("errors keep the message and stack that crash triage greps for", () => {
    const out = describeConsoleArg(new Error("NoiseCancellerError: boom"));
    // The stack is preferred, and it already starts with "Error: <message>".
    assert.ok(out.startsWith("Error: NoiseCancellerError: boom\n"), `unexpected: ${out.slice(0, 80)}`);
    assert.match(out, /at /);
});

test("object values are preserved so structured payloads stay greppable", () => {
    // This is the regression that matters: the buffer is the documented crash triage
    // path, and these payloads used to survive because of JSON.stringify.
    assert.match(describeConsoleArg({ avError: "NO_AUDIO", code: 4001 }), /avError=NO_AUDIO/);
    assert.match(describeConsoleArg({ avError: "NO_AUDIO", code: 4001 }), /code=4001/);
    assert.match(describeConsoleArg([{ code: "AVError" }, { code: "B" }]), /AVError/);
});

test("nesting is bounded so a deep object cannot blow up the buffer", () => {
    const deep: any = { a: { b: { c: { d: { e: "deep" } } } } };
    const out = describeConsoleArg(deep);
    // Two levels are expanded, the third collapses, so "deep" is never reached.
    assert.equal(out, "{a={b={…}}}");
    assert.doesNotMatch(out, /deep/);
});

test("wide objects and long arrays are truncated with an ellipsis marker", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 50; i++) wide[`k${i}`] = i;
    const wideOut = describeConsoleArg(wide);
    assert.match(wideOut, /…/);
    assert.match(wideOut, /k0=0/);
    assert.doesNotMatch(wideOut, /k49/);

    const long = Array.from({ length: 50 }, (_, i) => i);
    const longOut = describeConsoleArg(long);
    assert.match(longOut, /\+44/);
    assert.ok(longOut.length <= 500);
});

test("arrays obey the same caps as objects", () => {
    // Regression: the array branch used to return before the depth check and without a
    // length cap, so six 500-char strings produced a 3016-char argument.
    const wideStrings = Array.from({ length: 6 }, () => ["x".repeat(500)]);
    assert.ok(describeConsoleArg(wideStrings).length <= 500);

    // A self-referential array must not recurse until the stack blows.
    const cyclic: any[] = [1];
    cyclic.push(cyclic);
    const t0 = Date.now();
    assert.doesNotThrow(() => describeConsoleArg(cyclic));
    assert.ok(describeConsoleArg(cyclic).length <= 500);
    assert.ok(Date.now() - t0 < 1000, "cyclic render took too long");

    // Deeply nested arrays collapse instead of expanding.
    let deep: any = "leaf";
    for (let i = 0; i < 50; i++) deep = [deep];
    assert.doesNotThrow(() => describeConsoleArg(deep));
    assert.ok(describeConsoleArg(deep).length <= 500);
});

test("a hostile constructor name cannot exceed the cap", () => {
    const huge = class { };
    Object.defineProperty(huge, "name", { value: "x".repeat(10_000) });

    // Shallow: the prefix is long but the final slice still bounds it.
    const shallow = describeConsoleArg(new huge());
    assert.ok(shallow.length <= 500, `length was ${shallow.length}`);

    // Depth-capped: both early-return paths must bound the prefix too.
    const deep = describeConsoleArg([[[new huge()]]]);
    assert.ok(deep.length <= 500, `length was ${deep.length}`);
    assert.ok(deep.includes("[…]"));
});

test("functions and classes keep their source or tag, as before", () => {
    assert.match(describeConsoleArg(function myHandler(a: number) { return a * 2; }), /myHandler/);
    assert.match(describeConsoleArg(new (class Widget { constructor() { /* noop */ } })()), /Widget/);
});

test("hostile objects never throw out of the console wrapper", () => {
    // A revoked proxy and a throwing trap both used to be able to escape into the
    // caller, because this runs inside the global console.log/warn/error override.
    const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
    revoke();
    assert.doesNotThrow(() => describeConsoleArg(proxy));
    assert.equal(typeof describeConsoleArg(proxy), "string");

    const trap = new Proxy({}, {
        get() { throw new Error("trap"); },
        ownKeys() { throw new Error("trap"); },
        getOwnPropertyDescriptor() { throw new Error("trap"); },
        getPrototypeOf() { throw new Error("trap"); }
    });
    assert.doesNotThrow(() => describeConsoleArg(trap));

    const nullProto = Object.create(null);
    assert.doesNotThrow(() => describeConsoleArg(nullProto));
    assert.equal(describeConsoleArg(nullProto), "{}");
});

test("a getter that throws is contained", () => {
    const obj = {
        get boom() { throw new Error("nope"); },
        ok: 1
    };
    assert.doesNotThrow(() => describeConsoleArg(obj));
});
