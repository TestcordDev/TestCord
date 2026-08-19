/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./PluginIconColor.css";
import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { getTestcordIconColor } from "@testcordplugins/TestcordHelper/iconColors";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { findComponentByCodeLazy } from "@webpack";
import { useEffect, useState } from "@webpack/common";
const PanelButton = findComponentByCodeLazy("tooltipPositionKey", "positionKeyStemOverride");
const TESTCORD_USER_AREA_ICON_COLOR_SETTING = ["plugins.TestcordHelper.userAreaButtonIconColor"];
export function UserAreaButton(props) {
    useSettings(TESTCORD_USER_AREA_ICON_COLOR_SETTING);
    const iconColor = getTestcordIconColor("userAreaButtonIconColor");
    const buttonStyle = {
        ...props.style,
        "--vc-plugin-icon-color": iconColor
    };
    return <PanelButton {...props} className={classes("vc-plugin-icon-button", props.className)} style={buttonStyle}/>;
}
const logger = new Logger("UserArea");
export const buttons = new Map();
const userAreaListeners = new Set();
function notifyUserAreaChange() { userAreaListeners.forEach(l => l()); }
export function addUserAreaButton(id, render, priority = 0) {
    buttons.set(id, { render, priority });
    notifyUserAreaChange();
}
export function removeUserAreaButton(id) {
    buttons.delete(id);
    notifyUserAreaChange();
}
let cachedButtons = null;
function getSortedButtons() {
    if (cachedButtons && cachedButtons.length === buttons.size)
        return cachedButtons;
    cachedButtons = Array.from(buttons)
        .sort(([, a], [, b]) => a.priority - b.priority)
        .map(([id, { render }]) => ({ id, render }));
    return cachedButtons;
}
function UserAreaButtons({ props }) {
    const [, forceUpdate] = useState(0);
    useSettings(TESTCORD_USER_AREA_ICON_COLOR_SETTING);
    const iconColor = getTestcordIconColor("userAreaButtonIconColor");
    const buttonProps = {
        ...props,
        iconForeground: classes(props.iconForeground, "vc-plugin-icon-button")
    };
    useEffect(() => {
        const listener = () => { cachedButtons = null; forceUpdate(n => n + 1); };
        userAreaListeners.add(listener);
        return () => { userAreaListeners.delete(listener); };
    }, []);
    return (<>
            {getSortedButtons().map(({ id, render: Button }) => (<ErrorBoundary noop key={id} onError={e => logger.error(`Failed to render ${id}`, e.error)}>
                    <Button {...buttonProps}/>
                </ErrorBoundary>))}
        </>);
}
export function _renderButtons(props) {
    return [<UserAreaButtons key="vc-user-area-buttons" props={props}/>];
}
