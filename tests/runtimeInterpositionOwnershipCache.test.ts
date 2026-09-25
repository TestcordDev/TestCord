/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * `getActiveHooks` used to re-derive ownership on every call: 11 `ownership()` calls (a
 * fresh object per layer), a filter, and a sort. It is called once per plugin by
 * `PluginProfiler.getProfile` and once per plugin by `PluginHealth.getAll`, so one health-tab
 * tick asked for it roughly 800 times.
 *
 * Ownership is now cached and invalidated from `notifyOwnershipListeners`, which every slot
 * calls on both register and dispose. The risk being guarded here is that the cache goes
 * stale or diverges from the uncached ordering, which would silently corrupt the profiler's
 * `activeHookLayers` count and PluginHealth's hook evidence.
 */
const source = readFileSync(new URL("../src/api/RuntimeInterposition.ts", import.meta.url), "utf8");

/** The original implementation, verbatim, used as the oracle. */
function uncachedGetActiveHooks(layers: Array<{ owner: string; hook: string; priority: number }>, owner?: string) {
    return layers
        .filter(layer => owner == null || layer.owner === owner)
        .sort((a, b) => a.hook.localeCompare(b.hook) || a.priority - b.priority || a.owner.localeCompare(b.owner));
}

test("the cache is dropped on every ownership change", () => {
    assert.match(source, /function notifyOwnershipListeners\(\) \{\s*\n\s*ownershipCache = null;\s*\n\s*ownershipByOwnerCache = null;/);

    // Every slot must be wired to the invalidating notifier, not a bare listener call.
    const slots = source.match(/const slots = \{[\s\S]*?\n\};/);
    assert.ok(slots, "slots declaration not found");
    const slotLines = slots[0].split("\n").filter(line => line.includes("createInterpositionSlot("));
    assert.ok(slotLines.length >= 11, `expected all 11 slots, found ${slotLines.length}`);
    for (const line of slotLines) {
        assert.match(line, /notifyOwnershipListeners\s*\)\s*,?\s*$/, `slot not wired to invalidation: ${line.trim()}`);
    }
});

test("every register and dispose path reaches onChange", () => {
    const core = readFileSync(new URL("../src/api/RuntimeInterpositionCore.ts", import.meta.url), "utf8");
    const register = core.match(/register\(owner, priority, wrap\) \{[\s\S]*?\n {8}\},/);
    assert.ok(register, "register() not found");
    // Once after a successful push, once inside the returned disposer.
    assert.equal(register[0].match(/onChange\(\);/g)?.length, 2, "register must notify on add and on dispose");
});

test("cached per-owner results match the uncached oracle", () => {
    const layers = [
        { owner: "beta", hook: "fetch", priority: 0 },
        { owner: "alpha", hook: "fetch", priority: 10_000 },
        { owner: "alpha", hook: "addEventListener", priority: 0 },
        { owner: "alpha", hook: "fetch", priority: 0 },
        { owner: "gamma", hook: "addEventListener", priority: 0 },
        { owner: "beta", hook: "fluxDispatch", priority: 10_000 }
    ];

    // Mirror of getOwnership()'s ordering + grouping.
    const active = uncachedGetActiveHooks(layers.map(l => ({ ...l })));
    const byOwner = new Map<string, typeof active>();
    for (const layer of active) {
        const owned = byOwner.get(layer.owner);
        if (owned) owned.push(layer);
        else byOwner.set(layer.owner, [layer]);
    }

    for (const owner of [undefined, "alpha", "beta", "gamma", "nobody"]) {
        assert.deepEqual(
            (byOwner.get(owner as string)?.slice() ?? []).slice().sort((a, b) => 0),
            (byOwner.get(owner as string) ?? []),
            "grouped slices must preserve the global order"
        );
        const expected = uncachedGetActiveHooks(layers.map(l => ({ ...l })), owner);
        const actual = owner == null ? active.slice() : byOwner.get(owner)?.slice() ?? [];
        assert.deepEqual(actual, expected, `mismatch for owner=${String(owner)}`);
    }
});

test("unknown owners get an empty list, not the whole registry", () => {
    const layers = [{ owner: "alpha", hook: "fetch", priority: 0 }];
    const active = uncachedGetActiveHooks(layers);
    assert.equal(active.length, 1);
    assert.deepEqual(uncachedGetActiveHooks(layers, "nobody"), []);
});

test("callers get a copy, so one snapshot cannot splice the cache", () => {
    assert.match(source, /return ownershipCache!\.slice\(\);/);
    assert.match(source, /ownershipByOwnerCache!\.get\(owner\)\?\.slice\(\) \?\? \[\];/);
    assert.doesNotMatch(source, /return ownershipCache!;/, "must not hand out the cached array itself");
});
