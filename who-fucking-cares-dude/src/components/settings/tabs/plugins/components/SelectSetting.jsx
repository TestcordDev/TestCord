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
import { isSettingDisabled } from "@api/PluginManager";
import { React, Select, useState } from "@webpack/common";
import { resolveError, SettingsSection } from "./Common";
export function SelectSetting({ setting, pluginSettings, definedSettings, onChange, id }) {
    // Derived, not mirrored: local state went stale when the value was changed outside
    // this dropdown, leaving the UI showing the old option until the menu was reopened.
    const state = pluginSettings[id] ?? setting.options?.find(o => o.default)?.value ?? null;
    const [error, setError] = useState(null);
    function handleChange(newValue) {
        const isValid = setting.isValid?.call(definedSettings, newValue) ?? true;
        setError(resolveError(isValid));
        if (isValid === true) {
            onChange(newValue);
        }
    }
    return (<SettingsSection name={setting.displayName} id={id} description={setting.description} error={error}>
            <Select placeholder={setting.placeholder ?? "Select an option"} options={setting.options} maxVisibleItems={5} closeOnSelect={true} select={handleChange} isSelected={v => v === state} serialize={v => String(v)} isDisabled={isSettingDisabled(definedSettings, setting)} {...setting.componentProps}/>
        </SettingsSection>);
}
