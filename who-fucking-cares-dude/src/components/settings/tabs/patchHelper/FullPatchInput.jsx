/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Paragraph } from "@components/Paragraph";
import { TextArea, useEffect, useRef, useState } from "@webpack/common";
export function FullPatchInput({ setFind, setParsedFind, setMatch, setReplacement }) {
    const [patch, setPatch] = useState("");
    const [error, setError] = useState("");
    const textAreaRef = useRef(null);
    function update() {
        if (patch === "") {
            setError("");
            setFind("");
            setParsedFind("");
            setMatch("");
            setReplacement("");
            return;
        }
        try {
            let { find, replacement } = (0, eval)(`([${patch}][0])`);
            if (!find)
                throw new Error("No 'find' field");
            if (!replacement)
                throw new Error("No 'replacement' field");
            if (replacement instanceof Array) {
                if (replacement.length === 0)
                    throw new Error("Invalid replacement");
                // Only test the first replacement
                replacement = replacement[0];
            }
            if (!replacement.match)
                throw new Error("No 'replacement.match' field");
            if (replacement.replace == null)
                throw new Error("No 'replacement.replace' field");
            setFind(find instanceof RegExp ? `/${find.source}/` : find);
            setParsedFind(find);
            setMatch(replacement.match instanceof RegExp ? replacement.match.source : replacement.match);
            setReplacement(replacement.replace);
            setError("");
        }
        catch (e) {
            setError(e.message);
        }
    }
    useEffect(() => {
        const { current: textArea } = textAreaRef;
        if (textArea) {
            textArea.style.height = "auto";
            textArea.style.height = `${textArea.scrollHeight}px`;
        }
    }, [patch]);
    return (<>
            <TextArea inputRef={textAreaRef} value={patch} onChange={setPatch} onBlur={update}/>
            {error !== "" && <Paragraph style={{ color: "var(--text-feedback-critical)" }}>{error}</Paragraph>}
        </>);
}
