/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The plugins tab chained a second full sort onto `sortedPlugins` to float favourites to
 * the top, but that memo's dep array was `[]` while its comparator read
 * `settings.plugins[...].isFavorite`. The order therefore only refreshed when the component
 * remounted: starring or unstarring a plugin did nothing until the tab was reopened.
 *
 * The partition now lives in the `filteredPlugins` memo, whose deps already include
 * `settings.plugins`, and `sortedPlugins` is left as the pure name ordering it can compute
 * once.
 */
const source = readFileSync(
    new URL("../src/components/settings/tabs/plugins/index.tsx", import.meta.url),
    "utf8"
);

function sortedPluginsMemo(): string {
    const start = source.indexOf("const sortedPlugins = useMemo(");
    assert.notEqual(start, -1, "sortedPlugins memo not found");
    const end = source.indexOf("[]\n    );", start);
    assert.notEqual(end, -1, "end of sortedPlugins memo not found");
    return source.slice(start, end);
}

test("sortedPlugins no longer reads favorite state", () => {
    const memo = sortedPluginsMemo();
    assert.doesNotMatch(memo, /isFavorite/, "the once-only memo must not read live settings");
    assert.doesNotMatch(memo, /settings\./, "the once-only memo must not read live settings");
});

test("sortedPlugins keeps a single sort and drops the second one", () => {
    const memo = sortedPluginsMemo();
    assert.equal(memo.match(/\.sort\(/g)?.length, 1, "expected exactly one sort");
    assert.doesNotMatch(memo, /\.toSorted\(/, "the redundant full sort is gone");
    assert.match(memo, /localeCompare\(b\.name\)/, "name ordering must be preserved");
});

test("favourites are floated in a memo that re-runs on settings changes", () => {
    assert.match(
        source,
        /const ordered = \[\s*\n\s*\.\.\.sortedPlugins\.filter\(p => settings\.plugins\[p\.name\]\?\.isFavorite\),\s*\n\s*\.\.\.sortedPlugins\.filter\(p => !settings\.plugins\[p\.name\]\?\.isFavorite\)\s*\n\s*\];/,
        "favourite partition must exist and keep name order within each group"
    );
    assert.match(source, /for \(const p of ordered\)/, "the filter loop must consume the partitioned list");

    // The memo that now owns the ordering has to depend on the settings object.
    const memo = source.match(/const \{ filteredPlugins, requiredPluginDefs \} = useMemo\(\(\) => \{[\s\S]*?\}, \[([^\]]*)\]\);/);
    assert.ok(memo, "filteredPlugins memo not found");
    assert.match(memo[1], /settings\.plugins/, "memo must re-run when favourite state changes");
});

test("the two passes are mutually exclusive and total", () => {
    // Ordering depends on the favourite/non-favourite split covering every plugin exactly
    // once; a plugin matching neither predicate would silently vanish from the list.
    const fav = /settings\.plugins\[p\.name\]\?\.isFavorite\)/;
    const rest = /!settings\.plugins\[p\.name\]\?\.isFavorite/;
    const memo = source.match(/const ordered = \[[\s\S]*?\];/);
    assert.ok(memo, "ordered list not found");
    assert.match(memo[0], fav);
    assert.match(memo[0], rest);
    assert.doesNotMatch(memo[0], /isFavorite\s*\?\?/, "must not rely on a default that could overlap");
});
