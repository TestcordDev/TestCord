/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./Card.css";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
const cl = classNameFactory("vc-card-");
export function Card({ variant = "primary", outline = false, defaultPadding, children, className, ...restProps }) {
    const addDefaultPadding = defaultPadding != null
        ? defaultPadding
        : !className;
    return (<div className={classes(cl("base", variant, outline && "outline", addDefaultPadding && "defaultPadding"), className)} {...restProps}>
            {children}
        </div>);
}
