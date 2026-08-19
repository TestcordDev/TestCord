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
import { findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import { Clickable, Tooltip, useEffect, useState } from "@webpack/common";
const logger = new Logger("HeaderBarAPI");
const HeaderBarClasses = findCssClassesLazy("clickable", "selected", "badge", "badgeContainer");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '"aria-haspopup":');
const TESTCORD_TOP_BAR_ICON_COLOR_SETTING = ["plugins.TestcordHelper.topBarButtonIconColor"];
const TESTCORD_HEADER_BAR_ICON_COLOR_SETTING = ["plugins.TestcordHelper.headerBarButtonIconColor"];
/**
 * Button component for the top header bar (title bar area).
 *
 * @example
 * <HeaderBarButton
 *     icon={MyIcon}
 *     tooltip="My Button"
 *     onClick={() => console.log("clicked")}
 * />
 */
export function HeaderBarButton(props) {
    useSettings(TESTCORD_TOP_BAR_ICON_COLOR_SETTING);
    const iconColor = getTestcordIconColor("topBarButtonIconColor");
    const { icon: Icon, tooltip, onClick, onContextMenu, className, style, iconSize = 18, position = "bottom", selected, ref, "aria-label": ariaLabel, } = props;
    const label = ariaLabel ?? (typeof tooltip === "string" ? tooltip : undefined);
    const buttonStyle = {
        ...style,
        "--vc-plugin-icon-color": iconColor,
        width: Math.max(iconSize, 24),
        height: Math.max(iconSize, 24),
        boxSizing: "content-box",
        justifyContent: "center"
    };
    return (<Tooltip key={String(tooltip)} text={tooltip ?? ""} position={position} shouldShow={tooltip != null}>
            {({ onMouseEnter, onMouseLeave }) => (<Clickable {...{ innerRef: ref }} className={classes(HeaderBarClasses.clickable, "vc-plugin-icon-button", className)} style={buttonStyle} onClick={event => {
                onClick?.(event);
                headerBarListeners.forEach(listener => listener());
            }} onContextMenu={event => {
                onContextMenu?.(event);
                headerBarListeners.forEach(listener => listener());
            }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} role="button" tabIndex={0} aria-label={label} aria-expanded={selected}>
                    <Icon size="custom" width={iconSize} height={iconSize} color="currentColor"/>
                </Clickable>)}
        </Tooltip>);
}
/**
 * Button component for the channel toolbar (below the search bar).
 * Automatically handles selected state styling.
 *
 * @example
 * <ChannelToolbarButton
 *     icon={MyIcon}
 *     tooltip={isOpen ? null : "My Button"}
 *     onClick={() => setOpen(v => !v)}
 *     selected={isOpen}
 * />
 */
export function ChannelToolbarButton(props) {
    useSettings(TESTCORD_HEADER_BAR_ICON_COLOR_SETTING);
    const iconColor = getTestcordIconColor("headerBarButtonIconColor");
    const wrapperStyle = {
        "--vc-plugin-icon-color": iconColor
    };
    return (<span className="vc-plugin-icon-button" style={wrapperStyle}>
            <HeaderBarIcon key={String(props.tooltip)} {...props} className={classes("vc-plugin-icon-button", props.className)} iconClassName={classes("vc-plugin-icon-button", props.iconClassName)} onClick={event => {
            props.onClick?.(event);
            channelToolbarListeners.forEach(listener => listener());
        }} onContextMenu={event => {
            props.onContextMenu?.(event);
            channelToolbarListeners.forEach(listener => listener());
        }}/>
        </span>);
}
const headerBarButtons = new Map();
const channelToolbarButtons = new Map();
const headerBarListeners = new Set();
const channelToolbarListeners = new Set();
/**
 * Adds a button to the header bar (title bar area).
 *
 * @param id - Unique identifier for the button (e.g., "my-plugin-button")
 * @param render - Function that returns the button JSX
 * @param priority - Higher values appear further right. Default: 0
 *
 * @example
 * addHeaderBarButton("my-button", () => (
 *     <HeaderBarButton
 *         icon={MyIcon}
 *         tooltip="My Button"
 *         onClick={handleClick}
 *     />
 * ));
 */
export function addHeaderBarButton(id, render, priority = 0) {
    headerBarButtons.set(id, { render, priority });
    headerBarListeners.forEach(listener => listener());
}
/**
 * Removes a button from the header bar.
 *
 * @param id - The identifier used when adding the button
 */
export function removeHeaderBarButton(id) {
    headerBarButtons.delete(id);
    headerBarListeners.forEach(listener => listener());
}
/**
 * Adds a button to the channel toolbar (below the search bar, next to pins/members).
 *
 * @param id - Unique identifier for the button (e.g., "my-plugin-toolbar")
 * @param render - Function that returns the button JSX
 * @param priority - Higher values appear further right. Default: 0
 *
 * @example
 * addChannelToolbarButton("my-toolbar", () => (
 *     <ChannelToolbarButton
 *         icon={MyIcon}
 *         tooltip="My Button"
 *         onClick={handleClick}
 *     />
 * ));
 */
