/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useSettings } from "@api/Settings";
import { getTestcordIconColor } from "@testcordplugins/TestcordHelper/iconColors";
import { findComponentByCodeLazy } from "@webpack";
import { NotesDataIcon } from "./Icons";
import { openNotesDataModal } from "./NotesDataModal";
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '"top"===c');
const ICON_COLOR_SETTINGS = [
    "plugins.TestcordHelper.headerBarButtonIconColor",
    "plugins.TestcordHelper.userAreaButtonIconColor",
];
export function OpenNotesDataButton() {
    useSettings(ICON_COLOR_SETTINGS);
    const iconColor = getTestcordIconColor("headerBarButtonIconColor")
        ?? getTestcordIconColor("userAreaButtonIconColor");
    return (<span className="vc-plugin-icon-button" style={{ "--vc-plugin-icon-color": iconColor }}>
            <HeaderBarIcon className="vc-plugin-icon-button vc-notes-toolbox-button" iconClassName="vc-plugin-icon-button" onClick={() => openNotesDataModal()} tooltip={"Open Notes Data"} icon={NotesDataIcon}/>
        </span>);
}
