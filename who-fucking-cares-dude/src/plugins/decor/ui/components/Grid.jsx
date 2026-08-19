/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { cl } from "@plugins/decor/ui";
import { React } from "@webpack/common";
export default function Grid({ renderItem, getItemKey, itemKeyPrefix: ikp, items }) {
    return <div className={cl("sectioned-grid-list-grid")}>
        {items.map(item => <React.Fragment key={`${ikp ? `${ikp}-` : ""}${getItemKey(item)}`}>
                {renderItem(item)}
            </React.Fragment>)}
    </div>;
}