export function addChannelToolbarButton(id, render, priority = 0) {
    channelToolbarButtons.set(id, { render, priority });
    channelToolbarListeners.forEach(listener => listener());
}
/**
 * Removes a button from the channel toolbar.
 *
 * @param id - The identifier used when adding the button
 */
export function removeChannelToolbarButton(id) {
    channelToolbarButtons.delete(id);
    channelToolbarListeners.forEach(listener => listener());
}
let cachedHeaderBarButtons = null;
let cachedChannelToolbarButtons = null;
function getSortedHeaderBarButtons() {
    if (cachedHeaderBarButtons && cachedHeaderBarButtons.length === headerBarButtons.size)
        return cachedHeaderBarButtons;
    cachedHeaderBarButtons = Array.from(headerBarButtons)
        .sort(([, a], [, b]) => a.priority - b.priority)
        .map(([id, { render }]) => ({ id, render }));
    return cachedHeaderBarButtons;
}
function getSortedChannelToolbarButtons() {
    if (cachedChannelToolbarButtons && cachedChannelToolbarButtons.length === channelToolbarButtons.size)
        return cachedChannelToolbarButtons;
    cachedChannelToolbarButtons = Array.from(channelToolbarButtons)
        .sort(([, a], [, b]) => a.priority - b.priority)
        .map(([id, { render }]) => ({ id, render }));
    return cachedChannelToolbarButtons;
}
function HeaderBarButtons() {
    const [, forceUpdate] = useState(0);
    useEffect(() => {
        const listener = () => { cachedHeaderBarButtons = null; forceUpdate(n => n + 1); };
        headerBarListeners.add(listener);
        return () => { headerBarListeners.delete(listener); };
    }, []);
    return getSortedHeaderBarButtons().map(({ id, render: Button }) => (<ErrorBoundary noop key={id} onError={e => logger.error(`Failed to render header bar button: ${id}`, e.error)}>
            <Button />
        </ErrorBoundary>));
}
function ChannelToolbarButtons() {
    const [, forceUpdate] = useState(0);
    useEffect(() => {
        const listener = () => { cachedChannelToolbarButtons = null; forceUpdate(n => n + 1); };
        channelToolbarListeners.add(listener);
        return () => { channelToolbarListeners.delete(listener); };
    }, []);
    return getSortedChannelToolbarButtons().map(({ id, render: Button }) => (<ErrorBoundary noop key={id} onError={e => logger.error(`Failed to render channel toolbar button: ${id}`, e.error)}>
            <Button />
        </ErrorBoundary>));
}
/** @internal Injected by HeaderBarAPI patch (do NOT call directly) */
export function _addHeaderBarButtons() {
    return [<HeaderBarButtons key="vc-header-bar-buttons"/>];
}
/** @internal Injected by HeaderBarAPI patch (do NOT call directly) */
export function _addChannelToolbarButtons(toolbar) {
    toolbar.push(<ChannelToolbarButtons key="vc-channel-toolbar-buttons"/>);
}
// ══════════════════════════════════════════════════════════════════
// STEALTH MODE (Nightcord compat) — exposed for plugins that hide UI
// ══════════════════════════════════════════════════════════════════
let _stealthActive = false;
try {
    _stealthActive = localStorage.getItem("Nightcord_stealthMode") === "1";
}
catch { }
const stealthListeners = new Set();
export function isStealthModeEnabled() {
    return _stealthActive;
}
function persistStealth(v) {
    try {
        v ? localStorage.setItem("Nightcord_stealthMode", "1") : localStorage.removeItem("Nightcord_stealthMode");
    }
    catch { }
}
const NON_REACT_SELECTORS = [
    "#nightcord-titlebar-btn",
    "#nightcord-titlebar-link-style",
    ".nai-nav-item",
];
function hideNonReactElements(hide) {
    for (const sel of NON_REACT_SELECTORS) {
        try {
            document.querySelectorAll(sel).forEach(el => {
                el.style.display = hide ? "none" : "";
            });
        }
        catch { }
    }
}
export function syncStealthBodyClass() {
    try {
        if (_stealthActive)
            document.body?.classList.add("nightcord-stealth");
        else
            document.body?.classList.remove("nightcord-stealth");
    }
    catch { }
    hideNonReactElements(_stealthActive);
}
export function _notifyStealthChange() {
    stealthListeners.forEach(fn => fn());
    try {
        window.dispatchEvent(new Event("nightcord-stealth-change"));
    }
    catch { }
}
export function toggleStealthMode() {
    _stealthActive = !_stealthActive;
    persistStealth(_stealthActive);
    hideNonReactElements(_stealthActive);
    _notifyStealthChange();
    try {
        if (_stealthActive)
            document.body?.classList.add("nightcord-stealth");
        else
            document.body?.classList.remove("nightcord-stealth");
    }
    catch { }
    return _stealthActive;
}
export function addStealthListener(fn) { stealthListeners.add(fn); }
export function removeStealthListener(fn) { stealthListeners.delete(fn); }
