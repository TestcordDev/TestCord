/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { ErrorCard } from "@components/ErrorCard";
import { Link } from "@components/Link";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { Forms, React, Text, TextInput, Toasts, useState } from "@webpack/common";
import challengeText from "file://../challenge.mjs";
import { settings } from "..";
import { t as solveChallenge } from "../challenge.mjs";
import { getRandomWord } from "../utils";
export function Challenge() {
    const reactiveSettings = settings.use(["hasDoneChallenge"]);
    const [values] = useState([Math.floor(Math.random() * 10) + 1, getRandomWord(), getRandomWord(), Math.floor(Math.random() * 10)]);
    const [expanded, setExpanded] = useState(false);
    return <>
        <ErrorCard className={classes(Margins.top16, Margins.bottom16)} style={{ padding: "1em" }}>
            <Forms.FormText>When using JSTextReplace, please review any rule that you paste from someone. This plugin allows arbitrary code execution. You are expected to understand JS code and not blindly add rules. You have been warned.
                <br /><br />
                {!reactiveSettings.hasDoneChallenge && <Text>
                        To use the plugin, you will need to answer the following question. Assuming the following: <Link style={{ fontWeight: "bold", fontSize: "1.1rem" }} onClick={() => setExpanded(!expanded)}>
                            {!expanded ? "⮟ show context" : "⮝ collapse"}
                        </Link>
                        {expanded ? <Text style={{ fontFamily: "monospace", userSelect: "none", fontSize: "0.8rem" }}>
                                {challengeText.replace("export ", "").replace("/* eslint-disable simple-header/header */\n", "").split("\n").map((l, i) => (<>
                                            {l.replaceAll("\t", "\u2800\u2800")}
                                            <br />
                                        </>))}
                            </Text> : <br />}
                        <br />
                        what would be the output to <Text style={{ fontFamily: "monospace", userSelect: "none", fontSize: "0.8rem" }}>
                            {`t(["${values[1][0].toUpperCase() + values[1].slice(1)}", ${values[0]}, { "${values[3]}": false }, "${values[2]}"]);`}
                        </Text>
                        (note: the month value is zero-based)
                    </Text>}
            </Forms.FormText>
            {!reactiveSettings.hasDoneChallenge ? <TextInput placeholder="The answer to the above" style={{ marginTop: "15px" }} onChange={async (value) => {
                if (value === solveChallenge([values[1], values[0], {}, values[2]])) {
                    settings.store.hasDoneChallenge = true;
                    Toasts.show(Toasts.create("You can now use the plugin.", Toasts.Type.SUCCESS));
                }
            }}/> : <Forms.FormText>You can now use the plugin as you have shown some understanding of JS. You are now on your own. <Link onClick={() => { settings.store.hasDoneChallenge = false; setExpanded(false); }}>
                    Disable
                </Link>
                </Forms.FormText>}
        </ErrorCard>
    </>;
}
