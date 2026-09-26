/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Ratcheting guard against un-indexable CSS selectors in the always-loaded stylesheet.
 *
 * A plain `import "./x.css"` is concatenated by esbuild into renderer.css and injected
 * as one unconditional <style id="vencord-css-core"> at startup, so it is live whether or
 * not the owning plugin is enabled. A selector Blink cannot put in its rule index is
 * retested against candidate elements on every style recalc, and the total is
 * rules x DOM size, both of which are large here. Opening a channel is the worst case,
 * since it replaces the message list and forces a large recalc.
 *
 * `:has()` is the worst of these. Anchored at body or #app-mount it puts Chrome into
 * has-invalidation, which can force descendant re-evaluation on DOM mutations anywhere.
 *
 * Two ways out, both preferred over rewriting selectors:
 *   - import the stylesheet as `?managed` and enable it from start(), so the rules are
 *     only present while the plugin is on
 *   - resolve the mangled name with findCssClassesLazy and use a [--name] placeholder,
 *     which compiles to a real .class selector
 *
 * This holds the line rather than fixing the backlog: BASELINE may go down, never up.
 * Lower it in the same commit that removes an offender.
 */

const BASELINE = 142;
const SRC = "src";

const UNINDEXABLE = [
    { name: ":has(", re: /:has\(/ },
    { name: "[class*=", re: /\[class\*=/ },
    { name: "[class^=", re: /\[class\^=/ },
    { name: "[class$=", re: /\[class\$=/ },
    { name: "[style attr=", re: /\[style[\^$*~|]?=/ }
];

function walk(dir, match, files = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, match, files);
        else if (match(path)) files.push(path);
    }
    return files;
}

/** Brace-aware top-level splitter, skipping strings and comments. */
function splitRules(css) {
    const out = [];
    let i = 0;
    const n = css.length;
    let preludeStart = 0;

    const skipString = quote => {
        i++;
        while (i < n) {
            if (css[i] === "\\") { i += 2; continue; }
            if (css[i] === quote) { i++; return; }
            i++;
        }
    };

    while (i < n) {
        const c = css[i];

        if (c === "/" && css[i + 1] === "*") {
            const end = css.indexOf("*/", i + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }
        if (c === "\"" || c === "'") { skipString(c); continue; }

        if (c === "{") {
            const bodyStart = i + 1;
            let depth = 1;
            i++;
            while (i < n && depth > 0) {
                const ch = css[i];
                if (ch === "/" && css[i + 1] === "*") {
                    const end = css.indexOf("*/", i + 2);
                    i = end === -1 ? n : end + 2;
                    continue;
                }
                if (ch === "\"" || ch === "'") { skipString(ch); continue; }
                if (ch === "{") depth++;
                else if (ch === "}") depth--;
                if (depth > 0) i++;
            }
            out.push({ selector: css.slice(preludeStart, bodyStart - 1).trim(), body: css.slice(bodyStart, i).trim() });
            i++;
            preludeStart = i;
            continue;
        }
        i++;
    }
    return out;
}

const managed = new Set();
const sources = walk(SRC, p => /\.(tsx?|jsx?)$/.test(p));
for (const source of sources) {
    const code = readFileSync(source, "utf8");
    const dir = dirname(source);
    for (const m of code.matchAll(/import\s+(?:[\w*{},\s]+?\s+from\s+)?["']([^"']+\.css)(\?managed)?["']/g)) {
        const abs = relative(process.cwd(), resolve(dir, m[1]));
        if (!existsSync(abs)) continue;
        if (m[2]) managed.add(abs);
    }
}

const loaded = [];
const gated = [];
for (const file of walk(SRC, p => p.endsWith(".css"))) {
    (managed.has(file) ? gated : loaded).push(file);
}

let total = 0;
const offenders = [];
for (const file of loaded) {
    for (const rule of splitRules(readFileSync(file, "utf8"))) {
        if (!rule.body) continue;
        const kinds = UNINDEXABLE.filter(u => u.re.test(rule.selector)).map(u => u.name);
        if (!kinds.length) continue;
        total++;
        offenders.push({ file, kinds, selector: rule.selector.replace(/\s+/g, " ").replace(/\/\*[\s\S]*?\*\//g, "").trim() });
    }
}

const gatedTotal = gated.reduce((sum, file) => {
    return sum + splitRules(readFileSync(file, "utf8")).filter(r => r.body && UNINDEXABLE.some(u => u.re.test(r.selector))).length;
}, 0);

if (total > BASELINE) {
    console.error(`css: ${total} un-indexable selectors in the always-loaded stylesheet, up ${total - BASELINE} over the baseline of ${BASELINE}.\n`);
    for (const o of offenders) console.error(`  ${o.file}\n      [${o.kinds.join(" ")}] ${o.selector.slice(0, 130)}`);
    console.error(`\nImport the stylesheet as ?managed and enable it from start(), or resolve the mangled`);
    console.error("name with findCssClassesLazy and use a [--name] placeholder.");
    process.exit(1);
}

if (total < BASELINE) {
    console.log(`css: ${total} un-indexable selectors in the always-loaded stylesheet, ${BASELINE - total} under the baseline of ${BASELINE}.`);
    console.log(`     Lower BASELINE to ${total} in scripts/lintCssSelectors.mjs.`);
} else {
    console.log(`css: ${total} un-indexable selectors in the always-loaded stylesheet, at the baseline of ${BASELINE}.`);
}
console.log(`     ${gatedTotal} more sit in ?managed stylesheets, gated on their plugin being enabled.`);
