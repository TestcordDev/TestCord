/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./QuickAction.css";
import { Card } from "@components/Card";
import { classNameFactory } from "@utils/css";
const cl = classNameFactory("vc-settings-quickActions-");
export function QuickAction(props) {
    const { Icon, action, text, disabled, style } = props;
    return (<button className={cl("pill")} onClick={action} disabled={disabled} style={style}>
            <Icon className={cl("img")}/>
            {text}
        </button>);
}
export function QuickActionCard(props) {
    return (<Card className={cl("card")} style={props.columns ? { gridTemplateColumns: `repeat(${props.columns}, 1fr)` } : undefined}>
            {props.children}
        </Card>);
}
