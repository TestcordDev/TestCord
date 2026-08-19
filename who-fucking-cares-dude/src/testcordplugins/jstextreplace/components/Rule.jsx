/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Flex } from "@components/Flex";
import { DeleteIcon } from "@components/Icons";
import { Button, Text, Tooltip, useEffect, useRef, useState } from "@webpack/common";
import { rmRule, settings } from "..";
import { cl } from "../utils";
import { Input } from "./Input";
const editors = new Map();
export function Rule(props) {
    const { rule, index } = props;
    const [isBeingEdited, setBeingEdited] = useState(false);
    const editorTimerRef = useRef(null);
    const reactiveSettings = settings.use(["rules"]);
    useEffect(() => () => {
        if (editorTimerRef.current)
            clearTimeout(editorTimerRef.current);
        const editor = editors.get(index);
        if (editor) {
            editor.destroy();
            editors.delete(index);
        }
    }, [index]);
    return <div className={cl("rule")}>
        <Text>
            <Flex flexDirection="column" style={{ gap: "0.5em" }}>
                <Flex flexDirection="row" style={{ gap: 0 }}>
                    <Flex flexDirection="row" style={{ flexGrow: 1, gap: "0.5rem", marginRight: "5px" }} className={cl("first-row")}>
                        <Input placeholder="Find" initialValue={rule.find} onChange={v => { settings.store.rules[index].find = v; }}/>
                        <Input placeholder="Only if includes" initialValue={rule.onlyIfIncludes} onChange={v => { settings.store.rules[index].onlyIfIncludes = v; }}/>
                        <Button color={!isBeingEdited ? Button.Colors.TRANSPARENT : Button.Colors.BRAND} className={cl("replacement-btn")} onClick={() => {
            if (!isBeingEdited) {
                setBeingEdited(true);
                editorTimerRef.current = setTimeout(() => {
                    editorTimerRef.current = null;
                    const container = document.querySelector(`#vc-jstr-editor-${index}`);
                    if (!container)
                        return;
                    container.innerHTML = reactiveSettings.rules[index].replace || "// This will be evaluated if the match regex matches something.\n// You may use the _ object to access useful info. See at the top of this\n// settings window for a full list.\n// This is an async function that'll be awaited when ran.\n// Have fun!";
                    const editor = window.ace.edit(container);
                    editor.setTheme("ace/theme/one_dark");
                    editor.session.setMode("ace/mode/javascript");
                    editor.session.setUseWorker(false);
                    editors.set(index, editor);
                }, 10);
            }
            if (isBeingEdited) {
                const editor = editors.get(index);
                if (!editor)
                    return;
                settings.store.rules[index].replace = editor.getValue();
                editor.destroy();
                editors.delete(index);
                setBeingEdited(false);
            }
        }}>
                            {!isBeingEdited ? "Edit" : "Save"} replacement
                        </Button>
                    </Flex>
                    <Tooltip text={`${isBeingEdited ? "Save replacement to d" : "D"}elete rule`}>
                        {({ onMouseLeave, onMouseEnter }) => <Button size={Button.Sizes.MIN} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onClick={() => {
                console.log("Deleting rule", rule, index);
                rmRule(index);
            }} className={cl("delete")} style={{
                background: "none",
                border: "none",
                pointerEvents: isBeingEdited ? "none" : "all",
                filter: `brightness(${isBeingEdited ? "0.5" : "1"})`
            }}>
                            <DeleteIcon />
                        </Button>}
                    </Tooltip>
                </Flex>
                <div id={cl(`editor-${index}`)} className={cl("editor", isBeingEdited ? "active-editor" : "")}/>
            </Flex>
        </Text>
    </div>;
}
