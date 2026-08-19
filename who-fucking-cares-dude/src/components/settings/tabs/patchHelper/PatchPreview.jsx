/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Margins } from "@utils/margins";
import { canonicalizeMatch, canonicalizeReplace } from "@utils/patches";
import { makeCodeblock } from "@utils/text";
import { Button, Parser, useMemo, useState } from "@webpack/common";
// Do not include diff in standalone builds (side effects import)
if (!IS_STANDALONE) {
    var differ = require("diff");
}
function makeDiff(original, patched, match) {
    if (!match || original === patched)
        return null;
    const changeSize = patched.length - original.length;
    // Use 200 surrounding characters of context
    const start = Math.max(0, match.index - 200);
    const end = Math.min(original.length, match.index + match[0].length + 200);
    // (changeSize may be negative)
    const endPatched = end + changeSize;
    const context = original.slice(start, end);
    const patchedContext = patched.slice(start, endPatched);
    return differ.diffWordsWithSpace(context, patchedContext);
}
function Match({ matchResult }) {
    if (!matchResult)
        return null;
    const fullMatch = matchResult[0]
        ? makeCodeblock(matchResult[0], "js")
        : "";
    const groups = matchResult.length > 1
        ? makeCodeblock(matchResult.slice(1).map((g, i) => `Group ${i + 1}: ${g}`).join("\n"), "yml")
        : "";
    return (<>
            <Heading>Match</Heading>
            <div style={{ userSelect: "text" }}>{Parser.parse(fullMatch)}</div>
            <div style={{ userSelect: "text" }}>{Parser.parse(groups)}</div>
        </>);
}
function Diff({ diff }) {
    if (!diff?.length)
        return null;
    const diffLines = diff.map((p, idx) => {
        const color = p.added
            ? "lime"
            : p.removed
                ? "red"
                : "grey";
        return (<div key={idx} style={{ color, userSelect: "text", wordBreak: "break-all", lineBreak: "anywhere" }}>
                {p.value}
            </div>);
    });
    return (<>
            <Heading>Diff</Heading>
            {diffLines}
        </>);
}
export function PatchPreview({ module, match, replacement, setReplacementError }) {
    const [id, fact] = module;
    const [compileResult, setCompileResult] = useState();
    const [patchedCode, matchResult, diff] = useMemo(() => {
        const src = fact.toString().replaceAll("\n", "");
        try {
            new RegExp(match);
        }
        catch (e) {
            return ["", null, null];
        }
        const canonicalMatch = canonicalizeMatch(new RegExp(match));
        try {
            const canonicalReplace = canonicalizeReplace(replacement, 'Vencord.Plugins.plugins["YourPlugin"]');
            var patched = src.replace(canonicalMatch, canonicalReplace);
            setReplacementError(void 0);
        }
        catch (e) {
            setReplacementError(e.message);
            return ["", null, null];
        }
        const m = src.match(canonicalMatch);
        return [patched, m, makeDiff(src, patched, m)];
    }, [id, match, replacement]);
    return (<>
            <Heading>Module {id}</Heading>

            <Match matchResult={matchResult}/>
            <Diff diff={diff}/>

            {!!diff?.length && (<Button className={Margins.top20} onClick={() => {
                try {
                    const isArrowFunction = patchedCode.startsWith("(");
                    const wrappedCode = "0," + (!isArrowFunction ? "function" : "") + patchedCode.slice(patchedCode.indexOf("("));
                    Function(wrappedCode);
                    setCompileResult([true, "Compiled successfully"]);
                }
                catch (err) {
                    setCompileResult([false, err.message]);
                }
            }}>
                    Compile
                </Button>)}

            {compileResult && (<Paragraph style={{ color: compileResult[0] ? "var(--status-positive)" : "var(--text-feedback-critical)" }}>
                    {compileResult[1]}
                </Paragraph>)}
        </>);
}
