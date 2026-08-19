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
import "./styles.css";
import { BooleanSetting } from "./BooleanSetting";
import { ComponentSetting } from "./ComponentSetting";
import { NumberSetting } from "./NumberSetting";
import { SelectSetting } from "./SelectSetting";
import { SliderSetting } from "./SliderSetting";
import { TextSetting } from "./TextSetting";
export const OptionComponentMap = {
    [0 /* OptionType.STRING */]: TextSetting,
    [1 /* OptionType.NUMBER */]: NumberSetting,
    [2 /* OptionType.BIGINT */]: NumberSetting,
    [3 /* OptionType.BOOLEAN */]: BooleanSetting,
    [4 /* OptionType.SELECT */]: SelectSetting,
    [5 /* OptionType.SLIDER */]: SliderSetting,
    [6 /* OptionType.COMPONENT */]: ComponentSetting,
    [7 /* OptionType.CUSTOM */]: () => null,
};
