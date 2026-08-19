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
import { Settings, useSettings } from "@api/Settings";
function createObjectProxy(obj1, onUpdate) {
    const handler = {
        set(target, property, value, receiver) {
            const success = Reflect.set(target, property, value, receiver);
            const nestedObj = target[property];
            if (typeof nestedObj === "object") {
                target[property] = createObjectProxy(nestedObj, () => { onUpdate(obj1); }); // On update will call itself until the top level object
            }
            onUpdate(obj1); // This will recursively call on nested objects
            return success;
        }
    };
    return new Proxy(obj1, handler);
}
const startupStates = {};
const settingStorage = new Map();
export function createPluginStore(pluginName, storeName, f) {
    if (!Settings.plugins[pluginName])
        throw new Error("The specified plugin does not exist");
    if (!Settings.plugins[pluginName].stores)
        Settings.plugins[pluginName].stores = {};
    if (!Settings.plugins[pluginName].stores[storeName]) // Just incase the store doesn't exist we create it here (otherwise we crash)
        Settings.plugins[pluginName].stores[storeName] = {};
    const get = () => {
        const storeSettings = settingStorage.get(storeName);
        if (!startupStates[storeName]) { // We do this so that we can load all the saved data without the proxy attempting to overwrite it
            const startupInfo = Settings.plugins[pluginName].stores[storeName];
            storeSettings.simpleMode = startupInfo.simpleMode;
            storeSettings.profiles = startupInfo.profiles || [];
            storeSettings.currentProfile = startupInfo.currentProfile || { name: "" };
            startupStates[storeName] = true;
        }
        return storeSettings;
    };
    const set = (s) => (typeof s === "function" ? s(get()) : s) || get();
    const use = () => { useSettings().plugins[pluginName].stores[storeName]; return get(); }; // useSettings is called to update renderer (after settings change)
    const initialSettings = f(set, get);
    const settingData = Settings.plugins[pluginName].stores[storeName];
    const filteredInitialSettings = {
        profiles: settingData.profiles || [],
        currentProfile: settingData.currentProfile || { name: "" },
        simpleMode: settingData.simpleMode ?? false
    };
    const proxiedSettings = createObjectProxy(initialSettings, updateCallback); // Setup our proxy that allows us connections to the datastore
    function updateCallback(updatedObject) {
        if (!startupStates[storeName])
            return; // Wait for the startup information to overwrite the blank proxy
        Settings.plugins[pluginName].stores[storeName] = {
            simpleMode: updatedObject.simpleMode ?? false,
            profiles: updatedObject.profiles.map(profile => ({ ...profile })),
            currentProfile: { ...updatedObject.currentProfile } // No clue if this has to be spread or not (disregard the inconsistency ig)
        };
    }
    for (const key of Object.keys(initialSettings)) {
        proxiedSettings[key] = initialSettings[key];
    } // Set them so the nested objects also become proxies
    settingStorage.set(storeName, proxiedSettings);
    set({ ...filteredInitialSettings, ...Settings.plugins[pluginName].stores[storeName] });
    updateCallback(initialSettings);
    return {
        use,
        get,
        set
    };
}
