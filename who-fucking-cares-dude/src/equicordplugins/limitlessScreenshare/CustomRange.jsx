/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { lodash, Menu, useEffect, useMemo, useState } from "@webpack/common";
import { COOLDOWN_MS } from "./settings";
import { denormalize, normalize } from "./utils";
export const CustomRange = ({ onChange, initialValue, minMax, group, id, suffix }) => {
    const [value, setValue] = useState(initialValue);
    const [minValue, maxValue] = minMax;
    const changeStreamSettings = useMemo(() => lodash.throttle((value) => onChange(value), COOLDOWN_MS), []);
    useEffect(() => () => changeStreamSettings.cancel(), [changeStreamSettings]);
    const onChangeHandler = (newValue) => {
        const roundedValue = Math.round(denormalize(newValue, minValue, maxValue));
        setValue(roundedValue);
        changeStreamSettings(roundedValue);
    };
    return (<Menu.MenuControlItem group={`${group}`} id={`${id}-custom`} label={value + suffix} control={(props, ref) => <Menu.MenuSliderControl {...props} ref={ref} onChange={onChangeHandler} renderValue={() => value + suffix} value={normalize(value, minValue, maxValue) || 0} minValue={0} maxValue={100}>
        </Menu.MenuSliderControl>}/>);
};
