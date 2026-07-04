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
import type { ComponentType, CSSProperties, MouseEventHandler, ReactNode } from "react";

const PanelButton = findComponentByCodeLazy("tooltipPositionKey", "positionKeyStemOverride") as ComponentType<UserAreaButtonProps>;
const TESTCORD_USER_AREA_ICON_COLOR_SETTING: ["plugins.TestcordHelper.userAreaButtonIconColor"] = ["plugins.TestcordHelper.userAreaButtonIconColor"];

export interface UserAreaButtonProps {
    icon: ReactNode;
    tooltipText?: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
    onContextMenu?: MouseEventHandler<HTMLDivElement>;
    className?: string;
    style?: CSSProperties;
    role?: string;
    "aria-label"?: string;
    "aria-checked"?: boolean;
    disabled?: boolean;
    plated?: boolean;
    redGlow?: boolean;
    orangeGlow?: boolean;
}

export interface UserAreaRenderProps {
    nameplate?: any;
    iconForeground?: string;
    hideTooltips?: boolean;
}

export type UserAreaButtonFactory = (props: UserAreaRenderProps) => ReactNode;

export interface UserAreaButtonData {
    render: UserAreaButtonFactory;
    icon: ComponentType<{ className?: string; }>;
    priority?: number;
}

interface ButtonEntry {
    render: UserAreaButtonFactory;
    priority: number;
}

export function UserAreaButton(props: UserAreaButtonProps) {
    useSettings(TESTCORD_USER_AREA_ICON_COLOR_SETTING);
    const iconColor = getTestcordIconColor("userAreaButtonIconColor");
    const buttonStyle: CSSProperties & Record<"--vc-plugin-icon-color", string | undefined> = {
        ...props.style,
        "--vc-plugin-icon-color": iconColor
    };

    return <PanelButton {...props} className={classes("vc-plugin-icon-button", props.className)} style={buttonStyle} />;
}

const logger = new Logger("UserArea");

export const buttons = new Map<string, ButtonEntry>();

const userAreaListeners = new Set<() => void>();
function notifyUserAreaChange() { userAreaListeners.forEach(l => l()); }

export function addUserAreaButton(id: string, render: UserAreaButtonFactory, priority = 0) {
    buttons.set(id, { render, priority });
    notifyUserAreaChange();
}

export function removeUserAreaButton(id: string) {
    buttons.delete(id);
    notifyUserAreaChange();
}

let cachedButtons: { id: string; render: UserAreaButtonFactory; }[] | null = null;

function getSortedButtons() {
    if (cachedButtons && cachedButtons.length === buttons.size) return cachedButtons;
    cachedButtons = Array.from(buttons)
        .sort(([, a], [, b]) => a.priority - b.priority)
        .map(([id, { render }]) => ({ id, render }));
    return cachedButtons;
}

function UserAreaButtons({ props }: { props: UserAreaRenderProps; }) {
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

    return (
        <>
            {getSortedButtons().map(({ id, render: Button }) => (
                <ErrorBoundary noop key={id} onError={e => logger.error(`Failed to render ${id}`, e.error)}>
                    <Button {...buttonProps} />
                </ErrorBoundary>
            ))}
        </>
    );
}

export function _renderButtons(props: UserAreaRenderProps) {
    return [<UserAreaButtons key="vc-user-area-buttons" props={props} />];
}
