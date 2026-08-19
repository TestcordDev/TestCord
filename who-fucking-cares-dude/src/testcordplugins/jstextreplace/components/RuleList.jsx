/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { settings } from "..";
import { Rule } from "./Rule";
export function RuleList() {
    const reactiveSettings = settings.use(["rules"]);
    console.log(reactiveSettings.rules);
    return <>
        {reactiveSettings.rules.map((rule, index) => <Rule rule={rule} index={index} key={index}/>)}
    </>;
}
