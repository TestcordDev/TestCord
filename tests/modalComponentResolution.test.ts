/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * "Plugin settings don't open - the screen dims but no modal appears."
 *
 * Discord stopped exporting `Modal` and `ConfirmModal` by name (build 621784: no module
 * exports either). `findExportedComponentLazy` therefore returned a proxy that resolved
 * to nothing, and the failure was silent in the worst way: `openModal` still ran, so the
 * backdrop rendered and dimmed the screen, but the dialog body was an empty component.
 * Nothing threw, so no error boundary, console entry, or PluginHealth entry ever fired.
 *
 * Verified live on the running client before writing this:
 * - `find(m => 'Modal' in m.exports)` -> "webpack.find found no module"
 * - a bogus export name behaves identically to the real one (no throw, renders nothing),
 *   which is why the breakage could not be detected by probing
 * - the `actionBarInputLayout` anchor renders visible (opacity 1) and honours `size="lg"`
 * - the `checkboxProps...onCloseCallback` anchor renders a title plus both footer buttons
 *
 * The specific anchors are upstream's now (Vendicated, 90aea0ddb) rather than the ones
 * verified above, because this is a core Vencord file that should track upstream so the
 * anchors keep getting maintained as Discord drifts. So the assertions below are deliberately
 * anchor-agnostic: they pin the invariants that make the lookup work, not the exact strings.
 */
const source = readFileSync(new URL("../src/webpack/common/modals.ts", import.meta.url), "utf8");

/** The single `export const <name>:` line, so a comment elsewhere can't satisfy a match. */
function decl(name: string): string {
    const line = source.split("\n").find(l => l.startsWith(`export const ${name}:`));
    assert.ok(line, `${name} export not found`);
    return line;
}

test("Modal and ConfirmModal are not looked up by export name", () => {
    // The name also appears in the explanatory comment, so check code positions only.
    const importLine = source.split("\n").find(l => l.startsWith("import ") && l.includes("@webpack"))!;
    assert.doesNotMatch(importLine, /findExportedComponentLazy/, "the broken finder must not be imported");
    assert.doesNotMatch(source, /=\s*findExportedComponentLazy\(/, "export-name lookup silently resolves to nothing");
});

test("Modal is resolved by code, with an anchor specific enough to be unambiguous", () => {
    const line = decl("Modal");
    assert.match(line, /ByCodeLazy\(/);
    assert.doesNotMatch(line, /findExportedComponentLazy\(/);
    // Vencord disambiguates by requiring several strings in the same module; a single
    // common token would happily match the wrong component.
    const anchors = line.match(/"[^"]+"/g) ?? [];
    assert.ok(anchors.length >= 2, `expected a multi-string anchor, found ${anchors.length}: ${anchors}`);
});

test("ConfirmModal is resolved by code, with an anchor unique to it", () => {
    const line = decl("ConfirmModal");
    assert.match(line, /ByCodeLazy\(/);
    assert.doesNotMatch(line, /findExportedComponentLazy\(/);
    const anchors = line.match(/"[^"]+"/g) ?? [];
    assert.ok(anchors.length >= 2, `expected a multi-string anchor, found ${anchors.length}: ${anchors}`);
    // `critical-primary` on its own appears in 20 modules. The button variants only
    // disambiguate because they are combined with the other strings in the same anchor.
    assert.doesNotMatch(line, /"critical-primary"/, "not unique to ConfirmModal");
});

test("the settings layer is not used as the Modal", () => {
    // data-mana-component="layer-modal" is the user-settings layer and has no title prop.
    assert.doesNotMatch(decl("Modal"), /layer-modal/);
});

test("the module API lookups are left intact", () => {
    // openModal itself was never the problem - it was verified working. Don't let a future
    // "fix" swap these out and break every modal a second way.
    assert.match(source, /openModal: filters\.byCode\(",instant:"\),/);
    assert.match(source, /closeModal: filters\.byCode\("\.onCloseCallback\(\)"\),/);
    assert.match(source, /closeAllModals: filters\.byCode\("\.getState\(\);for"\)/);
});

test("the failure mode this guards against is silent", () => {
    // Documents why there is no runtime probe: an unresolved lazy component does not throw
    // on access or on createElement, it just renders nothing.
    assert.match(source, /no error anywhere to explain it/);
    assert.match(source, /proxy that resolved to nothing/);
});
