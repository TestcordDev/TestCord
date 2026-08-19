/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Settings } from "@api/Settings";
import { resolveError, SettingsSection } from "@components/settings/tabs/plugins/components/Common";
import { TextSetting } from "@components/settings/tabs/plugins/components/TextSetting";
import { React } from "@webpack/common";
/**
 * Creation of a JSX text component that hides based on the ChangeBasedOnSystemAppearance setting
 * It allows the removal of the time setting if the user chooses to use system appearance rather than time for the theme change
 * Loosely based on themeLinksComponent.tsx
 * @param setValue Properties of the specific setting; only the setValue function is necessary, for changing the value if valid
 * @param id The id of the setting the text input represents
 * @param placeholder A default value for when the text input is not set by the user
 * @param description A description of the text input
 * @returns JSX representing the input for time
 */
export function timeComponent({ setValue }, id, placeholder, description) {
    const pluginSettings = Settings.plugins.AutoThemeSwitcher;
    // TextSetting handles state, not needed here
    const [, setState] = React.useState(pluginSettings?.[id] ?? null);
    const [error, setError] = React.useState(null);
    // Internal function to check if the time string is valid
    function regexValidateCheck(newValue) {
        const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
        return newValue.match(timeRegex) !== null;
    }
    // Internal function to handle changes in the value
    function handleChange(newValue) {
        // Check validity on our own terms
        const isValid = regexValidateCheck(newValue);
        setState(newValue);
        setError(resolveError(isValid));
        if (isValid === true) {
            setValue(newValue);
        }
    }
    // Hide the setting if we're using the system theme rather than time of day
    // This was the whole purpose of making a component setting!
    if (Settings.plugins.AutoThemeSwitcher.ChangeBasedOnSystemAppearance)
        return null;
    return (<SettingsSection id={id} error={error} name={""} description={""}>
        <TextSetting setting={{
            type: 0 /* OptionType.STRING */,
            // Determine if we autofill the field with the default, or with what the user entered
            default: (pluginSettings?.[id] != null || pluginSettings?.[id]) ? pluginSettings?.[id] : placeholder,
            description: description
        }} definedSettings={undefined} closePluginSettings={undefined} onChange={handleChange} pluginSettings={pluginSettings} id={id}/>
        </SettingsSection>);
}
