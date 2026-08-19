/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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
import { proxyLazy } from "@utils/lazy";
import { Logger } from "@utils/Logger";
import { findModuleId, proxyLazyWebpack, wreq } from "@webpack";
import { isPluginEnabled } from "./PluginManager";
export const UserSettings = proxyLazyWebpack(() => {
    const modId = findModuleId('"textAndImages","renderSpoilers"');
    if (modId == null)
        return new Logger("UserSettingsAPI").error("Didn't find settings module.");
    return wreq(modId);
});
/**
 * Get the setting with the given setting group and name.
 *
 * @param group The setting group
 * @param name The name of the setting
 */
export function getUserSetting(group, name) {
    if (!isPluginEnabled("UserSettingsAPI"))
        throw new Error("Cannot use UserSettingsAPI without setting it as a dependency.");
    for (const key in UserSettings) {
        const userSetting = UserSettings[key];
        if (userSetting.userSettingsAPIGroup === group && userSetting.userSettingsAPIName === name) {
            return userSetting;
        }
    }
}
/**
 * {@link getUserSettingDefinition}, lazy.
 *
 * Get the setting with the given setting group and name.
 *
 * @param group The setting group
 * @param name The name of the setting
 */
export function getUserSettingLazy(group, name) {
    return proxyLazy(() => getUserSetting(group, name));
}
