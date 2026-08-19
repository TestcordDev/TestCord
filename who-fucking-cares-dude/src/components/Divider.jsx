/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./Divider.css";
import { classes } from "@utils/misc";
export function Divider({ className, ...restProps }) {
    return (<hr className={classes("vc-divider", className)} {...restProps}/>);
}
