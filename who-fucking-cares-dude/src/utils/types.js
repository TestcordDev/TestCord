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
// exists to export default definePlugin({...})
export default function definePlugin(p) {
    if (p.settings) {
        p.settings.pluginName = p.name;
    }
    return p;
}
export function makeRange(start, end, step = 1) {
    const ranges = [];
    for (let value = start; value <= end; value += step) {
        ranges.push(Math.round(value * 100) / 100);
    }
    return ranges;
}
export const PluginTags = [
    "Accessibility",
    "Activity",
    "Appearance",
    "Chat",
    "Commands",
    "Console",
    "Customisation",
    "Developers",
    "Emotes",
    "Friends",
    "Fun",
    "Media",
    "Notifications",
    "Organisation",
    "Performance",
    "Privacy",
    "Reactions",
    "Roles",
    "Servers",
    "Shortcuts",
    "MemberList",
    "Utility",
    "Voice",
    "Nightcord",
    "betterdiscord",
    "bd",
    "loader"
];
export function defineDefault(value) {
    return value;
}
