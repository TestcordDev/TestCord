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
/**
 * Wait for a property to be defined on the target, then call the callback with
 * the value
 * @param target Object
 * @param property Property to be defined
 * @param callback Callback
 *
 * @example onceDefined(window, "webpackChunkdiscord_app", wpInstance => wpInstance.push(...));
 */
export function onceDefined(target, property, callback) {
    const propertyAsAny = property;
    if (property in target)
        return void callback(target[propertyAsAny]);
    Object.defineProperty(target, property, {
        set(v) {
            delete target[propertyAsAny];
            target[propertyAsAny] = v;
            callback(v);
        },
        configurable: true,
        enumerable: false
    });
}
