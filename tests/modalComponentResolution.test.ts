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
 */
const source = readFileSync(new URL("../src/webpack/common/modals.ts", import.meta.url), "utf8");

test("Modal and ConfirmModal are not looked up by export name", () => {
    // The name also appears in the explanatory comment, so check code positions only.
    const importLine = source.split("\n").find(l => l.startsWith("import ") && l.includes("@webpack"))!;
    assert.doesNotMatch(importLine, /findExportedComponentLazy/, "the broken finder must not be imported");
    assert.doesNotMatch(source, /=\s*findExportedComponentLazy\(/, "export-name lookup silently resolves to nothing");
});

test("Modal uses the layout wrapper, which is the one that renders `title`", () => {
    // The base modal (data-mana-component="modal") has no title prop, and the user-settings
    // layer ("layer-modal") has none either. Only the layout wrapper takes size + title.
    assert.match(source, /export const Modal: t\.Modal = findComponentByCodeLazy\("actionBarInputLayout"\);/);
});

test("ConfirmModal uses an anchor unique to it", () => {
    assert.match(
        source,
        /export const ConfirmModal: t\.ConfirmModal = findComponentByCodeLazy\(\/checkboxProps\[\\s\\S\]\{0,300\}onCloseCallback\/\);/
    );
    // `critical-primary` appears in 20 modules, `checkboxProps` in only 3, and only
    // ConfirmModal pairs it with onCloseCallback.
    assert.doesNotMatch(source, /findComponentByCodeLazy\("critical-primary"\)/, "not unique to ConfirmModal");
});

test("the settings layer is not used as the Modal", () => {
    assert.doesNotMatch(source, /findComponentByCodeLazy\([^)]*layer-modal/, "layer-modal has no title prop");
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
