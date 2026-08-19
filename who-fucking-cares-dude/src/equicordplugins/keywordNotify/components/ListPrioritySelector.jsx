/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Select } from "@webpack/common";
import { ListType } from "..";
export function ListPrioritySelector({ listType, setListPriority }) {
    return (<Select options={[
            { label: "Whitelist", value: ListType.Whitelist },
            { label: "Blacklist", value: ListType.BlackList }
        ]} placeholder={"Select a list type"} isSelected={v => v === listType} closeOnSelect={true} select={setListPriority} serialize={v => v}/>);
}
