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
import { React, TextInput, useState } from "@webpack/common";
import { resolveError, SettingsSection } from "./Common";
const MAX_SAFE_NUMBER = BigInt(Number.MAX_SAFE_INTEGER);
export function NumberSetting({ setting, pluginSettings, definedSettings, id, onChange }) {
    function serialize(value) {
        if (setting.type === 2 /* OptionType.BIGINT */)
            return BigInt(value);
        return Number(value);
    }
    const [state, setState] = useState(`${pluginSettings[id] ?? setting.default ?? 0}`);
    const [error, setError] = useState(null);
    function handleChange(newValue) {
        const serializedValue = serialize(newValue);
        const isValid = setting.isValid?.call(definedSettings, serializedValue) ?? true;
        setError(resolveError(isValid));
        if (isValid === true) {
            onChange(serializedValue);
        }
        if (setting.type === 1 /* OptionType.NUMBER */ && BigInt(newValue) >= MAX_SAFE_NUMBER) {
            setState(`${Number.MAX_SAFE_INTEGER}`);
        }
        else {
            setState(newValue);
        }
    }
    return (<SettingsSection name={setting.displayName} id={id} description={setting.description} error={error}>
            <TextInput type="number" pattern="-?[0-9]+" placeholder={setting.placeholder ?? "Enter a number"} value={state} onChange={handleChange} disabled={isSettingDisabled(definedSettings, setting)} {...setting.componentProps}/>
        </SettingsSection>);
}
