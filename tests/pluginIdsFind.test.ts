/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { findPlugin } from "../src/utils/pluginIds.ts";

/**
 * Reference implementation: the linear scan `findPlugin` used before it was
 * backed by a lookup index. Every assertion below compares the indexed lookup
 * against this, so the optimisation cannot silently change which plugin wins.
 */
function findPluginReference(idOrName: string, plugins: Record<string, any>): any {
    if (idOrName in plugins) return plugins[idOrName];
    const lower = idOrName.toLowerCase();
    for (const p of Object.values(plugins)) {
        if (p.id === idOrName || p.name === idOrName) return p;
        if (p.id?.toLowerCase() === lower || p.name?.toLowerCase() === lower) return p;
        if (p.aliases?.includes(idOrName) || p.aliases?.some((a: string) => a.toLowerCase() === lower)) return p;
    }
    return undefined;
}

function registry(entries: Array<[string, any]>) {
    return Object.fromEntries(entries) as Record<string, any>;
}

const ALIASES = registry([
    ["Alpha", { name: "Alpha", aliases: ["A1", "LegacyAlpha"] }],
    ["beta-plugin", { id: "beta-plugin", name: "Beta Renamed", aliases: ["B1"] }],
    ["Gamma", { name: "Gamma" }],
    ["gamma", { name: "gamma lower name" }],
    ["Delta", { id: "delta-id", name: "Delta", aliases: [] }],
]);

const queries = [
    "Alpha", "alpha", "ALPHA", "A1", "a1", "LegacyAlpha", "legacyalpha",
    "Beta Renamed", "beta renamed", "beta-plugin", "BetaPlugin", "B1", "b1",
    "Gamma", "gamma", "GAMMA", "gamma lower name", "gamma lower name",
    "Delta", "delta", "delta-id", "deltaid",
    "Unknown", "unknown", "plugins.Alpha.formats", "Alpha.formats", "", " "
];

test("indexed findPlugin matches the original linear scan for every query", () => {
    for (const q of queries) {
        assert.equal(
            findPlugin(q, ALIASES as any),
            findPluginReference(q, ALIASES),
            `mismatch for query ${JSON.stringify(q)}`
        );
    }
});

test("direct registry key hits bypass the index and stay exact", () => {
    // "gamma" is both a registry key and another plugin's lowercased name.
    assert.equal(findPlugin("gamma", ALIASES as any), ALIASES.gamma);
    assert.equal(findPluginReference("gamma", ALIASES), ALIASES.gamma);
    assert.equal(findPlugin("beta-plugin", ALIASES as any), ALIASES["beta-plugin"]);
});

test("nested settings paths never resolve to a plugin, matching the old scan", () => {
    // These are the reads that made the old scan run on every message render.
    for (const path of ["Alpha.formats", "Alpha.formats.sameDayFormat", "plugins.Alpha"]) {
        assert.equal(findPlugin(path, ALIASES as any), findPluginReference(path, ALIASES));
        assert.equal(findPlugin(path, ALIASES as any), undefined);
    }
});

test("earlier plugin wins over a later plugin's exact name via case folding", () => {
    // The old scan was plugin-major: for each plugin it tried exact then
    // case-insensitive, returning the first plugin matching on either. A single
    // merged map would let a later plugin's exact name beat an earlier plugin's
    // case-insensitive match here.
    // Registry keys deliberately differ from the names so the `in` fast path misses.
    const r = registry([
        ["K0", { name: "aaa" }],
        ["K1", { name: "Aaa" }],
    ]);
    assert.equal(findPluginReference("Aaa", r), r.K0);
    assert.equal(findPlugin("Aaa", r as any), r.K0);
    assert.equal(findPlugin("aaa", r as any), r.K0);
    assert.equal(findPlugin("AAA", r as any), r.K0);

    // Same shape, but resolved through an alias of the earlier plugin.
    const r2 = registry([
        ["K0", { name: "First", aliases: ["Zeta"] }],
        ["K1", { name: "Zeta" }],
    ]);
    assert.equal(findPluginReference("zeta", r2), r2.K0);
    assert.equal(findPlugin("zeta", r2 as any), r2.K0);
    assert.equal(findPlugin("Zeta", r2 as any), r2.K0);

    // ...and the mirror case: the later plugin matches exactly first, so it wins.
    const r3 = registry([
        ["K0", { name: "aaa" }],
        ["K1", { id: "two", name: "TWO" }],
    ]);
    assert.equal(findPlugin("two", r3 as any), findPluginReference("two", r3));
    assert.equal(findPlugin("two", r3 as any), r3.K1);
});

