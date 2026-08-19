/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { cl } from "@equicordplugins/moreStickers/utils";
import { React } from "@webpack/common";
export function CategoryImage({ src, alt, isActive }) {
    return (<div>
            <svg width={32} height={32} style={{
            display: "block",
            contain: "paint",
            overflow: "hidden",
            overflowClipMargin: "content-box",
        }}>
                <foreignObject className={cl("foreign-object") + (isActive ?
            ` ${cl("foreign-object-active")}`
            : "")} x={0} y={0} width={32} height={32} overflow="visible">
                    <img src={src} alt={alt} width={32} height={32}/>
                </foreignObject>
            </svg>
        </div>);
}
export function CategoryScroller(props) {
    const children = Array.isArray(props.children) ? props.children : [props.children];
    return (<div className={cl("category-scroller")}>
            <div>{children.map(child => (<div role="listitem" key={cl("category-scroller")}>
                        {child}
                    </div>))}</div>
            <div style={{ height: `${Math.round(41.75 * (props.categoryLength + 1))}px` }}></div>
            <div aria-hidden="true"></div>
        </div>);
}
export function CategoryWrapper(props) {
    return (<div className={cl("category-wrapper")}>
            {props.children}
        </div>);
}
export function StickerCategory(props) {
    return (<div style={props.style} className={cl("sticker-category") +
            (props.isActive ? ` ${cl("sticker-category-active")}` : "")} tabIndex={0} role="button" onClick={props.onClick}>
            {props.children}
        </div>);
}
