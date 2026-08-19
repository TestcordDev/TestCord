/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./Heading.css";
import { classes } from "@utils/misc";
/**
 * A simple heading component that automatically sizes according to the tag used.
 *
 * If you need more control, use the BaseText component instead.
 */
export function Heading(props) {
    const { tag: Tag = "h5", children, className, ...restProps } = props;
    return (<Tag className={classes(`vc-${Tag}`, `vc-${Tag}-defaultMargin`, className)} {...restProps}>
            {children}
        </Tag>);
}
export function HeadingPrimary({ children, ...restProps }) {
    return (<Heading tag="h2" {...restProps}>
            {children}
        </Heading>);
}
export function HeadingSecondary({ children, ...restProps }) {
    return (<Heading tag="h3" {...restProps}>
            {children}
        </Heading>);
}
export function HeadingTertiary({ children, ...restProps }) {
    return (<Heading tag="h4" {...restProps}>
            {children}
        </Heading>);
}