test("randomised registries never disagree with the reference scan", () => {
    let seed = 0x2f6e2b1;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

    const words = ["alpha", "Alpha", "ALPHA", "beta", "Beta", "gamma", "Gamma", "delta"];
    for (let round = 0; round < 300; round++) {
        const count = 1 + Math.floor(rand() * 6);
        const entries: Array<[string, any]> = [];
        for (let i = 0; i < count; i++) {
            const name = pick(words) + (rand() < 0.5 ? "" : String(i));
            const plugin: any = { name };
            if (rand() < 0.4) plugin.id = pick(words) + (rand() < 0.5 ? "" : String(i));
            if (rand() < 0.4) plugin.aliases = [pick(words), pick(words) + "X"];
            // Key deliberately differs from name so the `in` fast path is not always taken.
            entries.push([`K${i}`, plugin]);
        }
        const r = registry(entries);
        const candidates = [...words, ...words.map(w => w.toLowerCase()), ...words.map(w => w.toUpperCase()), "missing", "a.b"];
        for (const q of candidates) {
            assert.equal(
                findPlugin(q, r as any),
                findPluginReference(q, r),
                `round ${round}: mismatch for ${JSON.stringify(q)} in ${JSON.stringify(Object.values(r).map((p: any) => p.name))}`
            );
        }
    }
});

test("a plugin with no name does not throw while indexing", () => {
    const r = registry([
        ["ok", { name: "Ok" }],
        ["broken", { name: undefined }],
    ]);
    assert.doesNotThrow(() => findPlugin("Ok", r as any));
    assert.equal(findPlugin("Ok", r as any), r.ok);
});

test("index is per registry object and rebuilt for a different registry", () => {
    const a = registry([["One", { name: "One" }]]);
    const b = registry([["Two", { name: "Two" }]]);
    assert.equal(findPlugin("One", a as any), a.One);
    assert.equal(findPlugin("One", b as any), undefined);
    assert.equal(findPlugin("Two", b as any), b.Two);
});

test("plugins without an id and with no aliases are indexed by name", () => {
    const r = registry([["Solo", { name: "Solo" }]]);
    assert.equal(findPlugin("Solo", r as any), r.Solo);
    assert.equal(findPlugin("solo", r as any), r.Solo);
    assert.equal(findPlugin("SOLO", r as any), r.Solo);
});

test("a large registry resolves in constant time per lookup", () => {
    // Mirrors the real client: ~700 plugins, and the hot read misses every time.
    const big: Record<string, any> = {};
    for (let i = 0; i < 700; i++) big[`P${i}`] = { name: `Plugin ${i}` };
    assert.equal(findPlugin("P699", big as any), big.P699);
    assert.equal(findPlugin("nope.nested", big as any), undefined);

    const started = process.hrtime.bigint();
    for (let i = 0; i < 20_000; i++) findPlugin("SomePlugin.formats", big as any);
    const perCallUs = Number(process.hrtime.bigint() - started) / 20_000 / 1000;
    // The old linear scan needed ~600us per call for this shape; 20us leaves a
    // very generous margin while still failing loudly if the index is dropped.
    assert.ok(perCallUs < 20, `lookup too slow: ${perCallUs.toFixed(2)}us per call`);
});
