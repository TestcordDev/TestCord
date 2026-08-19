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
export const Direction = {
    VERTICAL: "column",
    HORIZONTAL: "row",
    VERTICAL_REVERSE: "column-reverse",
    HORIZONTAL_REVERSE: "row-reverse"
};
export const Justify = {
    START: "flex-start",
    END: "flex-end",
    CENTER: "center",
    BETWEEN: "space-between",
    AROUND: "space-around",
    EVENLY: "space-evenly"
};
export const Align = {
    START: "flex-start",
    END: "flex-end",
    CENTER: "center",
    STRETCH: "stretch",
    BASELINE: "baseline"
};
export const Wrap = {
    NO_WRAP: "nowrap",
    WRAP: "wrap",
    WRAP_REVERSE: "wrap-reverse"
};
export function Flex({ flexDirection, gap = "1em", alignContent, justifyContent, alignItems, flexWrap, children, style, ...restProps }) {
    style = {
        display: "flex",
        flexDirection,
        gap,
        alignContent,
        justifyContent,
        alignItems,
        flexWrap,
        ...style
    };
    return (<div style={style} {...restProps}>
            {children}
        </div>);
}
// Attach enums to the Flex function for plugin compatibility
Flex.Direction = Direction;
Flex.Justify = Justify;
Flex.Align = Align;
Flex.Wrap = Wrap;
