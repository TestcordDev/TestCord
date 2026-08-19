/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./colorStyles.css";
import { classNameFactory } from "@utils/css";
import { ColorPicker } from "@webpack/common";
const cl = classNameFactory("vc-remix-settings-color-");
function hexToColorString(color) {
    return `#${color.toString(16).padStart(6, "0")}`;
}
export function SettingColorComponent({ name, onChange, color }) {
    function handleChange(newColor) {
        onChange(hexToColorString(newColor));
    }
    return (<section>
            <div className={cl("swatch-row")}>
                <ColorPicker key={name} color={color} onChange={handleChange}/>
            </div>
        </section>);
}
