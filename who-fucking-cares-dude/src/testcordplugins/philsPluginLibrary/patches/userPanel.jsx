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
import { React } from "@webpack/common";
import { SettingsPanel } from "../components";
import { SettingsPanelButton } from "../components/settingsPanel/SettingsPanelButton";
import { SettingsPanelRow } from "../components/settingsPanel/SettingsPanelRow";
import { SettingsPanelTooltipButton } from "../components/settingsPanel/SettingsPanelTooltipButton";
const settingsPanelButtonsSubscriptions = new Set();
export const settingsPanelButtons = new Proxy([], {
    set: (target, p, newValue) => {
        target[p] = newValue;
        settingsPanelButtonsSubscriptions.forEach(fn => fn());
        return true;
    },
});
export const useButtons = () => {
    const [, forceUpdate] = React.useReducer(() => ({}), {});
    React.useEffect(() => {
        settingsPanelButtonsSubscriptions.add(forceUpdate);
        return () => void settingsPanelButtonsSubscriptions.delete(forceUpdate);
    }, []);
    return settingsPanelButtons;
};
export const ButtonsSettingsPanel = () => {
    const rawPanelButtons = useButtons();
    const convertRawPanelButtons = (buttons) => {
        const settingsPanelButtonsClone = [...buttons].sort();
        const groupedButtons = [];
        while (settingsPanelButtonsClone.length) {
            const splicedButtons = settingsPanelButtonsClone
                .splice(0, 3)
                .map(({ icon, tooltipText, onClick }, index) => tooltipText
                ? <SettingsPanelTooltipButton key={`tooltip-btn-${index}`} tooltipProps={{ text: tooltipText }} icon={icon} onClick={onClick}/>
                : <SettingsPanelButton key={`btn-${index}`} icon={icon} onClick={onClick}/>);
            groupedButtons.push(splicedButtons);
        }
        return groupedButtons;
    };
    return rawPanelButtons.length > 0
        ? <SettingsPanel>
            {convertRawPanelButtons(rawPanelButtons).map((value, idx) => (<SettingsPanelRow key={`row-${idx}`}>{value}</SettingsPanelRow>))}
        </SettingsPanel>
        : <>
        </>;
};
export function replacedUserPanelComponent(oldComponent, thisContext, functionArguments) {
    const componentResult = Reflect.apply(oldComponent, thisContext, functionArguments);
    if (!componentResult?.props)
        return componentResult;
    const { children } = componentResult.props;
    children.splice(children.length - 1, 0, <ButtonsSettingsPanel />);
    return componentResult;
}
export function addSettingsPanelButton(settings) {
    settingsPanelButtons.push(settings);
}
export function removeSettingsPanelButton(name) {
    settingsPanelButtons.splice(0, settingsPanelButtons.length, ...settingsPanelButtons.filter(value => value.name !== name));
}
