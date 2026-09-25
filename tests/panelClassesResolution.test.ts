/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Regression guard for a crash with the same shape as the "Reload logs does nothing" bug.
 *
 * Discord removed `buttonContents` and `buttonColor` from the panel module (build 621499),
 * so `findByPropsLazy("button", "buttonContents", "buttonColor")` stopped matching. A failed
 * lazy lookup does not return `undefined` - it returns a proxy that throws on first
 * property access - and `panelClasses` is read unguarded in four settings-panel components
 * (`className={panelClasses.container}`, `classes(panelClasses.button, ...)`, ...), so the
 * panel failed to render.
 *
 * Pinned here: the export can never be the raw throwing proxy, resolution is proven before
 * use, and there is a fallback shape that exists on current builds.
 */
const source = readFileSync(
    new URL(
        "../src/testcordplugins/philsPluginLibrary/discordModules/classes.ts",
        import.meta.url
    ),
    "utf8"
);

test("panelClasses is not the raw findByPropsLazy result", () => {
    assert.ok(
        !/export const panelClasses[^=]*= *findByPropsLazy\(/.test(source),
        "panelClasses must not be the lazy proxy itself"
    );
    assert.match(source, /export const panelClasses = new Proxy\(/);
});

test("a failed lazy lookup is detected before it is trusted", () => {
    assert.match(source, /const candidate = findByPropsLazy\(\.\.\.shape\);/);
    assert.match(source, /void candidate\.button;/);
});

test("there is a fallback shape, and the broken one is still tried first", () => {
    const shapes = source.match(/PANEL_CLASS_SHAPES: string\[\]\[\] = \[([\s\S]*?)\];/);
    assert.ok(shapes, "PANEL_CLASS_SHAPES must exist");
    const entries = [...shapes[1].matchAll(/\[([^\]]*)\]/g)];
    assert.ok(entries.length >= 2, `expected a fallback chain, found ${entries.length} shape(s)`);
    assert.match(shapes[1], /"button",\s*"buttonContents",\s*"buttonColor"/, "old shape must stay for older builds");
    assert.match(shapes[1], /"container",\s*"button"/, "the shape present on current builds must be present");
});

test("an unresolvable build degrades to undefined rather than throwing", () => {
    // The whole point: consumers pass these into classes()/className, which tolerate
    // undefined. A thrown proxy did not.
    assert.match(source, /resolved = \{\};/);
    assert.match(source, /if \(typeof prop !== "string"\) return undefined;/);
});
