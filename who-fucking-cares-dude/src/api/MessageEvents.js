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
import { Logger } from "@utils/Logger";
import { MessageStore } from "@webpack/common";
const MessageEventsLogger = new Logger("MessageEvents", "#e5c890");
const sendListeners = new Set();
const editListeners = new Set();
export async function _handlePreSend(channelId, messageObj, options, props, contentOptions) {
    options = { ...contentOptions, ...options };
    for (const listener of sendListeners) {
        try {
            const result = await listener(channelId, messageObj, options, props);
            if (result?.cancel) {
                return true;
            }
        }
        catch (e) {
            MessageEventsLogger.error("MessageSendHandler: Listener encountered an unknown error\n", e);
        }
    }
    return false;
}
export async function _handlePreEdit(channelId, messageId, messageObj) {
    for (const listener of editListeners) {
        try {
            const result = await listener(channelId, messageId, messageObj);
            if (result?.cancel) {
                return true;
            }
        }
        catch (e) {
            MessageEventsLogger.error("MessageEditHandler: Listener encountered an unknown error\n", e);
        }
    }
    return false;
}
/**
 * Note: This event fires off before a message is sent, allowing you to edit the message.
 */
export function addMessagePreSendListener(listener) {
    sendListeners.add(listener);
    return listener;
}
/**
 * Note: This event fires off before a message's edit is applied, allowing you to further edit the message.
 */
export function addMessagePreEditListener(listener) {
    editListeners.add(listener);
    return listener;
}
export function removeMessagePreSendListener(listener) {
    return sendListeners.delete(listener);
}
export function removeMessagePreEditListener(listener) {
    return editListeners.delete(listener);
}
const listeners = new Set();
export function _handleClick(message, channel, event) {
    // message object may be outdated, so (try to) fetch latest one
    message = MessageStore.getMessage(channel.id, message.id) ?? message;
    for (const listener of listeners) {
        try {
            listener(message, channel, event);
        }
        catch (e) {
            MessageEventsLogger.error("MessageClickHandler: Listener encountered an unknown error\n", e);
        }
    }
}
export function addMessageClickListener(listener) {
    listeners.add(listener);
    return listener;
}
export function removeMessageClickListener(listener) {
    return listeners.delete(listener);
}
