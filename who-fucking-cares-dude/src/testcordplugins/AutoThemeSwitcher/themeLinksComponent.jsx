/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Settings } from "@api/Settings";
import { resolveError, SettingsSection } from "@components/settings/tabs/plugins/components/Common";
import { React, TextArea } from "@webpack/common";
/**
 * Creation of a JSX text component that becomes the theme links input box
 * @param setValue Properties of the specific setting; only the setValue function is necessary, for changing the value if valid
 * @param id The id of the setting the text box represents
 * @param description A description of the input text box
 * @returns Input text box JSX for theme links
 */
export function ThemeLinksComponent({ setValue }, id, description) {
    // Get the current state of the specific setting referenced by id, as well as the method to change it
    const [state, setState] = React.useState(Settings.plugins.AutoThemeSwitcher?.[id] ?? null);
    const [error, setError] = React.useState(null);
    // Internal function to check if the URL(s) is/are valid
    function regexValidateCheck(newValue) {
        const URLRegex = /^(http[s]?:\/\/[^\s]+\.css)$/;
        return newValue.match(URLRegex) !== null;
    }
    // Internal function to handle changes in the value
    function handleChange(newValue) {
        // Check validity on our own terms
        // This behemoth of a line checks every newline if it is a URL, removes newline characters, then returns true if all newline URLs are valid, false otherwise
        const isValid = (newValue.split(/(\r?\n)/)
            .filter(line => ["\n", ""].indexOf(line) < 0)
            .map((line) => regexValidateCheck(line)))
            .every(value => value);
        setState(newValue);
        setError(resolveError(isValid));
        if (isValid === true) {
            setValue(newValue);
        }
    }
    // Set up the text area to return
    return (<SettingsSection id={id} error={error} name={id} description={description}>
            <TextArea value={state} onChange={handleChange} placeholder="" rows={5} className={"vc-settings-theme-links"}/>
        </SettingsSection>);
}
