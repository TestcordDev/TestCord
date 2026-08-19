/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./ChatButton.css";
import "./PluginIconColor.css";
import ErrorBoundary from "@components/ErrorBoundary";
import { getTestcordIconColor } from "@testcordplugins/TestcordHelper/iconColors";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { findCssClassesLazy } from "@webpack";
import { Clickable, Menu, Tooltip, useEffect, useState } from "@webpack/common";
import { addContextMenuPatch, findGroupChildrenByChildId } from "./ContextMenu";
import { SettingsStore, useSettings } from "./Settings";
const ButtonWrapperClasses = findCssClassesLazy("button", "buttonWrapper", "notificationDot");
const ChannelTextAreaClasses = findCssClassesLazy("buttonContainer", "channelTextArea", "button");
const TESTCORD_CHAT_BOX_ICON_COLOR_SETTING = ["plugins.TestcordHelper.chatBoxButtonIconColor"];
/**
 * Don't use this directly, use {@link addChatBarButton} and {@link removeChatBarButton} instead.
 */
export const ChatBarButtonMap = new Map();
const logger = new Logger("ChatButtons");
const chatBarButtonListeners = new Set();
function notifyChatBarButtonChange() { chatBarButtonListeners.forEach(l => l()); }
/**
 * Set of button IDs hidden by the Backpack plugin (Nightcord compat).
 * Buttons in this set should be rendered inside the Backpack popout instead of the main bar.
 */
export const BackpackedButtons = new Set();
export const backpackListeners = new Set();
export function notifyBackpackChange() { backpackListeners.forEach(l => l()); }
let cachedChatBarButtons = null;
function getSortedChatBarButtons() {
    if (cachedChatBarButtons && cachedChatBarButtons.length === ChatBarButtonMap.size)
        return cachedChatBarButtons;
    cachedChatBarButtons = Array.from(ChatBarButtonMap)
        .map(([key, { render }]) => ({ key, render }));
    return cachedChatBarButtons;
}
function VencordChatBarButtons(props) {
    const { chatBarButtons } = useSettings(["uiElements.chatBarButtons.*"]).uiElements;
    const [, forceUpdate] = useState(0);
    useEffect(() => {
        const listener = () => { cachedChatBarButtons = null; forceUpdate(n => n + 1); };
        chatBarButtonListeners.add(listener);
        return () => { chatBarButtonListeners.delete(listener); };
    }, []);
    const { analyticsName } = props.type;
    return (<>
            {getSortedChatBarButtons()
            .filter(({ key }) => chatBarButtons[key]?.enabled !== false)
            .map(({ key, render: Button }) => (<ErrorBoundary noop key={key} onError={e => logger.error(`Failed to render ${key}`, e.error)}>
                        <Button {...props} isMainChat={analyticsName === "normal"} isAnyChat={analyticsName === "normal" || analyticsName === "sidebar"}/>
                    </ErrorBoundary>))}
        </>);
}
export function _injectButtons(buttons, props) {
    if (props.disabled || buttons.length === 0)
        return;
    buttons.unshift(<VencordChatBarButtons key="vencord-chat-buttons" {...props}/>);
}
/**
 * The icon argument is used only for Settings UI. Your render function must still render an icon,
 * and it can be different from this one.
 */
export const addChatBarButton = (id, render, icon) => {
    ChatBarButtonMap.set(id, { render, icon });
    notifyChatBarButtonChange();
};
export const removeChatBarButton = (id) => {
    ChatBarButtonMap.delete(id);
    notifyChatBarButtonChange();
};
export const ChatBarButton = ErrorBoundary.wrap((props) => {
    useSettings(TESTCORD_CHAT_BOX_ICON_COLOR_SETTING);
    const iconColor = getTestcordIconColor("chatBoxButtonIconColor");
    const buttonStyle = {
        ...props.buttonProps?.style,
        "--vc-plugin-icon-color": iconColor
    };
    return (<Tooltip text={props.tooltip}>
            {({ onMouseEnter, onMouseLeave }) => (<div className={`expression-picker-chat-input-button ${ChannelTextAreaClasses?.buttonContainer ?? ""} vc-chatbar-button`}>
                    <Clickable aria-label={props.tooltip} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className={classes(ButtonWrapperClasses.button, ChannelTextAreaClasses?.button, "vc-plugin-icon-button", props.buttonProps?.className)} onClick={props.onClick} onContextMenu={props.onContextMenu} onAuxClick={props.onAuxClick} {...props.buttonProps} style={buttonStyle}>
                        <div className={ButtonWrapperClasses.buttonWrapper}>
                            {props.children}
                        </div>
                    </Clickable>
                </div>)}
        </Tooltip>);
}, { noop: true });
addContextMenuPatch("textarea-context", (children, args) => {
    const { chatBarButtons } = SettingsStore.store.uiElements;
    const buttons = Array.from(ChatBarButtonMap.entries());
    if (!buttons.length)
        return;
    const group = findGroupChildrenByChildId("submit-button", children);
    if (!group)
        return;
    const idx = group.findIndex(c => c?.props?.id === "submit-button");
    if (idx === -1)
        return;
    group.splice(idx, 0, <Menu.MenuItem id="vc-chat-buttons" key="vencord-chat-buttons" label="Vencord Buttons">
            {buttons.map(([id]) => (<Menu.MenuCheckboxItem label={id} key={id} id={`vc-chat-button-${id}`} checked={chatBarButtons[id]?.enabled !== false} action={() => {
                const wasEnabled = chatBarButtons[id]?.enabled !== false;
                chatBarButtons[id] ??= {};
                chatBarButtons[id].enabled = !wasEnabled;
            }}/>))}
        </Menu.MenuItem>);
});
/**
 * Registry for plugins that need to wrap the entire chat bar button container.
 * Wrappers are applied in ascending priority order (lower number = outermost wrapper).
 */
export const ChatBarButtonWrappers = new Map();
export const addChatBarButtonWrapper = (id, wrapper, priority = 0) => ChatBarButtonWrappers.set(id, { wrapper, priority });
export const removeChatBarButtonWrapper = (id) => ChatBarButtonWrappers.delete(id);
export function _wrapButtons(buttons) {
    const sorted = [...ChatBarButtonWrappers.values()]
        .sort((a, b) => a.priority - b.priority);
    let wrapped = buttons;
    for (const { wrapper } of sorted) {
        wrapped = wrapper(wrapped);
    }
    return wrapped;
}
