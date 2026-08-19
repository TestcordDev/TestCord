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
import { mergeDefaults } from "@utils/mergeDefaults";
import { findByCodeLazy } from "@webpack";
import { MessageActions, SnowflakeUtils } from "@webpack/common";
const createBotMessage = findByCodeLazy('username:"Clyde"');
export function generateId() {
    return `-${SnowflakeUtils.fromTimestamp(Date.now())}`;
}
/**
 * Send a message as Clyde
 * @param {string} channelId ID of channel to send message to
 * @param {Message} message Message to send
 * @returns {Message}
 */
export function sendBotMessage(channelId, message) {
    const botMessage = createBotMessage({ channelId, content: "", embeds: [] });
    MessageActions.receiveMessage(channelId, mergeDefaults(message, botMessage));
    return message;
}
export function findOption(args, name, fallbackValue) {
    return (args.find(a => a.name === name)?.value ?? fallbackValue);
}
