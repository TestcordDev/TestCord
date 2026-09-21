/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { IconComponent } from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { useEffect, useMemo, useState } from "@webpack/common";
import type { ComponentType, MouseEventHandler } from "react";

import { SettingsStore, useSettings } from "./Settings";

const logger = new Logger("MessagePopover");

export interface MessagePopoverButtonItem {
    key?: string,
    label: string,
    icon: ComponentType<any>,
    message: Message,
    channel: Channel,
    onClick?: MouseEventHandler<HTMLButtonElement>,
    onContextMenu?: MouseEventHandler<HTMLButtonElement>;
}

export type MessagePopoverButtonFactory = (message: Message) => MessagePopoverButtonItem | null;
export type MessagePopoverButtonData = {
    render: MessagePopoverButtonFactory;
    /**
     * This icon is used only for Settings UI. Your render function must still return an icon,
     * and it can be different from this one.
     */
    icon: IconComponent;
};

export const MessagePopoverButtonMap = new Map<string, MessagePopoverButtonData>();

/**
 * The icon argument is used only for Settings UI. Your render function must still return an icon,
 * and it can be different from this one.
 */
export function addMessagePopoverButton(
    identifier: string,
    render: MessagePopoverButtonFactory,
    icon: IconComponent
) {
    MessagePopoverButtonMap.set(identifier, { render, icon });
}

export function removeMessagePopoverButton(identifier: string) {
    MessagePopoverButtonMap.delete(identifier);
}

/**
 * Captured toolbar button component used by fallback patches on PTB/Stable.
 * Set by _captureToolbarButton during the first successful patch application.
 */
let _capturedToolbarButton: any = null;

export function _captureToolbarButton(comp: any) {
    if (!_capturedToolbarButton) _capturedToolbarButton = comp;
    return _capturedToolbarButton;
}

function VencordPopoverButtons(props: { message: Message }) {
    const { message } = props;

    const { messagePopoverButtons } = useSettings(["uiElements.messagePopoverButtons.*"]).uiElements;

    // Same rationale as the chat bar row: the popover re-renders on every
    // hover, re-running all factories each time. Skip when nothing a factory
    // consumes changed. Factories only get the message; live data flows
    // through their own hooks/subscriptions.
    const [settingsTick, setSettingsTick] = useState(0);
    useEffect(() => {
        const listener = () => setSettingsTick(t => t + 1);
        SettingsStore.addGlobalChangeListener(listener);
        return () => SettingsStore.removeGlobalChangeListener(listener);
    }, []);

    const enabledKey = (() => {
        let key = "";
        for (const [mapKey] of MessagePopoverButtonMap) {
            if (messagePopoverButtons[mapKey]?.enabled !== false) key += mapKey + ",";
        }
        return key;
    })();

    const elements = useMemo(() => {
        const nodes: React.ReactNode[] = [];
        for (const [key, { render }] of MessagePopoverButtonMap) {
            if (messagePopoverButtons[key]?.enabled !== false) {
                try {
                    const item = render(message);
                    if (!item) continue;

                    const ButtonComponent = _capturedToolbarButton as React.ComponentType<MessagePopoverButtonItem> | null;

                    nodes.push(
                        <ErrorBoundary noop key={key}>
                            {ButtonComponent
                                ? <ButtonComponent {...item} />
                                : <item.icon width={16} height={16} />
                            }
                        </ErrorBoundary>
                    );
                } catch (err) {
                    logger.error(`[${key}]`, err);
                }
            }
        }
        return nodes;
    }, [message.id, message.editedTimestamp, message.channel_id, enabledKey, settingsTick, _capturedToolbarButton ? 1 : 0]);

    return <>{elements}</>;
}

export function _buildPopoverElements(
    Component: React.ComponentType<MessagePopoverButtonItem> | null,
    message: Message
) {
    return <VencordPopoverButtons message={message} />;
}
