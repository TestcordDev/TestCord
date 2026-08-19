/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./Button.css";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { OpenExternalIcon } from "./Icons";
import { Link } from "./Link";
const btnCls = classNameFactory("vc-btn-");
const textBtnCls = classNameFactory("vc-text-btn-");
export function Button({ variant = "primary", size = "medium", children, className, ...restProps }) {
    return (<button data-mana-component="button" className={classes(btnCls("base", variant, size), className)} {...restProps}>
            {children}
            {variant === "link" && <OpenExternalIcon className={btnCls("link-icon")}/>}
        </button>);
}
export function LinkButton({ variant = "link", size = "medium", className, children, ...restProps }) {
    return (<Link data-mana-component="button" className={classes(btnCls("base", variant, size), className)} {...restProps}>
            {children}
            <OpenExternalIcon className={btnCls("link-icon")}/>
        </Link>);
}
export function TextButton({ variant = "primary", className, ...restProps }) {
    return (<button className={classes(textBtnCls("base", variant), className)} {...restProps}/>);
}
// #region Old compability
export const ButtonCompat = function ButtonCompat({ look, color = "BRAND", size = "medium", ...restProps }) {
    return look === "LINK"
        ? <TextButton variant={TextButtonPropsColorMapping[color]} {...restProps}/>
        : <Button variant={ButtonColorMapping[color]} size={size} {...restProps}/>;
};
/** @deprecated */
ButtonCompat.Looks = {
    FILLED: "",
    LINK: "LINK"
};
/** @deprecated */
ButtonCompat.Colors = {
    BRAND: "BRAND",
    PRIMARY: "PRIMARY",
    RED: "RED",
    TRANSPARENT: "TRANSPARENT",
    CUSTOM: "CUSTOM",
    GREEN: "GREEN",
    LINK: "LINK",
    WHITE: "WHITE",
};
const ButtonColorMapping = {
    BRAND: "primary",
    PRIMARY: "secondary",
    RED: "dangerPrimary",
    TRANSPARENT: "secondary",
    CUSTOM: "none",
    GREEN: "positive",
    LINK: "link",
    WHITE: "overlayPrimary"
};
const TextButtonPropsColorMapping = {
    BRAND: "primary",
    PRIMARY: "primary",
    RED: "danger",
    TRANSPARENT: "secondary",
    CUSTOM: "secondary",
    GREEN: "primary",
    LINK: "link",
    WHITE: "secondary"
};
/** @deprecated */
ButtonCompat.Sizes = {
    SMALL: "small",
    MEDIUM: "medium",
    LARGE: "medium",
    XLARGE: "medium",
    NONE: "min",
    MIN: "min"
};
// #endregion
