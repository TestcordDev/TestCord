/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { cl } from "@plugins/decor/ui";
import { classes } from "@utils/misc";
import { findCssClassesLazy } from "@webpack";
import { React } from "@webpack/common";
import Grid from "./Grid";
const ScrollerClasses = findCssClassesLazy("managedReactiveScroller", "thin");
export default function SectionedGridList(props) {
    return <div className={classes(cl("sectioned-grid-list-container"), ScrollerClasses.thin)}>
        {props.sections.map(section => <div key={props.getSectionKey(section)} className={cl("sectioned-grid-list-section")}>
            {props.renderSectionHeader(section)}
            <Grid renderItem={props.renderItem} getItemKey={props.getItemKey} itemKeyPrefix={props.getSectionKey(section)} items={section.items}/>
        </div>)}
    </div>;
}
